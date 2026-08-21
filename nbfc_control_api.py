#!/usr/bin/env python3
"""Most stdio JSON między GUI Electron a konfiguracją / odczytami wentylatorów.

Nazwa pliku jest historyczna (fork keizenx). To nie jest klient usługi NBFC.
Backend I/O: fan_backend.py (acer_nitro_ec albo nbfc-linux).
"""

import subprocess
import time
import json
import sys
import threading
import signal
import logging
import shutil
import os
from typing import Dict, List, Optional, Tuple, Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fan_backend import (  # noqa: E402
    atomic_write_json,
    detect_from_config,
    read_chip_temps,
    read_json_limited,
)

# Configure logging to stderr to avoid polluting stdout (where JSON is expected)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[logging.StreamHandler(sys.stderr)]
)
logger = logging.getLogger('NBFCController')

# Podłoga PWM w trybie manualnym (zgodna z nitro_fan_daemon.MIN_PCT_*)
MIN_PCT_CPU = 30.0
MIN_PCT_GPU = 30.0
SPEED_OFFSET_MIN = -50.0
SPEED_OFFSET_MAX = 50.0


def clamp_manual_speed(fan_id: int, speed_percent: float) -> float:
    """Ogranicza prędkość do 0–100% i stosuje podłogę 30% (CPU i GPU) w trybie manualnym."""
    speed = max(0.0, min(100.0, float(speed_percent)))
    floor = MIN_PCT_CPU if int(fan_id) == 0 else MIN_PCT_GPU
    return max(floor, speed)


def clamp_speed_offset(value: float) -> float:
    """Offset CPU vs GPU (−50…+50): + = CPU szybszy, − = GPU szybszy."""
    try:
        return max(SPEED_OFFSET_MIN, min(SPEED_OFFSET_MAX, float(value)))
    except (TypeError, ValueError):
        return 0.0


def effective_manual_speeds(base_cpu: float, base_gpu: float, offset: float) -> tuple:
    """Baza z configu + offset → rzeczywiste cele PWM (jak daemon w manual)."""
    base_cpu = clamp_manual_speed(0, base_cpu)
    base_gpu = clamp_manual_speed(1, base_gpu)
    if abs(offset) < 0.01:
        return base_cpu, base_gpu
    base = base_cpu
    if offset > 0:
        return clamp_manual_speed(0, base + offset), clamp_manual_speed(1, base)
    return clamp_manual_speed(0, base), clamp_manual_speed(1, base - offset)


