#!/usr/bin/env python3
"""Nadzorca wentylatorów Acer Nitro (CPU = fan 1, GPU = fan 2).

Backend I/O (auto): acer_nitro_ec (hwmon) albo nbfc-linux. Sterownik hwmon
skaluje pwm (ec = pwm * 100 // 255); logika liczy w procentach 0–100.

EC porzuca tryb manualny po chwili, więc wartości trzeba odświeżać
cyklicznie — stąd pętla ~1 s. Krzywe temperatura -> % są wygładzane EMA
(szybciej w górę, wolniej w dół), żeby uniknąć pulsowania wiatraków przy
szumie odczytu EC. Radiator CPU/GPU jest wspólny. W Cichym oba wiatraki
dostają ten sam PWM z krzywej CPU (gorętszy chip, bez +5 na GPU);
Zero-RPM GPU zostaje, gdy cały obieg jest zimny. W Normalnym to samo
(krzywa CPU od gorętszego chipa, GPU = CPU, bez +5). W Turbo GPU
liczy się od gorętszego chipa i trzyma +5 pkt względem swojej krzywej.
CPU ma podłogę MIN_PCT_CPU.

Konfiguracja: /etc/nitro-fan/config.json, a gdy brak — nbfc_config.json
obok skryptu (ten sam plik edytuje GUI projektu); zmiany łapane po mtime.
"""

import json
import signal
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fan_backend import detect_from_config, read_chip_temps, valid_chip_temp  # noqa: E402

CONFIG_PRIMARY = Path("/etc/nitro-fan/config.json")
CONFIG_FALLBACK = Path(__file__).resolve().parent / "nbfc_config.json"

MIN_PCT_CPU = 30      # podłoga wiatraka CPU — dostrojona po teście sprzętowym (30% = ~2380 RPM)
MIN_PCT_GPU = 30      # podłoga wiatraka GPU gdy już się kręci (30% = ~2255 RPM)
GPU_CURVE_BOOST = 5.0 # GPU: +5 do własnej krzywej (nie względem CPU)
GPU_STOP_TEMP = 40.0  # Silent: cały obieg poniżej → GPU stoi
GPU_START_TEMP = 48.0 # Silent: gorętszy chip powyżej → GPU rusza
ZERO_RPM_PROFILES = frozenset({"Silent"})
LOCKSTEP_PROFILES = frozenset({"Silent", "Balanced"})
KNOWN_PROFILES = ("Silent", "Balanced", "Turbo")
SYS_GUARD_TEMP = 78.0 # temp3 powyżej tej wartości podbija obie krzywe
CRITICAL_TEMP = 88.0
ALPHA_UP = 0.25
ALPHA_DOWN = 0.05
DEADBAND_PCT = 3
FALLBACK_PCT = 70     # gdy odczyt temperatury zawiedzie
INTERVAL = 1.0
CURVE_CPU = [(45.0, 30.0), (55.0, 32.0), (65.0, 42.0), (75.0, 62.0), (85.0, 100.0)]
CURVE_GPU = [(45.0, 30.0), (55.0, 32.0), (65.0, 42.0), (75.0, 62.0), (85.0, 100.0)]

REWRITE_INTERVAL = 5.0  # odśwież pwmN nawet bez zmiany celu — EC potrafi zresetować rejestr
LOG_INTERVAL = 60.0     # throttling logów o zepsutych odczytach temperatury
SPEED_OFFSET_MIN = -50.0  # + = CPU szybszy, − = GPU szybszy (GPU = CPU − offset)
SPEED_OFFSET_MAX = 50.0
DEFAULT_SPEED_OFFSET = 0.0


def clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def valid_temp(t) -> bool:
    return valid_chip_temp(t)


def curve_speed(temp: float, curve) -> float:
    """Liniowa interpolacja krzywej [(temp, %), ...] posortowanej po temp."""
    if temp <= curve[0][0]:
        return curve[0][1]
    if temp >= curve[-1][0]:
        return curve[-1][1]
    for (t1, s1), (t2, s2) in zip(curve, curve[1:]):
        if t1 <= temp <= t2:
            return s1 + (s2 - s1) * (temp - t1) / (t2 - t1)
    return curve[-1][1]


def ema_step(prev: float, raw: float) -> float:
    """Jeden krok EMA: szybciej w górę (ALPHA_UP), wolniej w dół (ALPHA_DOWN)."""
    alpha = ALPHA_UP if raw > prev else ALPHA_DOWN
    return prev + alpha * (raw - prev)


