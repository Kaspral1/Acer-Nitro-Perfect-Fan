#!/usr/bin/env python3
"""Warstwa I/O wentylatorów: acer_nitro_ec (hwmon) albo nbfc-linux.

GUI i krzywe nie wiedzą, który backend jest aktywny. Wybór:
  1. pole ``backend`` w config.json: auto | acer_nitro_ec | nbfc
  2. auto: hwmon acer_nitro_ec jeśli jest, w przeciwnym razie gniazdo nbfc
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Dict, Optional, Tuple

# GUI i daemon czytają ten sam plik; 256 KB z dużym zapasem na krzywe (kilka punktów).
CONFIG_MAX_BYTES = 256 * 1024

BACKEND_AUTO = "auto"
BACKEND_EC = "acer_nitro_ec"
BACKEND_NBFC = "nbfc"
VALID_BACKENDS = (BACKEND_AUTO, BACKEND_EC, BACKEND_NBFC)

HWMON_ROOT = Path("/sys/class/hwmon")
NBFC_SOCKETS = (
    Path("/run/nbfc_service.socket"),
    Path("/var/run/nbfc_service.socket"),
)
NBFC_END = b"\nEND"
# fan_id daemona: "1" = CPU, "2" = GPU  →  indeks NBFC 0 / 1
DAEMON_TO_NBFC = {"1": 0, "2": 1}
API_TO_DAEMON = {"0": "1", "1": "2"}
TEMP_MIN_VALID = 5.0
TEMP_MAX_VALID = 110.0
_NVIDIA_TTL = 0.8
_NVIDIA_MISS_TTL = 5.0
_nvidia_cache: Optional[Tuple[Optional[float], float]] = None


def pct_to_pwm(pct: float) -> int:
    return int((pct * 255 + 99) // 100)


def pwm_to_pct(pwm: int) -> int:
    return round(pwm * 100 / 255)


def find_hwmon(name: str) -> Optional[Path]:
    if not HWMON_ROOT.is_dir():
        return None
    try:
        entries = list(HWMON_ROOT.iterdir())
    except OSError:
        return None
    for h in entries:
        try:
            if (h / "name").read_text().strip() == name:
                return h
        except OSError:
            continue
    return None


def nbfc_socket_path() -> Optional[Path]:
    for p in NBFC_SOCKETS:
        if p.is_socket():
            return p
    return None


def read_json_limited(path: Path, max_bytes: int = CONFIG_MAX_BYTES) -> dict:
    """Wczytuje obiekt JSON z limitem rozmiaru — chroni daemona przed bombą."""
    data = Path(path).read_bytes()
    if len(data) > max_bytes:
        raise ValueError(f"config too large: {len(data)} bytes (max {max_bytes})")
    parsed = json.loads(data.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("config is not a JSON object")
    return parsed


def atomic_write_json(path: Path, payload: dict) -> None:
    """Zapis JSON przez plik tymczasowy w tym samym katalogu + os.replace.

    Zachowuje tryb istniejącego pliku (np. 664), żeby daemon nadal mógł czytać
    /etc/nitro-fan/config.json. os.replace jest atomowy na tym samym FS.
    """
    dest = Path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{dest.name}.",
        suffix=".tmp",
        dir=str(dest.parent),
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=4)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            mode = stat.S_IMODE(dest.stat().st_mode)
        except OSError:
            mode = 0o664
        os.chmod(tmp_path, mode)
        os.replace(tmp_path, dest)
    except Exception:
        try:
            tmp_path.unlink()
        except OSError:
            pass
        raise


def read_config_backend(config_path: Optional[Path] = None) -> str:
    """Odczyt pola backend z configu; nieznane / brak → auto."""
    candidates = []
    if config_path is not None:
        candidates.append(Path(config_path))
    candidates.extend(
        (
            Path("/etc/nitro-fan/config.json"),
            Path(__file__).resolve().parent / "nbfc_config.json",
        )
    )
    for path in candidates:
        try:
            if not path.is_file():
                continue
            raw = read_json_limited(path)
            value = str(raw.get("backend") or BACKEND_AUTO).strip().lower()
            if value in VALID_BACKENDS:
                return value
        except (OSError, ValueError, TypeError):
            continue
    return BACKEND_AUTO


def _read_int(path: Path) -> Optional[int]:
    try:
        return int(path.read_text())
    except (OSError, ValueError):
        return None


def _read_temp_c(path: Path) -> Optional[float]:
    raw = _read_int(path)
    if raw is None:
        return None
    return raw / 1000.0


def _write_int(path: Path, value: int) -> None:
    try:
        path.write_text(str(value))
    except OSError:
        pass


class FanBackend:
    name = "unknown"

    def read_temps(self) -> Dict[str, Optional[float]]:
        return {"cpu": None, "gpu": None, "sys": None}

    def read_pwm_pct(self, fan_id: str) -> Optional[float]:
        return None

    def read_fan_rpm(self, fan_id: str) -> Optional[int]:
        return None

    def write_pwm_pct(self, fan_id: str, pct: float) -> None:
        raise NotImplementedError

    def restore_auto(self) -> None:
        pass

    def extra_hwmon(self, name: str) -> Optional[Path]:
        return find_hwmon(name)


class AcerNitroEcBackend(FanBackend):
    name = BACKEND_EC

    def __init__(self, ec: Path):
        self.ec = ec

    def read_temps(self) -> Dict[str, Optional[float]]:
        return {
            "cpu": _read_temp_c(self.ec / "temp1_input"),
            "gpu": _read_temp_c(self.ec / "temp2_input"),
            "sys": _read_temp_c(self.ec / "temp3_input"),
        }

    def read_pwm_pct(self, fan_id: str) -> Optional[float]:
        raw = _read_int(self.ec / f"pwm{fan_id}")
        if raw is None:
            return None
        return float(pwm_to_pct(raw))

    def read_fan_rpm(self, fan_id: str) -> Optional[int]:
        raw = _read_int(self.ec / f"fan{fan_id}_input")
        if raw is None or raw < 0:
            return None
        return raw

    def write_pwm_pct(self, fan_id: str, pct: float) -> None:
        _write_int(self.ec / f"pwm{fan_id}_enable", 1)
        _write_int(self.ec / f"pwm{fan_id}", pct_to_pwm(pct))

    def restore_auto(self) -> None:
        for n in ("1", "2"):
            for mode in ("2", "0"):
                try:
                    (self.ec / f"pwm{n}_enable").write_text(mode)
                    break
                except OSError:
                    continue


class NbfcBackend(FanBackend):
    name = BACKEND_NBFC

    def __init__(self, sock_path: Path, cache_ttl: float = 0.4):
        self.sock_path = sock_path
        self.cache_ttl = cache_ttl
        self._cache: Optional[dict] = None
        self._cache_at = 0.0

    def _request(self, payload: dict) -> dict:
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8") + NBFC_END
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            sock.settimeout(1.5)
            sock.connect(os.fspath(self.sock_path))
            sock.sendall(data)
            chunks = []
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                chunks.append(chunk)
                blob = b"".join(chunks)
                if NBFC_END in blob:
                    break
        finally:
            sock.close()
        blob = b"".join(chunks)
        marker = blob.find(NBFC_END)
        if marker < 0:
            raise RuntimeError("nbfc: brak znacznika END w odpowiedzi")
        parsed = json.loads(blob[:marker].decode("utf-8"))
        if not isinstance(parsed, dict):
            raise RuntimeError("nbfc: odpowiedź nie jest obiektem JSON")
        if parsed.get("Error"):
            raise RuntimeError(f"nbfc: {parsed['Error']}")
        return parsed

    def _status(self, force: bool = False) -> dict:
        now = time.monotonic()
        if not force and self._cache is not None and now - self._cache_at < self.cache_ttl:
            return self._cache
        status = self._request({"Command": "status"})
        self._cache = status
        self._cache_at = now
        return status

    def _fan(self, status: dict, fan_id: str) -> Optional[dict]:
        fans = status.get("Fans") or []
        idx = DAEMON_TO_NBFC.get(str(fan_id))
        if idx is None or idx >= len(fans):
            return None
        entry = fans[idx]
        return entry if isinstance(entry, dict) else None

    def read_temps(self) -> Dict[str, Optional[float]]:
        try:
            status = self._status()
        except (OSError, RuntimeError, ValueError):
            return {"cpu": None, "gpu": None, "sys": None}
        cpu = self._fan(status, "1")
        gpu = self._fan(status, "2")
        return {
            "cpu": _as_float(cpu.get("Temperature") if cpu else None),
            "gpu": _as_float(gpu.get("Temperature") if gpu else None),
            "sys": None,
        }

    def read_pwm_pct(self, fan_id: str) -> Optional[float]:
        try:
            status = self._status()
        except (OSError, RuntimeError, ValueError):
            return None
        fan = self._fan(status, fan_id)
        if not fan:
            return None
        return _as_float(fan.get("CurrentSpeed"))

    def write_pwm_pct(self, fan_id: str, pct: float) -> None:
        idx = DAEMON_TO_NBFC.get(str(fan_id))
        if idx is None:
            return
        self._request({"Command": "set-fan-speed", "Fan": idx, "Speed": float(pct)})
        self._cache = None

    def restore_auto(self) -> None:
        try:
            self._request({"Command": "set-fan-speed", "Speed": "auto"})
        except (OSError, RuntimeError, ValueError):
            pass
        self._cache = None


def _as_float(value) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def valid_chip_temp(temp) -> bool:
    """Odrzuca None, śmieci i wartości poza zakresem żywego chipa."""
    if temp is None:
        return False
    try:
        value = float(temp)
    except (TypeError, ValueError):
        return False
    return TEMP_MIN_VALID <= value <= TEMP_MAX_VALID


def pick_cpu_temp(ec_temp, package_temp) -> Optional[float]:
    """CPU: krzem (coretemp Package) przed termistorem EC 0xB0.

    Na AN515-54 EC temp1 skacze o kilkanaście °C z sekundy na sekundę
    i nie nadaje się do sterowania. Package id 0 to rzeczywista temperatura
    krzemu. EC zostaje tylko gdy coretemp nie żyje.
    """
    if valid_chip_temp(package_temp):
        return float(package_temp)
    if valid_chip_temp(ec_temp):
        return float(ec_temp)
    return None


def pick_gpu_temp(ec_temp, acer_temp, nvidia_temp) -> Optional[float]:
    """GPU: dioda NVIDIA, potem acer-wmi temp2, na końcu EC 0xB6.

    NIE bierz max() z tych źródeł. Na AN515-54 acer_nitro_ec temp2 (0xB6)
    potrafi stać w miejscu (np. 59°C) podczas gdy nvidia-smi i acer-wmi
    temp2 zgodnie pokazują ~54°C. Max() zawsze wygrywa ten zacięty odczyt.
    """
    for candidate in (nvidia_temp, acer_temp, ec_temp):
        if valid_chip_temp(candidate):
            return float(candidate)
    return None


def read_nvidia_gpu_temp() -> Optional[float]:
    """Temperatura die GPU z nvidia-smi (cache ~0.8 s)."""
    global _nvidia_cache
    now = time.monotonic()
    if _nvidia_cache is not None:
        cached, stamped = _nvidia_cache
        ttl = _NVIDIA_TTL if cached is not None else _NVIDIA_MISS_TTL
        if now - stamped < ttl:
            return cached
    value = _nvidia_smi_query_temp()
    _nvidia_cache = (value, now)
    return value


def _nvidia_smi_query_temp() -> Optional[float]:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        result = subprocess.run(
            [exe, "--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=0.7,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0 or not result.stdout.strip():
        return None
    try:
        return float(result.stdout.strip().splitlines()[0].split(",")[0])
    except (ValueError, IndexError):
        return None


def read_chip_temps(backend: FanBackend) -> Dict[str, Optional[float]]:
    """Jedno źródło prawdy dla daemona i GUI: krzem przed EC."""
    ec = backend.read_temps()
    core = backend.extra_hwmon("coretemp")
    acer = backend.extra_hwmon("acer")
    package = _read_temp_c(core / "temp1_input") if core else None
    acer_gpu = _read_temp_c(acer / "temp2_input") if acer else None
    nvidia = read_nvidia_gpu_temp()
    sys_temp = ec.get("sys")
    return {
        "cpu": pick_cpu_temp(ec.get("cpu"), package),
        "gpu": pick_gpu_temp(ec.get("gpu"), acer_gpu, nvidia),
        "sys": float(sys_temp) if valid_chip_temp(sys_temp) else None,
    }


def detect_backend(preferred: str = BACKEND_AUTO) -> Tuple[FanBackend, str]:
    """Zwraca (backend, powód wyboru). Rzuca RuntimeError gdy nic nie pasuje."""
    pref = (preferred or BACKEND_AUTO).strip().lower()
    if pref not in VALID_BACKENDS:
        pref = BACKEND_AUTO

    ec = find_hwmon(BACKEND_EC)
    nbfc = nbfc_socket_path()

    if pref == BACKEND_EC:
        if not ec:
            raise RuntimeError("backend=acer_nitro_ec, ale brak hwmon acer_nitro_ec")
        return AcerNitroEcBackend(ec), "config: acer_nitro_ec"
    if pref == BACKEND_NBFC:
        if not nbfc:
            raise RuntimeError("backend=nbfc, ale brak gniazda nbfc_service")
        return NbfcBackend(nbfc), "config: nbfc"

    if ec:
        reason = "auto: acer_nitro_ec"
        if nbfc:
            reason += " (nbfc_service wykryty — nie używam, żeby nie dublować zapisu EC)"
        return AcerNitroEcBackend(ec), reason
    if nbfc:
        return NbfcBackend(nbfc), "auto: nbfc_service (brak acer_nitro_ec)"
    raise RuntimeError(
        "brak backendu: załaduj acer_nitro_ec albo uruchom nbfc_service "
        "(sudo ./acer-nitro-ec/apply.sh albo sudo ./nbfc/install-nbfc-config.sh)"
    )


def detect_from_config(config_path: Optional[Path] = None) -> Tuple[FanBackend, str]:
    return detect_backend(read_config_backend(config_path))


if __name__ == "__main__":
    try:
        backend, why = detect_from_config()
    except RuntimeError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
    print(f"{backend.name}: {why}")