class NBFCController:
    def __init__(
        self,
        max_rpm: int = 6100,
        config_path: Optional[str] = None,
        fallback_config_path: Optional[str] = None,
    ):
        # max_rpm to adaptacyjny sufit obrotów na bieżącą sesję — realny fan1
        # przy 100% duty daje ~6122 RPM, fan2 ~5882 RPM (krok 1).
        # Rośnie wraz z najwyższym zaobserwowanym odczytem.
        self.max_rpm = max_rpm
        self.dynamic_mode = False
        self.current_profile = "Silent"
        self.auto_logging = True
        self._last_log_time = 0.0
        self._fan_backend = None
        self._fan_backend_reason = None
        self._prev_cpu_idle: int = 0
        self._prev_cpu_total: int = 0

        # Profile jako dedykowane krzywe obrotów — osobno dla CPU i GPU
        self.profiles: Dict[str, Dict[str, List[Tuple[float, float]]]] = {
            # Te same temperatury we wszystkich profilach (45/55/65/75/85).
            # Te same progi temperatur; profile różnią się tylko %.
            "Silent": {
                "cpu": [
                    (45.0, 30.0),
                    (55.0, 30.0),
                    (65.0, 30.0),
                    (75.0, 42.0),
                    (85.0, 65.0)
                ],
                "gpu": [
                    (45.0, 30.0),
                    (55.0, 30.0),
                    (65.0, 30.0),
                    (75.0, 42.0),
                    (85.0, 65.0)
                ]
            },
            "Balanced": {
                "cpu": [
                    (45.0, 30.0),
                    (55.0, 32.0),
                    (65.0, 42.0),
                    (75.0, 62.0),
                    (85.0, 100.0)
                ],
                "gpu": [
                    (45.0, 30.0),
                    (55.0, 32.0),
                    (65.0, 42.0),
                    (75.0, 62.0),
                    (85.0, 100.0)
                ]
            },
            "Turbo": {
                "cpu": [
                    (45.0, 45.0),
                    (55.0, 60.0),
                    (65.0, 80.0),
                    (75.0, 95.0),
                    (85.0, 100.0)
                ],
                "gpu": [
                    (45.0, 45.0),
                    (55.0, 60.0),
                    (65.0, 80.0),
                    (75.0, 95.0),
                    (85.0, 100.0)
                ]
            }
        }
        # manual_base = suwak Master; target_speeds = efektywne PWM (baza ± offset)
        self.manual_base = 50.0
        self.target_speeds = {'0': 50.0, '1': 50.0}
        # Offset CPU vs GPU (+ = boost CPU, − = boost GPU)
        self.speed_offset = 0.0

        # Aktywne krzywe CPU/GPU (to, co idzie do daemona / liczenia Auto)
        self.curves: Dict[str, List[Tuple[float, float]]] = {
            fan: list(points) for fan, points in self.profiles["Silent"].items()
        }
        # Źródło aktywnej krzywej: "default" (profil Cichy/Normalny/Turbo)
        # albo "custom" (własne ustawienia użytkownika). Przełączenie na default
        # NIE kasuje custom_curves.
        self.curve_source = "default"
        # Własne krzywe per profil: { "Silent": {"cpu": [...], "gpu": [...]}, ... }
        self.custom_curves: Dict[str, Dict[str, List[Tuple[float, float]]]] = {}
        # Fabryczne profile (przed edycją użytkownika w Ustawieniach)
        self.factory_profiles: Dict[str, Dict[str, List[Tuple[float, float]]]] = {
            prof: {fan: list(pts) for fan, pts in fans.items()}
            for prof, fans in self.profiles.items()
        }

        # Docelowa lokalizacja configu to /etc/nitro-fan/config.json (czyta go
        # nitro_fan_daemon uruchomiony jako root). Na maszynie deweloperskiej
        # i przed instalacją ten plik zwykle nie istnieje, więc i odczyt, i
        # zapis mają fallback na lokalny nbfc_config.json obok skryptu.
        self.config_path = config_path or '/etc/nitro-fan/config.json'
        self.fallback_config_path = fallback_config_path or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), 'nbfc_config.json'
        )
        self.backend_pref = None
        self.load_config()

    @staticmethod
    def _parse_fan_points(points: Any) -> Optional[List[Tuple[float, float]]]:
        """Parsuje listę punktów [temp, speed] z JSON; None przy błędzie."""
        if not points or not isinstance(points, list) or len(points) < 2:
            return None
        try:
            out: List[Tuple[float, float]] = []
            for pair in points:
                t = float(pair[0])
                s = max(MIN_PCT_CPU, min(100.0, float(pair[1])))
                out.append((t, s))
            return sorted(out, key=lambda p: p[0])
        except (TypeError, ValueError, IndexError):
            return None

    def _copy_profile_defaults(self, profile: Optional[str] = None) -> Dict[str, List[Tuple[float, float]]]:
        """Głęboka kopia wbudowanych krzywych profilu (Cichy/Normalny/Turbo)."""
        p = profile or self.current_profile
        if p not in self.profiles:
            p = "Silent"
        return {fan: list(pts) for fan, pts in self.profiles[p].items()}

    def _serialize_fan_map(self, fan_map: Dict[str, List[Tuple[float, float]]]) -> Dict[str, List[List[float]]]:
        return {fan: [[t, s] for t, s in points] for fan, points in fan_map.items()}

    def _activate_curves_for_source(self) -> None:
        """Ustawia self.curves wg curve_source. Custom nie jest kasowany przy default."""
        if self.curve_source == "custom":
            custom = self.custom_curves.get(self.current_profile)
            if custom and custom.get("cpu") and custom.get("gpu"):
                self.curves = {fan: list(pts) for fan, pts in custom.items()}
            else:
                # Brak zapisanych własnych — start od domyślnych (bez zapisu do custom)
                self.curves = self._copy_profile_defaults()
        else:
            self.curve_source = "default"
            self.curves = self._copy_profile_defaults()

    def load_config(self) -> None:
        """Wczytuje konfigurację z JSON: najpierw /etc/nitro-fan/config.json,
        a gdy ten nie istnieje — z lokalnego nbfc_config.json obok skryptu."""
        path = self.config_path if os.path.exists(self.config_path) else self.fallback_config_path
        if not os.path.exists(path):
            return
        try:
            config = read_json_limited(path)

            self.dynamic_mode = config.get('mode', 'dynamic') == 'dynamic'
            self.auto_logging = config.get('auto_logging', True)

            profile = config.get('profile')
            if profile in self.profiles:
                self.current_profile = profile

            # Edytowalne domyślne krzywe per profil (Ustawienia → Zmień domyślne)
            raw_defaults = config.get('default_profiles') or config.get('profile_defaults')
            if isinstance(raw_defaults, dict):
                for prof_name, fans in raw_defaults.items():
                    if prof_name not in self.profiles or not isinstance(fans, dict):
                        continue
                    parsed_cpu = self._parse_fan_points(fans.get('cpu'))
                    parsed_gpu = self._parse_fan_points(fans.get('gpu'))
                    if parsed_cpu and parsed_gpu:
                        self.profiles[prof_name] = {
                            'cpu': parsed_cpu,
                            'gpu': parsed_gpu,
                        }

            # Własne krzywe (per profil) — nie nadpisują defaults profilu
            raw_custom = config.get('custom_curves')
            if isinstance(raw_custom, dict):
                # Migracja: stary format płaski {cpu, gpu} → pod aktualny profil
                if 'cpu' in raw_custom or 'gpu' in raw_custom:
                    parsed_cpu = self._parse_fan_points(raw_custom.get('cpu'))
                    parsed_gpu = self._parse_fan_points(raw_custom.get('gpu'))
                    if parsed_cpu and parsed_gpu:
                        self.custom_curves[self.current_profile] = {
                            'cpu': parsed_cpu,
                            'gpu': parsed_gpu,
                        }
                else:
                    for prof_name, fans in raw_custom.items():
                        if prof_name not in self.profiles or not isinstance(fans, dict):
                            continue
                        parsed_cpu = self._parse_fan_points(fans.get('cpu'))
                        parsed_gpu = self._parse_fan_points(fans.get('gpu'))
                        if parsed_cpu and parsed_gpu:
                            self.custom_curves[prof_name] = {
                                'cpu': parsed_cpu,
                                'gpu': parsed_gpu,
                            }

            src = str(config.get('curve_source', 'default')).lower()
            self.curve_source = 'custom' if src == 'custom' else 'default'

            # Aktywne curves z pliku (jeśli są) albo z wybranego źródła
            curves = config.get('curves')
            if curves and isinstance(curves, dict):
                parsed_active = {}
                for fan_key in ('cpu', 'gpu'):
                    pts = self._parse_fan_points(curves.get(fan_key))
                    if pts:
                        parsed_active[fan_key] = pts
                if len(parsed_active) == 2:
                    self.curves = parsed_active
                else:
                    self._activate_curves_for_source()
            elif config.get('fan_curve'):
                legacy_curve = self._parse_fan_points(config['fan_curve'])
                if legacy_curve:
                    self.curves = {'cpu': list(legacy_curve), 'gpu': list(legacy_curve)}
                else:
                    self._activate_curves_for_source()
            else:
                self._activate_curves_for_source()

            # Spójność: w trybie default zawsze wbudowane profile
            if self.curve_source == 'default':
                self.curves = self._copy_profile_defaults()

            if 'backend' in config:
                self.backend_pref = config.get('backend')

            if 'speed_offset' in config:
                self.speed_offset = clamp_speed_offset(config.get('speed_offset', 0))

            speeds = config.get('manual_speeds') or {}
            if 'manual_base' in config:
                self.manual_base = clamp_manual_speed(0, float(config['manual_base']))
            elif '0' in speeds:
                # Migracja: gdy brak manual_base, baza ≈ min(cpu,gpu) lub cpu
                try:
                    self.manual_base = clamp_manual_speed(0, float(speeds.get('0', 50.0)))
                except (TypeError, ValueError):
                    self.manual_base = 50.0
            # Offset != 0: cele z bazy Master. Offset 0: niezależne CPU/GPU;
            # manual_base zostaje ostatnią wartością suwaka Master (nie min()).
            if abs(self.speed_offset) >= 0.01:
                self._sync_effective_speeds()
            else:
                for fan_id in ('0', '1'):
                    if fan_id in speeds:
                        self.target_speeds[fan_id] = clamp_manual_speed(int(fan_id), float(speeds[fan_id]))
        except Exception as e:
            logger.error(f"Error loading config: {e}")

    def _sync_effective_speeds(self) -> None:
        """Przelicza target_speeds z manual_base + speed_offset (do configu i GUI)."""
        cpu_e, gpu_e = effective_manual_speeds(
            self.manual_base, self.manual_base, self.speed_offset
        )
        self.target_speeds['0'] = cpu_e
        self.target_speeds['1'] = gpu_e

    def save_config(self) -> None:
        """Zapisuje konfigurację do JSON (czyta ją nitro_fan_daemon). Próbuje
        /etc/nitro-fan/config.json; gdy brak uprawnień (PermissionError/
        OSError — typowe na maszynie deweloperskiej), zapisuje lokalnie do
        nbfc_config.json obok skryptu i loguje ostrzeżenie zamiast się wywalić.

        manual_speeds = efektywne PWM (daemon w manual pisze je wprost na wentylatory).
        Nie przeliczaj tu z manual_base — to zrównywałoby CPU i GPU przy każdym
        zapisie (krzywa, tryb, jeden suwak). Sync robi Master / offset.
        """
        payload = {
            'mode': 'dynamic' if self.dynamic_mode else 'manual',
            'profile': self.current_profile,
            'auto_logging': self.auto_logging,
            'speed_offset': self.speed_offset,
            'manual_base': self.manual_base,
            'curve_source': self.curve_source,
            # Aktywna krzywa (daemon / Auto)
            'curves': self._serialize_fan_map(self.curves),
            # Domyślne krzywe per profil (edytowalne w Ustawieniach)
            'default_profiles': {
                prof: self._serialize_fan_map(fans)
                for prof, fans in self.profiles.items()
            },
            # Własne krzywe per profil — zachowane niezależnie od default
            'custom_curves': {
                prof: self._serialize_fan_map(fans)
                for prof, fans in self.custom_curves.items()
            },
            'manual_speeds': {
                '0': self.target_speeds['0'],
                '1': self.target_speeds['1'],
            },
        }
        if self.backend_pref:
            payload['backend'] = self.backend_pref
        try:
            atomic_write_json(self.config_path, payload)
        except (PermissionError, OSError) as e:
            logger.warning(f"Brak dostępu do {self.config_path} ({e}); zapisuję lokalnie do {self.fallback_config_path}")
            try:
                atomic_write_json(self.fallback_config_path, payload)
            except Exception as e2:
                logger.error(f"Error saving fallback config: {e2}")
        except Exception as e:
            logger.error(f"Error saving config: {e}")
            
    def _run_command(self, cmd: List[str], timeout: float = 3.0) -> Optional[str]:
        """Execute a system command and return stdout, or None on failure/timeout."""
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, check=True, timeout=timeout
            )
            return result.stdout.strip()
        except subprocess.CalledProcessError as e:
            logger.debug(f"Error executing {' '.join(cmd)}: {e}")
            return None
        except subprocess.TimeoutExpired:
            logger.warning(f"Command timed out after {timeout}s: {' '.join(cmd)}")
            return None
        except FileNotFoundError:
            logger.debug(f"Command not found: {cmd[0]}")
            return None
            
    def _read_file_content(self, path: str) -> Optional[str]:
        """Read content from a system file directly"""
        try:
            with open(path, 'r') as f:
                return f.read().strip()
        except Exception as e:
            logger.debug(f"Error reading file {path}: {e}")
            return None

    def _parse_sensors_output(self) -> Tuple[float, float, int, int, Dict[str, str]]:
        """Parses `sensors` output. Returns (cpu_temp, gpu_temp, cpu_rpm, gpu_rpm, sensor_data_dict)"""
        cpu_temp, gpu_temp = 0.0, 0.0
        cpu_rpm, gpu_rpm = 0, 0
        sensor_data: Dict[str, str] = {}
        
        sensors_output = self._run_command(['sensors'])
        if not sensors_output:
            return cpu_temp, gpu_temp, cpu_rpm, gpu_rpm, sensor_data
            
        cpu_temps = []
        package_temp = 0.0
        
        current_adapter = ""
        for line in sensors_output.split('\n'):
            line = line.strip()
            if not line:
                continue
                
            if not ':' in line and not line.startswith('Adapter') and not line.startswith(' '):
                if not line.startswith('Package') and not line.startswith('Core'):
                    current_adapter = line.split('-')[0] # just use the base name like 'nvme' or 'acer'
                
            # Extract RPMs
            if 'fan1:' in line and 'RPM' in line:
                parts = line.split(':')[1].strip().split()
                if parts and parts[0].isdigit():
                    cpu_rpm = int(parts[0])
            elif 'fan2:' in line and 'RPM' in line:
                parts = line.split(':')[1].strip().split()
                if parts and parts[0].isdigit():
                    gpu_rpm = int(parts[0])
                    
            # Extract Temps
            if 'Package id 0' in line and '°C' in line:
                try:
                    temp_str = line.split('+')[1].split('°C')[0]
                    package_temp = float(temp_str)
                except (IndexError, ValueError):
                    pass
            elif 'Core' in line and '°C' in line:
                try:
                    temp_str = line.split('+')[1].split('°C')[0]
                    cpu_temps.append(float(temp_str))
                except (IndexError, ValueError):
                    pass
            # GPU nie zbieramy z dowolnego „temp2” (NVMe/EC/acer-wmi).
            # get_fan_status bierze die NVIDIA albo acer-wmi, nie max() z EC.
                    
            # Raw sensor data
            if ':' in line and not line.startswith('Adapter'):
                try:
                    key = line.split(':')[0].strip()
                    value = line.split(':', 1)[1].strip()
                    sensor_key = f"{current_adapter} {key}".strip()
                    # Prevent overwriting if we have multiple adapters of the same type (e.g. two nvme drives)
                    original_key = sensor_key
                    counter = 1
                    while sensor_key in sensor_data:
                        sensor_key = f"{original_key} {counter}"
                        counter += 1
                    sensor_data[sensor_key] = value
                except Exception:
                    pass
                    
        if package_temp > 0:
            cpu_temp = package_temp
        elif cpu_temps:
            cpu_temp = max(cpu_temps)
            
        return cpu_temp, gpu_temp, cpu_rpm, gpu_rpm, sensor_data

    def _read_sysfs_temperatures(self, cpu_temp: float, gpu_temp: float) -> Tuple[float, float]:
        """Ostatni fallback: tylko strefy o znanym typie, nigdy po numerze.

        thermal_zone0 na tym laptopie to PCH (~70°C), zone1 to package CPU.
        Podpinanie ich jako CPU/GPU dawało fałszywe odczyty.
        """
        if cpu_temp <= 0:
            for zone in sorted(os.listdir('/sys/class/thermal')) if os.path.isdir('/sys/class/thermal') else []:
                if not zone.startswith('thermal_zone'):
                    continue
                zpath = os.path.join('/sys/class/thermal', zone)
                ztype = self._read_file_content(os.path.join(zpath, 'type')) or ''
                if ztype.strip() != 'x86_pkg_temp':
                    continue
                val = self._read_file_content(os.path.join(zpath, 'temp'))
                if val:
                    try:
                        cpu_temp = float(val) / 1000.0
                    except ValueError:
                        pass
                break
        return cpu_temp, gpu_temp
        
    def _get_fan_backend(self):
        """Wykryj backend raz (acer_nitro_ec albo nbfc) i zapamiętaj."""
        if self._fan_backend is False:
            return None
        if self._fan_backend is not None:
            return self._fan_backend
        try:
            backend, why = detect_from_config()
            self._fan_backend = backend
            self._fan_backend_reason = why
            logger.info("Fan backend: %s (%s)", backend.name, why)
        except RuntimeError as exc:
            logger.warning("Brak backendu wentylatorów: %s", exc)
            self._fan_backend = False
            return None
        return self._fan_backend

    def _find_ec_hwmon(self) -> Optional[str]:
        """Katalog hwmon acer_nitro_ec — tylko gdy backend to sterownik jądra."""
        backend = self._get_fan_backend()
        if backend is None or backend.name != "acer_nitro_ec":
            return None
        path = getattr(backend, "ec", None)
        return str(path) if path else None

    def _update_max_rpm(self, observed_rpm: int) -> None:
        """Adaptacyjny sufit RPM: rośnie do najwyższego zaobserwowanego w tej
        sesji odczytu i nigdy nie spada poniżej 4500 (zamiast zaszytej stałej)."""
        self.max_rpm = max(self.max_rpm, observed_rpm, 4500)

    def _read_pwm_status(self, fans: Dict[str, Any]) -> None:
        """Nadpisuje duty (%) z aktywnego backendu (hwmon pwm albo nbfc)."""
        backend = self._get_fan_backend()
        if backend is None:
            return
        for api_id, daemon_id in [('0', '1'), ('1', '2')]:
            pct = backend.read_pwm_pct(daemon_id)
            if pct is not None:
                fans[api_id]['speed'] = round(float(pct), 1)

    def get_fan_status(self) -> Dict[str, Any]:
        """Zwraca połączony stan wiatraków. Gdy odczyt się nie uda, pole
        zostaje None (JSON null) — GUI ma pokazać brak danych zamiast
        zmyślonej wartości."""
        fans = {
            '0': {'name': 'CPU Fan', 'speed': None, 'rpm': None, 'temperature': None},
            '1': {'name': 'GPU Fan', 'speed': None, 'rpm': None, 'temperature': None},
            'sensor_data': {}
        }

        _, _, cpu_rpm, gpu_rpm, sensor_data = self._parse_sensors_output()

        backend = self._get_fan_backend()
        if backend:
            chips = read_chip_temps(backend)
            if chips.get('cpu') is not None:
                fans['0']['temperature'] = chips['cpu']
            if chips.get('gpu') is not None:
                fans['1']['temperature'] = chips['gpu']
            for api_id, daemon_id in (('0', '1'), ('1', '2')):
                rpm = backend.read_fan_rpm(daemon_id)
                if rpm is not None:
                    fans[api_id]['rpm'] = rpm
                    if rpm > 0:
                        self._update_max_rpm(rpm)
        else:
            cpu_temp, gpu_temp = self._read_sysfs_temperatures(0.0, 0.0)
            if cpu_temp > 0:
                fans['0']['temperature'] = cpu_temp
            if gpu_temp > 0:
                fans['1']['temperature'] = gpu_temp

        if fans['0']['rpm'] is None and cpu_rpm > 0:
            self._update_max_rpm(cpu_rpm)
            fans['0']['rpm'] = cpu_rpm
        if fans['1']['rpm'] is None and gpu_rpm > 0:
            self._update_max_rpm(gpu_rpm)
            fans['1']['rpm'] = gpu_rpm

        fans['sensor_data'] = sensor_data

        # Duty z PWM — nie zgadujemy % z RPM (max_rpm jest adaptacyjny
        # i zaniżałby wskazanie przy zimnym starcie).
        self._read_pwm_status(fans)

        return fans

    def set_fan_speed(self, fan_id: int, speed_percent: float) -> bool:
        """Ustawia jeden wentylator (offset=0) albo bazę Master (offset != 0).

        fan_id 0 = CPU, fan_id 1 = GPU. Przy offsecie GPU jest powiązany.
        """
        speed = clamp_manual_speed(fan_id, speed_percent)
        fid = int(fan_id)
        if abs(self.speed_offset) >= 0.01:
            if fid == 1:
                logger.info(
                    "GPU slider ignored (offset=%s); use Master/CPU or offset",
                    self.speed_offset,
                )
                return True
            if self.speed_offset > 0.01:
                speed = clamp_manual_speed(0, speed - self.speed_offset)
            self.manual_base = speed
            self._sync_effective_speeds()
        else:
            # Nie ruszaj manual_base — inaczej Master w GUI jedzie za CPU/GPU.
            self.target_speeds[str(fid)] = speed
        self.save_config()
        logger.info(
            f"Fan {fid} -> base={self.manual_base} offset={self.speed_offset} "
            f"CPU={self.target_speeds['0']} GPU={self.target_speeds['1']}"
        )
        return True

    def set_all_fans_speed(self, speed_percent: float) -> bool:
        """Master = baza; manual_speeds dostają efektywne PWM (baza ± offset)."""
        self.manual_base = clamp_manual_speed(0, speed_percent)
        self._sync_effective_speeds()
        self.save_config()
        logger.info(
            f"Master base={self.manual_base} offset={self.speed_offset} "
            f"-> CPU={self.target_speeds['0']} GPU={self.target_speeds['1']}"
        )
        return True

    def set_speed_offset(self, offset: float) -> None:
        """Offset CPU vs GPU (−50…+50): + dodaje do CPU, − dodaje do GPU.

        Przelicza manual_speeds na efektywne PWM i zapisuje config — daemon
        (nawet stary) w trybie manual od razu ustawi wentylatory.
        """
        self.speed_offset = clamp_speed_offset(offset)
        if abs(self.speed_offset) >= 0.01:
            self._sync_effective_speeds()
        self.save_config()
        logger.info(
            f"Speed offset={self.speed_offset} base={self.manual_base} "
            f"-> CPU={self.target_speeds['0']} GPU={self.target_speeds['1']}"
        )

    def apply_profile(self, profile_name: str) -> bool:
        """Przełącza profil (Silent/Balanced/Turbo).
        W trybie default ładuje wbudowane krzywe.
        W trybie custom ładuje własne dla tego profilu (jeśli są) —
        bez kasowania custom innych profili.
        """
        if profile_name not in self.profiles:
            return False
        self.current_profile = profile_name
        self.dynamic_mode = True
        self._activate_curves_for_source()
        self.save_config()
        logger.info(
            f"Applied profile {profile_name} source={self.curve_source}: {self.curves}"
        )
        return True

    def set_curve_source(self, source: str) -> None:
        """Przełącza Domyślny / Własny. Default nie usuwa custom_curves."""
        src = str(source).strip().lower()
        if src not in ('default', 'custom'):
            raise ValueError(f"curve_source musi być 'default' albo 'custom', dostano {source!r}")
        self.curve_source = src
        self._activate_curves_for_source()
        self.save_config()
        logger.info(f"Curve source -> {self.curve_source} profile={self.current_profile}")

    def _normalize_curve_points(
        self, fan: str, points: List[Tuple[float, float]]
    ) -> List[Tuple[float, float]]:
        """Walidacja i normalizacja punktów krzywej (temp/speed + podłoga 30%)."""
        if fan not in ('cpu', 'gpu'):
            raise ValueError(f"nieznany wiatrak {fan!r} (oczekiwano 'cpu' albo 'gpu')")
        if len(points) < 2:
            raise ValueError("krzywa wymaga co najmniej 2 punktów")
        floor = MIN_PCT_CPU if fan == 'cpu' else MIN_PCT_GPU
        normalized = []
        for temp, speed in points:
            t = float(temp)
            s = float(speed)
            if not (0.0 <= t <= 110.0):
                raise ValueError(f"temperatura poza zakresem 0-110°C: {t}")
            if s < 0.0 or s > 100.0:
                raise ValueError(f"prędkość poza zakresem 0-100%: {s}")
            s = max(floor, min(100.0, s))
            normalized.append((t, s))
        return sorted(normalized)

    def set_default_curve(
        self, profile: str, fan: str, points: List[Tuple[float, float]]
    ) -> None:
        """Ustawia domyślną krzywą profilu (Cichy/Normalny/Turbo).
        Nie zmienia custom_curves. Gdy aktywny jest ten profil i źródło=default,
        od razu stosuje nową krzywą do daemona.
        """
        if profile not in self.profiles:
            raise ValueError(f"nieznany profil {profile!r}")
        sorted_points = self._normalize_curve_points(fan, points)
        if profile not in self.profiles:
            self.profiles[profile] = self._copy_profile_defaults(profile)
        self.profiles[profile][fan] = list(sorted_points)
        if self.current_profile == profile and self.curve_source == 'default':
            self.curves[fan] = list(sorted_points)
        self.save_config()
        logger.info(
            f"Updated default {fan} curve for profile={profile}: {sorted_points}"
        )

    @staticmethod
    def _fan_points_equal(
        a: List[Tuple[float, float]], b: List[Tuple[float, float]], tol: float = 0.05
    ) -> bool:
        if len(a) != len(b):
            return False
        for (t1, s1), (t2, s2) in zip(a, b):
            if abs(t1 - t2) > tol or abs(s1 - s2) > tol:
                return False
        return True

    def _profile_equals_factory(self, profile: str) -> bool:
        factory = self.factory_profiles.get(profile)
        current = self.profiles.get(profile)
        if not factory or not current:
            return False
        for fan in ('cpu', 'gpu'):
            if not self._fan_points_equal(current.get(fan, []), factory.get(fan, [])):
                return False
        return True

    def defaults_are_modified(self) -> bool:
        """True, gdy którykolwiek profil ma domyślne krzywe inne niż fabryczne."""
        return any(not self._profile_equals_factory(p) for p in self.profiles)

    def reset_default_curves(self, profile: Optional[str] = None) -> None:
        """Przywraca fabryczne domyślne krzywe (jeden profil albo wszystkie).
        Nie rusza custom_curves.
        """
        targets = [profile] if profile else list(self.factory_profiles.keys())
        for prof in targets:
            if prof not in self.factory_profiles:
                if profile:
                    raise ValueError(f"nieznany profil {prof!r}")
                continue
            self.profiles[prof] = {
                fan: list(pts) for fan, pts in self.factory_profiles[prof].items()
            }
            if self.current_profile == prof and self.curve_source == 'default':
                self.curves = {
                    fan: list(pts) for fan, pts in self.profiles[prof].items()
                }
        self.save_config()
        logger.info(f"Restored factory default curves for: {targets}")

    @property
    def fan_curve(self) -> List[Tuple[float, float]]:
        return self.curves.get('cpu', [])

    @fan_curve.setter
    def fan_curve(self, curve: List[Tuple[float, float]]) -> None:
        self.curves['cpu'] = list(curve)
        self.curves['gpu'] = list(curve)

    def set_mode(self, is_dynamic: bool) -> None:
        """Set fan control mode (dynamic or fixed)"""
        if self.dynamic_mode != is_dynamic:
            self.dynamic_mode = is_dynamic
            self.save_config()

    def set_auto_logging(self, enabled: bool) -> None:
        """Włącza lub wyłącza automatyczny zapis logów telemetrycznych"""
        if self.auto_logging != enabled:
            self.auto_logging = enabled
            self.save_config()
            logger.info(f"Auto logging set to {enabled}")

    def _telemetry_log_candidates(self) -> List[str]:
        """Known telemetry.csv locations (system dir + user fallback)."""
        return [
            os.path.join('/var/log/nitro-fan', 'telemetry.csv'),
            os.path.join(os.path.expanduser('~/.config/nitro-fan'), 'telemetry.csv'),
        ]

    def _get_log_filepath(self) -> str:
        primary_dir = '/var/log/nitro-fan'
        fallback_dir = os.path.expanduser('~/.config/nitro-fan')
        target_dir = primary_dir
        try:
            os.makedirs(primary_dir, exist_ok=True)
            test_file = os.path.join(primary_dir, '.permtest')
            with open(test_file, 'w') as f:
                f.write('1')
            os.remove(test_file)
        except (PermissionError, OSError):
            target_dir = fallback_dir
            os.makedirs(fallback_dir, exist_ok=True)
        return os.path.join(target_dir, 'telemetry.csv')

    def clear_telemetry_logs(self) -> Dict[str, Any]:
        """Delete telemetry.csv from known locations. Recreated on next log write."""
        deleted = 0
        errors: List[str] = []
        seen = set()
        for path in self._telemetry_log_candidates():
            if path in seen:
                continue
            seen.add(path)
            try:
                if os.path.isfile(path):
                    os.remove(path)
                    deleted += 1
                    logger.info("Deleted telemetry log %s", path)
            except OSError as err:
                logger.error("Failed to delete telemetry log %s: %s", path, err)
                errors.append(str(err))
        result: Dict[str, Any] = {"ok": not errors, "deleted": deleted}
        if errors:
            result["error"] = errors[0]
        return result

    def _log_telemetry_row(self, data: Dict[str, Any]) -> None:
        if not self.auto_logging:
            return
        now = time.time()
        if now - self._last_log_time < 2.0:
            return
        self._last_log_time = now
        try:
            filepath = self._get_log_filepath()
            file_exists = os.path.exists(filepath) and os.path.getsize(filepath) > 0
            
            with open(filepath, 'a', encoding='utf-8') as f:
                if not file_exists:
                    f.write("timestamp,cpu_temp,gpu_temp,cpu_speed,gpu_speed,cpu_load,gpu_load,mode,profile\n")
                
                timestamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now))
                def _num(value, default=0.0):
                    return float(value) if isinstance(value, (int, float)) else default
                cpu_t = _num(data.get('cpu', {}).get('temperature'))
                gpu_t = _num(data.get('gpu', {}).get('temperature'))
                cpu_s = _num(data.get('cpu', {}).get('speed'))
                gpu_s = _num(data.get('gpu', {}).get('speed'))
                res = data.get('resources', {})
                cpu_l = res.get('cpu_load', 0.0)
                gpu_l = res.get('gpu_load', 0.0)
                mode = data.get('status', 'Dynamic')
                profile = data.get('profile', 'Silent')
                
                f.write(f"{timestamp},{cpu_t:.1f},{gpu_t:.1f},{cpu_s:.1f},{gpu_s:.1f},{cpu_l:.1f},{gpu_l:.1f},{mode},{profile}\n")
        except Exception as e:
            logger.debug(f"Error writing telemetry row: {e}")

    def set_curve(self, fan: str, points: List[Tuple[float, float]]) -> None:
        """Ustawia krzywą temperatura->obroty dla wskazanego wiatraka
        ('cpu' albo 'gpu'). Wymaga min. 2 punktów, sortuje po temperaturze i
        waliduje zakresy. Prędkość ma podłogę 30% (MIN_PCT_CPU/GPU).
        Nieprawidłowe dane -> ValueError. Zapisuje jako Własne (custom)."""
        if fan not in self.curves:
            raise ValueError(f"nieznany wiatrak {fan!r} (oczekiwano 'cpu' albo 'gpu')")
        sorted_points = self._normalize_curve_points(fan, points)
        self.curves[fan] = sorted_points
        # Zapis własny dla bieżącego profilu (defaulty profilu zostają nietknięte)
        if self.current_profile not in self.custom_curves:
            self.custom_curves[self.current_profile] = self._copy_profile_defaults()
        self.custom_curves[self.current_profile][fan] = list(sorted_points)
        self.curve_source = 'custom'
        self.save_config()
        logger.info(f"Updated {fan} custom curve (profile={self.current_profile}): {sorted_points}")

    def calculate_dynamic_speed(self, temperatures: List[float], curve_name: str = 'cpu') -> float:
        """Wylicza docelową prędkość interpolacją liniową na krzywej danego
        komponentu (curve_name: 'cpu' albo 'gpu'); bierze najwyższą z podanych
        temperatur, jeśli przekazano więcej niż jedną."""
        if not temperatures:
            return max(self.target_speeds.values())

        highest_temp = max(temperatures)

        # Krzywa wybranego komponentu (z fallbackiem na cpu, gdyby nazwa była zła)
        curve = self.curves.get(curve_name) or self.curves.get('cpu', [])

        if not curve:
            return max(self.target_speeds.values())

        # If temp is below the first point
        if highest_temp <= curve[0][0]:
            return curve[0][1]

        # If temp is above the last point
        if highest_temp >= curve[-1][0]:
            return curve[-1][1]

        # Interpolate between points
        for i in range(len(curve) - 1):
            t1, s1 = curve[i]
            t2, s2 = curve[i+1]

            if t1 <= highest_temp <= t2:
                # Linear interpolation formula: y = y1 + (x - x1) * (y2 - y1) / (x2 - x1)
                fraction = (highest_temp - t1) / (t2 - t1)
                speed = s1 + fraction * (s2 - s1)
                return speed

        return max(self.target_speeds.values())

    def get_hardware_info(self) -> Tuple[str, str]:
        """Get CPU and GPU model information"""
        cpu_model = "Unknown CPU"
        gpu_model = "Unknown GPU"
        
        cpu_info = self._read_file_content('/proc/cpuinfo')
        if cpu_info:
            for line in cpu_info.split('\n'):
                if 'model name' in line:
                    try:
                        cpu_model = line.split(':', 1)[1].strip()
                        break
                    except IndexError:
                        pass
                        
        gpu_info = self._run_command(['lspci', '-v'])
        if gpu_info:
            for line in gpu_info.split('\n'):
                if 'VGA' in line or 'NVIDIA' in line or 'AMD' in line:
                    try:
                        gpu_model = line.split(':', 1)[1].strip() if ':' in line else line.strip()
                        break
                    except IndexError:
                        pass
                        
        return cpu_model, gpu_model

    def _get_cpu_load(self) -> float:
        """Reads /proc/stat to calculate CPU load percentage based on previous state."""
        content = self._read_file_content('/proc/stat')
        if not content:
            return 0.0

        for line in content.splitlines():
            if line.startswith('cpu '):
                parts = line.split()
                if len(parts) >= 5:
                    try:
                        fields = [int(x) for x in parts[1:]]
                        idle = fields[3] + (fields[4] if len(fields) > 4 else 0)
                        total = sum(fields)

                        delta_idle = idle - self._prev_cpu_idle
                        delta_total = total - self._prev_cpu_total

                        self._prev_cpu_idle = idle
                        self._prev_cpu_total = total

                        if delta_total > 0:
                            cpu_load = max(0.0, min(100.0, (1.0 - (delta_idle / delta_total)) * 100.0))
                            return round(cpu_load, 1)
                    except (ValueError, IndexError):
                        pass
                break
        return 0.0

    def _get_cpu_freq_mhz(self) -> Tuple[Optional[float], Optional[float]]:
        """Średnie bieżące i maksymalne taktowanie CPU w MHz."""
        cpu_root = '/sys/devices/system/cpu'
        try:
            names = os.listdir(cpu_root)
        except OSError:
            return None, None

        freqs_khz = []
        max_khz = 0
        for name in names:
            if not name.startswith('cpu') or not name[3:].isdigit():
                continue
            raw = self._read_file_content(
                os.path.join(cpu_root, name, 'cpufreq', 'scaling_cur_freq')
            )
            if raw:
                try:
                    khz = int(raw)
                except ValueError:
                    khz = 0
                if khz > 0:
                    freqs_khz.append(khz)
            max_raw = self._read_file_content(
                os.path.join(cpu_root, name, 'cpufreq', 'cpuinfo_max_freq')
            )
            if max_raw:
                try:
                    mkhz = int(max_raw)
                except ValueError:
                    mkhz = 0
                if mkhz > max_khz:
                    max_khz = mkhz

        current = round((sum(freqs_khz) / len(freqs_khz)) / 1000.0, 0) if freqs_khz else None
        maximum = round(max_khz / 1000.0, 0) if max_khz > 0 else None
        return current, maximum

    def _get_ram_usage(self) -> Tuple[float, float]:
        """Reads /proc/meminfo to return (used_gb, total_gb)."""
        content = self._read_file_content('/proc/meminfo')
        if not content:
            return 0.0, 0.0

        mem_info = {}
        for line in content.splitlines():
            parts = line.split(':')
            if len(parts) == 2:
                key = parts[0].strip()
                val_parts = parts[1].strip().split()
                if val_parts and val_parts[0].isdigit():
                    mem_info[key] = int(val_parts[0])

        total_kb = mem_info.get('MemTotal', 0)
        if total_kb == 0:
            return 0.0, 0.0

        if 'MemAvailable' in mem_info:
            used_kb = total_kb - mem_info['MemAvailable']
        else:
            free_kb = mem_info.get('MemFree', 0)
            buffers_kb = mem_info.get('Buffers', 0)
            cached_kb = mem_info.get('Cached', 0)
            used_kb = total_kb - (free_kb + buffers_kb + cached_kb)

        used_gb = round(max(0.0, used_kb / (1024.0 * 1024.0)), 2)
        total_gb = round(total_kb / (1024.0 * 1024.0), 2)
        return used_gb, total_gb

    def _get_gpu_load(self) -> Tuple[float, float, float]:
        """Uses nvidia-smi to return (gpu_load_pct, vram_used_gb, vram_total_gb)."""
        output = self._run_command([
            'nvidia-smi',
            '--query-gpu=utilization.gpu,utilization.memory,memory.total,memory.used',
            '--format=csv,noheader,nounits'
        ])
        if not output:
            return 0.0, 0.0, 0.0

        try:
            first_line = output.splitlines()[0]
            parts = [p.strip() for p in first_line.split(',')]
            if len(parts) >= 4:
                gpu_load_pct = float(parts[0])
                vram_total_mb = float(parts[2])
                vram_used_mb = float(parts[3])

                vram_used_gb = round(vram_used_mb / 1024.0, 2)
                vram_total_gb = round(vram_total_mb / 1024.0, 2)
                return gpu_load_pct, vram_used_gb, vram_total_gb
        except (ValueError, IndexError) as e:
            logger.debug(f"Error parsing nvidia-smi output: {e}")

        return 0.0, 0.0, 0.0

    def update_loop(self) -> None:
        """Main loop: reading sensors, applying curve, and printing JSON state to stdout"""
        cpu_model, gpu_model = self.get_hardware_info()
        logger.info(f"Hardware detected: CPU={cpu_model}, GPU={gpu_model}")
        
        last_temps = {'0': 0.0, '1': 0.0}
        last_rpms = {'0': 0, '1': 0}

        while True:
            try:
                fans = self.get_fan_status()
                cpu_fan = fans['0']
                gpu_fan = fans['1']

                # Lekkie wygładzenie tylko prawdziwych odczytów.
                # Brak danych zostaje None — nigdy 40°C / 2200 RPM / +0.5°C „dla urody”.
                for fan_id, fan_data in [('0', cpu_fan), ('1', gpu_fan)]:
                    current_temp = fan_data.get('temperature')
                    current_rpm = fan_data.get('rpm')

                    if isinstance(current_temp, (int, float)) and current_temp > 0:
                        if last_temps[fan_id] <= 0:
                            last_temps[fan_id] = current_temp
                        else:
                            fan_data['temperature'] = current_temp * 0.7 + last_temps[fan_id] * 0.3
                            last_temps[fan_id] = fan_data['temperature']
                    else:
                        fan_data['temperature'] = None

                    if isinstance(current_rpm, (int, float)) and current_rpm >= 0:
                        if last_rpms[fan_id] <= 0:
                            last_rpms[fan_id] = int(current_rpm)
                        else:
                            fan_data['rpm'] = int(current_rpm * 0.7 + last_rpms[fan_id] * 0.3)
                            last_rpms[fan_id] = fan_data['rpm']
                    else:
                        fan_data['rpm'] = None

                # NIE nadpisuj target_speeds / manual_base w pętli — to psuje
                # zapis offsetu i bazy (wcześniej dynamic_mode zerował ręcznie ustawienia).
                preview_speed = None
                if self.dynamic_mode:
                    temps = [
                        t for t in (cpu_fan.get('temperature'), gpu_fan.get('temperature'))
                        if isinstance(t, (int, float)) and t > 0
                    ]
                    if temps:
                        preview_speed = self.calculate_dynamic_speed(temps)

                cpu_load = self._get_cpu_load()
                cpu_freq_mhz, cpu_freq_max_mhz = self._get_cpu_freq_mhz()
                ram_used, ram_total = self._get_ram_usage()
                gpu_load, vram_used, vram_total = self._get_gpu_load()
                    
                data = {
                    "cpu": {
                        "name": cpu_fan.get('name', 'CPU Fan'),
                        "speed": cpu_fan.get('speed'),
                        "rpm": cpu_fan.get('rpm'),
                        "temperature": cpu_fan.get('temperature')
                    },
                    "gpu": {
                        "name": gpu_fan.get('name', 'GPU Fan'),
                        "speed": gpu_fan.get('speed'),
                        "rpm": gpu_fan.get('rpm'),
                        "temperature": gpu_fan.get('temperature')
                    },
                    "fanSpeed": preview_speed if preview_speed is not None else max(self.target_speeds.values()),
                    "status": "Dynamic" if self.dynamic_mode else "Fixed",
                    "profile": self.current_profile,
                    "auto_logging": self.auto_logging,
                    "speed_offset": self.speed_offset,
                    "manual_base": self.manual_base,
                    # Efektywne PWM (to samo co w config.manual_speeds)
                    "manual_speeds": {
                        "0": self.target_speeds.get("0", 30.0),
                        "1": self.target_speeds.get("1", 30.0),
                    },
                    "manual_speeds_effective": {
                        "0": self.target_speeds.get("0", 30.0),
                        "1": self.target_speeds.get("1", 30.0),
                    },
                    "hardware": {
                        "cpu_model": cpu_model,
                        "gpu_model": gpu_model
                    },
                    "curve": self.fan_curve,
                    "curves": self._serialize_fan_map(self.curves),
                    "curve_source": self.curve_source,
                    "default_curves": self._serialize_fan_map(self._copy_profile_defaults()),
                    "profile_defaults": {
                        prof: self._serialize_fan_map(fans)
                        for prof, fans in self.profiles.items()
                    },
                    "factory_profiles": {
                        prof: self._serialize_fan_map(fans)
                        for prof, fans in self.factory_profiles.items()
                    },
                    "defaults_modified": self.defaults_are_modified(),
                    "custom_curves": (
                        self._serialize_fan_map(self.custom_curves[self.current_profile])
                        if self.current_profile in self.custom_curves
                        else None
                    ),
                    "has_custom_curve": self.current_profile in self.custom_curves,
                    "resources": {
                        "cpu_load": cpu_load,
                        "cpu_freq_mhz": cpu_freq_mhz,
                        "cpu_freq_max_mhz": cpu_freq_max_mhz,
                        "ram_used": ram_used,
                        "ram_total": ram_total,
                        "gpu_load": gpu_load,
                        "vram_used": vram_used,
                        "vram_total": vram_total
                    }
                }
                
                if 'sensor_data' in fans:
                    data['sensor_data'] = fans['sensor_data']
                    
                self._log_telemetry_row(data)

                # Output to stdout for Electron frontend
                print(json.dumps(data), flush=True)
                
                time.sleep(0.5)
                
            except Exception as e:
                logger.error(f"Error in update loop: {e}", exc_info=True)
                time.sleep(1)