def log_throttled(key: str, msg: str, last_log={}) -> None:
    """print() na stderr, ale co najwyżej raz na LOG_INTERVAL sekund na dany klucz."""
    now = time.monotonic()
    if now - last_log.get(key, -LOG_INTERVAL) >= LOG_INTERVAL:
        last_log[key] = now
        print(msg, file=sys.stderr)


def clean_curve(raw, default):
    """Normalizuje punkty krzywej; prędkość nigdy poniżej MIN_PCT_CPU (30%)."""
    pts = []
    for p in raw or []:
        try:
            t, s = p
            speed = max(float(MIN_PCT_CPU), min(100.0, float(s)))
            pts.append((float(t), speed))
        except (TypeError, ValueError):
            continue
    return sorted(pts) if pts else default


def clean_speed_offset(raw) -> float:
    """Offset CPU vs GPU (−50…+50): + = CPU szybszy, − = GPU szybszy."""
    try:
        return max(SPEED_OFFSET_MIN, min(SPEED_OFFSET_MAX, float(raw)))
    except (TypeError, ValueError):
        return DEFAULT_SPEED_OFFSET


def clean_profile(raw) -> str:
    name = str(raw or "Silent")
    return name if name in KNOWN_PROFILES else "Silent"


def allow_gpu_zero_rpm(profile: str) -> bool:
    """Zero-RPM tylko w Cichym — Normalny/Turbo zawsze po krzywej."""
    return profile in ZERO_RPM_PROFILES


def hotter(*temps):
    """Najwyższa poprawna temperatura; None gdy brak odczytów."""
    vals = [t for t in temps if t is not None]
    return max(vals) if vals else None


def boost_gpu_curve_pct(curve_pct: float) -> float:
    """Krzywa GPU + stałe 5 pkt, bez wyjścia poza 0–100."""
    return clamp(curve_pct + GPU_CURVE_BOOST)


def update_gpu_spinning(
    spinning: bool, loop_ema, loop_raw, allow_zero: bool
) -> bool:
    """Histereza Zero-RPM na wspólnym radiatorze (gorętszy z CPU/GPU).

    Poza Cichym wiatrak GPU zawsze w ruchu — to lepszy wydech obiegu.
    """
    if not allow_zero or (loop_raw is not None and loop_raw >= CRITICAL_TEMP):
        return True
    if loop_ema is None:
        return spinning
    if spinning:
        return loop_ema >= GPU_STOP_TEMP
    return loop_ema >= GPU_START_TEMP


def gpu_target_from_curve(curve_pct: float, spinning: bool, loop_raw) -> float:
    """Cel PWM GPU z krzywej: +5 pkt, albo 0 gdy Silent i cały obieg zimny."""
    if loop_raw is not None and loop_raw >= CRITICAL_TEMP:
        return 100.0
    if not spinning:
        return 0.0
    return max(boost_gpu_curve_pct(curve_pct), MIN_PCT_GPU)


def match_silent_speeds(
    cpu_pct: float, gpu_pct: float, spinning: bool
) -> tuple:
    """Cichy/Normalny: GPU dostaje ten sam PWM co CPU; Zero-RPM GPU zostaje 0."""
    if not spinning:
        return cpu_pct, 0.0
    return cpu_pct, cpu_pct


def apply_speed_offset(
    cpu_pct: float,
    gpu_pct: float,
    offset: float,
    *,
    force_gpu_floor: bool,
    allow_zero_gpu: bool,
    mode_manual: bool = False,
) -> tuple:
    """Dodaje prędkość do jednego wentylatora (nie zabiera drugiemu).

    +offset → CPU = baza + offset, GPU = baza (manual: baza = cel CPU z configu;
              auto: baza = wynik krzywej, boost na CPU).
    −offset → GPU = baza + |offset|, CPU = baza.
    offset==0 → bez zmian.
    """
    if abs(offset) < 0.01:
        return cpu_pct, gpu_pct
    if allow_zero_gpu and gpu_pct <= 0.0:
        return cpu_pct, 0.0

    if mode_manual:
        # manual_speeds trzyma bazę (master); offset dopiero tu
        base = cpu_pct
        if offset > 0:
            cpu_new = clamp(base + offset)
            gpu_new = clamp(base)
        else:
            cpu_new = clamp(base)
            gpu_new = clamp(base - offset)  # -offset > 0
    else:
        # auto: dołóż boost do wyniku krzywej (nie nadpisuj drugiego wentylatora)
        cpu_new, gpu_new = cpu_pct, gpu_pct
        if offset > 0:
            cpu_new = clamp(cpu_pct + offset)
        else:
            gpu_new = clamp(gpu_pct - offset)

    cpu_new = max(MIN_PCT_CPU, cpu_new)
    if force_gpu_floor:
        gpu_new = max(MIN_PCT_GPU, gpu_new)
    return cpu_new, gpu_new


def _config_tuple(cache) -> tuple:
    return (
        cache["mode"],
        cache["curve_cpu"],
        cache["curve_gpu"],
        cache["manual"],
        cache.get("speed_offset", DEFAULT_SPEED_OFFSET),
        cache.get("profile", "Silent"),
    )


def load_config(mtime_cache={}):
    """Zwraca (mode, curve_cpu, curve_gpu, manual, speed_offset, profile).

    manual: {"1": %, "2": %}.
    speed_offset: + = CPU szybszy, − = GPU szybszy (−50…+50).
    profile: Silent | Balanced | Turbo (Zero-RPM tylko w Silent).
    """
    path = CONFIG_PRIMARY if CONFIG_PRIMARY.exists() else CONFIG_FALLBACK
    try:
        mtime = path.stat().st_mtime
        if mtime_cache.get("path") != path or mtime_cache.get("t") != mtime:
            cfg = json.loads(path.read_text())
            curves = cfg.get("curves")
            if isinstance(curves, dict):
                curve_cpu = clean_curve(curves.get("cpu"), CURVE_CPU)
                curve_gpu = clean_curve(curves.get("gpu"), CURVE_GPU)
            else:
                legacy = clean_curve(cfg.get("fan_curve"), None)
                curve_cpu = legacy or CURVE_CPU
                curve_gpu = legacy or CURVE_GPU
            speeds = cfg.get("manual_speeds") or {}
            mtime_cache.update(
                path=path,
                t=mtime,
                mode=cfg.get("mode", "dynamic"),
                curve_cpu=curve_cpu,
                curve_gpu=curve_gpu,
                manual={
                    "1": float(speeds.get("0", 50.0)),  # fan_id 0 (CPU) -> pwm1
                    "2": float(speeds.get("1", 50.0)),  # fan_id 1 (GPU) -> pwm2
                },
                speed_offset=clean_speed_offset(cfg.get("speed_offset", DEFAULT_SPEED_OFFSET)),
                profile=clean_profile(cfg.get("profile", "Silent")),
            )
        return _config_tuple(mtime_cache)
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        if "mode" in mtime_cache:
            return _config_tuple(mtime_cache)
        return "dynamic", CURVE_CPU, CURVE_GPU, {"1": 50.0, "2": 50.0}, DEFAULT_SPEED_OFFSET, "Silent"