def handle_command(controller: NBFCController, command: str) -> None:
    """Handle commands from standard input"""
    parts = command.strip().split()
    if not parts:
        return
        
    cmd = parts[0]
    
    try:
        if cmd == "set_fan_speed" and len(parts) >= 3:
            fan_id = int(parts[1])
            speed = float(parts[2])
            controller.set_fan_speed(fan_id, speed)
        elif cmd == "set_all_fans_speed" and len(parts) >= 2:
            speed = float(parts[1])
            controller.set_all_fans_speed(speed)
        elif cmd == "set_mode" and len(parts) >= 2:
            is_dynamic = parts[1].lower() == "dynamic"
            controller.set_mode(is_dynamic)
        elif cmd == "set_auto_logging" and len(parts) >= 2:
            enabled = parts[1].lower() in ("true", "1", "yes", "on")
            controller.set_auto_logging(enabled)
        elif cmd == "set_speed_offset" and len(parts) >= 2:
            controller.set_speed_offset(float(parts[1]))
        elif cmd == "get_log_summary":
            try:
                from nitro_log_summary import find_log_file, analyze_logs
                filepath = controller._get_log_filepath()
                log_file = find_log_file(filepath)
                if log_file:
                    stats = analyze_logs(log_file)
                else:
                    stats = {"error": "Brak zebranych logów telemetrycznych."}
                print(json.dumps({"log_summary_response": stats}), flush=True)
            except Exception as err:
                logger.error(f"Error executing log summary: {err}")
        elif cmd == "clear_logs":
            try:
                result = controller.clear_telemetry_logs()
            except Exception as err:
                logger.error(f"Error clearing telemetry logs: {err}")
                result = {"ok": False, "deleted": 0, "error": str(err)}
            print(json.dumps({"clear_logs_response": result}), flush=True)
        elif cmd == "apply_profile" and len(parts) >= 2:
            profile = parts[1]
            controller.apply_profile(profile)
        elif cmd == "set_curve_source" and len(parts) >= 2:
            try:
                controller.set_curve_source(parts[1])
            except ValueError as err:
                logger.error(f"Invalid curve_source: {err}")
        elif cmd == "set_curve" and len(parts) >= 3:
            try:
                target_fan = "all"
                arg_offset = 1
                if parts[1].lower() in ("cpu", "gpu", "all"):
                    target_fan = parts[1].lower()
                    arg_offset = 2
                
                raw_pairs = parts[arg_offset:]
                points = []
                for i in range(0, len(raw_pairs) - 1, 2):
                    points.append((float(raw_pairs[i]), float(raw_pairs[i+1])))
                
                if not points:
                    raise ValueError("brak par wartości temperatura-prędkość")
                
                if target_fan in ("cpu", "all"):
                    controller.set_curve("cpu", points)
                if target_fan in ("gpu", "all"):
                    controller.set_curve("gpu", points)
            except Exception as err:
                logger.error(f"Invalid curve command values: {err}")
        elif cmd == "set_default_curve" and len(parts) >= 4:
            try:
                profile = parts[1]
                target_fan = parts[2].lower()
                if target_fan not in ("cpu", "gpu", "all"):
                    raise ValueError(f"fan musi być cpu/gpu/all, dostano {parts[2]!r}")
                raw_pairs = parts[3:]
                points = []
                for i in range(0, len(raw_pairs) - 1, 2):
                    points.append((float(raw_pairs[i]), float(raw_pairs[i + 1])))
                if not points:
                    raise ValueError("brak par wartości temperatura-prędkość")
                if target_fan in ("cpu", "all"):
                    controller.set_default_curve(profile, "cpu", points)
                if target_fan in ("gpu", "all"):
                    controller.set_default_curve(profile, "gpu", points)
            except Exception as err:
                logger.error(f"Invalid set_default_curve: {err}")
        elif cmd == "reset_default_curves":
            try:
                # reset_default_curves [Profile] — bez argumentu = wszystkie profile
                prof = parts[1] if len(parts) >= 2 else None
                controller.reset_default_curves(prof)
            except Exception as err:
                logger.error(f"Invalid reset_default_curves: {err}")
    except Exception as e:
        logger.error(f"Error processing command {cmd}: {e}")

def main():
    """Main function"""
    controller = NBFCController()

    update_thread = threading.Thread(target=controller.update_loop, daemon=True)
    update_thread.start()
    
    try:
        for line in sys.stdin:
            handle_command(controller, line)
    except KeyboardInterrupt:
        logger.info("API shutting down...")
        sys.exit(0)

if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(0))
    main()