def main():
    try:
        backend, why = detect_from_config(
            CONFIG_PRIMARY if CONFIG_PRIMARY.exists() else CONFIG_FALLBACK
        )
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from exc
    print(f"backend={backend.name}: {why}", file=sys.stderr)

    def restore_auto(*_):
        backend.restore_auto()
        sys.exit(0)

    signal.signal(signal.SIGTERM, restore_auto)
    signal.signal(signal.SIGINT, restore_auto)

    ema_cpu = None
    ema_gpu = None
    gpu_spinning = False
    last_write = {"1": 0.0, "2": 0.0}

    while True:
        try:
            now = time.monotonic()

            # Krzem (coretemp / nvidia / acer-wmi) przed EC. Nigdy max()
            # z zaciętego EC temp2 — to podbijało GPU i blokowało spadek.
            temps = read_chip_temps(backend)
            raw_cpu = temps.get("cpu")
            raw_gpu = temps.get("gpu")
            raw_sys = temps.get("sys")

            guard_pct = None
            if raw_sys is None:
                log_throttled("sys_temp", "temp3 (system): brak ważnego odczytu")
            elif raw_sys > SYS_GUARD_TEMP:
                span = 85.0 - SYS_GUARD_TEMP  # 30% przy SYS_GUARD_TEMP -> 100% przy 85 C
                guard_pct = clamp(30.0 + (raw_sys - SYS_GUARD_TEMP) * (100.0 - 30.0) / span)

            mode, curve_cpu, curve_gpu, manual, speed_offset, profile = load_config()
            allow_zero = allow_gpu_zero_rpm(profile)

            if mode == "manual":
                # manual_speeds z GUI/API to już EFEKTYWNE PWM (baza ± offset).
                # Nie stosuj offsetu drugi raz — działa też ze starym daemonem
                # dopóki API zapisuje efektywne wartości.
                cpu_pct = max(MIN_PCT_CPU, clamp(manual["1"]))
                gpu_pct = max(MIN_PCT_GPU, clamp(manual["2"]))
                if raw_cpu is not None and raw_cpu >= CRITICAL_TEMP:
                    cpu_pct = 100.0
                if raw_gpu is not None and raw_gpu >= CRITICAL_TEMP:
                    gpu_pct = 100.0
            else:
                if raw_cpu is None:
                    cpu_pct = FALLBACK_PCT
                    log_throttled("cpu_temp", "CPU: brak ważnego odczytu temperatury, fallback")
                else:
                    ema_cpu = raw_cpu if ema_cpu is None else ema_step(ema_cpu, raw_cpu)
                    curve_in = raw_cpu if raw_cpu >= CRITICAL_TEMP else ema_cpu
                    cpu_pct = curve_speed(curve_in, curve_cpu)
                    if raw_cpu >= CRITICAL_TEMP:
                        cpu_pct = 100.0  # podbicie na wypadek niestandardowej krzywej z configu
                    cpu_pct = max(cpu_pct, MIN_PCT_CPU)

                if raw_gpu is not None:
                    ema_gpu = raw_gpu if ema_gpu is None else ema_step(ema_gpu, raw_gpu)
                loop_raw = hotter(raw_cpu, raw_gpu)
                loop_ema = hotter(ema_cpu, ema_gpu)

                if loop_raw is None and loop_ema is None:
                    gpu_pct = FALLBACK_PCT
                    gpu_spinning = not allow_zero
                    log_throttled("gpu_temp", "GPU: brak ważnego odczytu temperatury, fallback")
                elif profile in LOCKSTEP_PROFILES:
                    # Jeden obieg, jedna prędkość: krzywa CPU od gorętszego chipa.
                    # Bez +5 i bez osobnej (wyższej) krzywej GPU.
                    curve_in = (
                        loop_raw
                        if loop_raw is not None and loop_raw >= CRITICAL_TEMP
                        else (loop_ema if loop_ema is not None else loop_raw)
                    )
                    shared = curve_speed(curve_in, curve_cpu)
                    if loop_raw is not None and loop_raw >= CRITICAL_TEMP:
                        shared = 100.0
                    cpu_pct = max(shared, MIN_PCT_CPU)
                    gpu_spinning = update_gpu_spinning(
                        gpu_spinning, loop_ema, loop_raw, allow_zero
                    )
                    gpu_pct = 0.0 if not gpu_spinning else cpu_pct
                else:
                    # Wspólny radiator: GPU wieje przez ten sam blok co CPU.
                    curve_in = (
                        loop_raw
                        if loop_raw is not None and loop_raw >= CRITICAL_TEMP
                        else (loop_ema if loop_ema is not None else loop_raw)
                    )
                    curve_pct = curve_speed(curve_in, curve_gpu)
                    gpu_spinning = update_gpu_spinning(
                        gpu_spinning, loop_ema, loop_raw, allow_zero
                    )
                    gpu_pct = gpu_target_from_curve(curve_pct, gpu_spinning, loop_raw)

                # Boost: + → CPU szybciej, − → GPU szybciej (na wierzchu krzywych)
                if loop_raw is None or loop_raw < CRITICAL_TEMP:
                    cpu_pct, gpu_pct = apply_speed_offset(
                        cpu_pct, gpu_pct, speed_offset,
                        force_gpu_floor=gpu_spinning,
                        allow_zero_gpu=allow_zero and not gpu_spinning,
                        mode_manual=False,
                    )
                if profile in LOCKSTEP_PROFILES:
                    cpu_pct, gpu_pct = match_silent_speeds(
                        cpu_pct, gpu_pct, gpu_spinning
                    )

            if guard_pct is not None:
                cpu_pct = max(cpu_pct, guard_pct)
                gpu_pct = max(gpu_pct, guard_pct)

            for fan_id, target in (("1", cpu_pct), ("2", gpu_pct)):
                current_pct = backend.read_pwm_pct(fan_id)
                target = clamp(target)
                stale = now - last_write[fan_id] >= REWRITE_INTERVAL
                if current_pct is None:
                    changed = True
                elif target in (0.0, 100.0):
                    changed = target != current_pct
                else:
                    changed = abs(target - current_pct) >= DEADBAND_PCT
                if changed or stale:
                    backend.write_pwm_pct(fan_id, target)
                    last_write[fan_id] = now
        except Exception as exc:
            log_throttled("main_loop", f"błąd w pętli głównej: {exc}")
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
