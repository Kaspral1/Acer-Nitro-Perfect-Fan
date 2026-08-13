#!/usr/bin/env python3
"""
Acer Nitro Perfect Fan - Telemetry Log Summary & Analyzer
Analizuje pliki logów (telemetry.csv) i generuje przejrzysty raport podsumowujący.

Sposób użycia:
    python3 nitro_log_summary.py [/ścieżka/do/telemetry.csv]
    python3 nitro_log_summary.py --json
"""

import sys
import os
import csv
import json
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

def find_log_file(custom_path: Optional[str] = None) -> Optional[Path]:
    if custom_path and os.path.exists(custom_path):
        return Path(custom_path)
    
    candidates = [
        Path("/var/log/nitro-fan/telemetry.csv"),
        Path.home() / ".config/nitro-fan/telemetry.csv",
        Path(__file__).resolve().parent / "telemetry.csv",
        Path(__file__).resolve().parent / "gui-app" / "telemetry.csv"
    ]
    
    for p in candidates:
        if p.exists() and p.stat().st_size > 0:
            return p
            
    return None

def analyze_logs(filepath: Path) -> Dict[str, Any]:
    rows = []
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                ts_str = row.get('timestamp', '')
                ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                cpu_temp = float(row.get('cpu_temp', 0))
                gpu_temp = float(row.get('gpu_temp', 0))
                cpu_speed = float(row.get('cpu_speed', 0))
                gpu_speed = float(row.get('gpu_speed', 0))
                cpu_load = float(row.get('cpu_load', 0))
                gpu_load = float(row.get('gpu_load', 0))
                mode = row.get('mode', 'Dynamic')
                profile = row.get('profile', 'Silent')
                
                rows.append({
                    'timestamp': ts,
                    'cpu_temp': cpu_temp,
                    'gpu_temp': gpu_temp,
                    'cpu_speed': cpu_speed,
                    'gpu_speed': gpu_speed,
                    'cpu_load': cpu_load,
                    'gpu_load': gpu_load,
                    'mode': mode,
                    'profile': profile
                })
            except (ValueError, TypeError, KeyError):
                continue

    if not rows:
        return {"error": f"Plik logów '{filepath}' jest pusty lub ma nieprawidłowy format."}

    rows.sort(key=lambda r: r['timestamp'])
    
    start_time = rows[0]['timestamp']
    end_time = rows[-1]['timestamp']
    total_seconds = max(1.0, (end_time - start_time).total_seconds())
    total_samples = len(rows)

    cpu_temps = [r['cpu_temp'] for r in rows if r['cpu_temp'] > 0]
    gpu_temps = [r['gpu_temp'] for r in rows if r['gpu_temp'] > 0]
    
    avg_cpu_temp = sum(cpu_temps) / len(cpu_temps) if cpu_temps else 0.0
    max_cpu_temp = max(cpu_temps) if cpu_temps else 0.0
    min_cpu_temp = min(cpu_temps) if cpu_temps else 0.0

    avg_gpu_temp = sum(gpu_temps) / len(gpu_temps) if gpu_temps else 0.0
    max_gpu_temp = max(gpu_temps) if gpu_temps else 0.0
    min_gpu_temp = min(gpu_temps) if gpu_temps else 0.0

    sample_interval = total_seconds / max(1, total_samples - 1) if total_samples > 1 else 1.0
    
    cpu_at_max_count = sum(1 for t in cpu_temps if t >= max_cpu_temp - 1.0)
    gpu_at_max_count = sum(1 for t in gpu_temps if t >= max_gpu_temp - 1.0)
    
    time_at_max_cpu_sec = round(cpu_at_max_count * sample_interval)
    time_at_max_gpu_sec = round(gpu_at_max_count * sample_interval)

    cpu_speeds = [r['cpu_speed'] for r in rows]
    gpu_speeds = [r['gpu_speed'] for r in rows]
    
    avg_cpu_speed = sum(cpu_speeds) / len(cpu_speeds) if cpu_speeds else 0.0
    max_cpu_speed = max(cpu_speeds) if cpu_speeds else 0.0
    avg_gpu_speed = sum(gpu_speeds) / len(gpu_speeds) if gpu_speeds else 0.0
    max_gpu_speed = max(gpu_speeds) if gpu_speeds else 0.0
    
    gpu_zero_rpm_count = sum(1 for s in gpu_speeds if s == 0)
    gpu_zero_rpm_sec = round(gpu_zero_rpm_count * sample_interval)
    gpu_zero_rpm_pct = round((gpu_zero_rpm_count / len(gpu_speeds)) * 100.0, 1) if gpu_speeds else 0.0

    cpu_loads = [r['cpu_load'] for r in rows]
    gpu_loads = [r['gpu_load'] for r in rows]
    avg_cpu_load = sum(cpu_loads) / len(cpu_loads) if cpu_loads else 0.0
    avg_gpu_load = sum(gpu_loads) / len(gpu_loads) if gpu_loads else 0.0

    profiles_count = {}
    for r in rows:
        p = r['profile']
        profiles_count[p] = profiles_count.get(p, 0) + 1
        
    profiles_share = {
        p: round((cnt / total_samples) * 100.0, 1)
        for p, cnt in profiles_count.items()
    }

    high_temp_cpu_count = sum(1 for t in cpu_temps if t >= 85.0)
    high_temp_cpu_sec = round(high_temp_cpu_count * sample_interval)

    return {
        "filepath": str(filepath),
        "start_time": start_time.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "end_time": end_time.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "total_runtime_seconds": total_seconds,
        "total_samples": total_samples,
        "sample_interval_sec": round(sample_interval, 2),
        "cpu": {
            "avg_temp": round(avg_cpu_temp, 1),
            "max_temp": round(max_cpu_temp, 1),
            "min_temp": round(min_cpu_temp, 1),
            "time_at_max_sec": time_at_max_cpu_sec,
            "avg_speed": round(avg_cpu_speed, 1),
            "max_speed": round(max_cpu_speed, 1),
            "avg_load": round(avg_cpu_load, 1),
            "high_temp_85c_sec": high_temp_cpu_sec
        },
        "gpu": {
            "avg_temp": round(avg_gpu_temp, 1),
            "max_temp": round(max_gpu_temp, 1),
            "min_temp": round(min_gpu_temp, 1),
            "time_at_max_sec": time_at_max_gpu_sec,
            "avg_speed": round(avg_gpu_speed, 1),
            "max_speed": round(max_gpu_speed, 1),
            "avg_load": round(avg_gpu_load, 1),
            "zero_rpm_sec": gpu_zero_rpm_sec,
            "zero_rpm_pct": gpu_zero_rpm_pct
        },
        "profiles_share": profiles_share
    }

def format_duration(seconds: float) -> str:
    secs = int(seconds)
    hours = secs // 3600
    minutes = (secs % 3600) // 60
    s = secs % 60
    
    parts = []
    if hours > 0:
        parts.append(f"{hours} godz.")
    if minutes > 0 or hours > 0:
        parts.append(f"{minutes} min")
    parts.append(f"{s} sek.")
    return " ".join(parts)

def print_summary(stats: Dict[str, Any]):
    if "error" in stats:
        print(f"\n❌ Błąd: {stats['error']}")
        return

    c = stats["cpu"]
    g = stats["gpu"]
    
    print("=" * 65)
    print(" 🌀 PODSUMOWANIE TELEMETRII I LOGÓW - ACER NITRO PERFECT FAN")
    print("=" * 65)
    print(f" 📄 Plik logu:        {stats['filepath']}")
    print(f" 🕒 Czas rozpoczęcia: {stats['start_time']}")
    print(f" 🏁 Czas zakończenia: {stats['end_time']}")
    print(f" ⏱️ Czas działania:   {format_duration(stats['total_runtime_seconds'])}")
    print(f" 📊 Liczba pomiarów:  {stats['total_samples']} (odczyt co ~{stats['sample_interval_sec']} s)")
    print("-" * 65)
    print(" 💻 TEMPERATURY PROCESORA (CPU):")
    print(f"    • Średnia temperatura:         {c['avg_temp']} °C")
    print(f"    • Maksymalna temperatura:      {c['max_temp']} °C")
    print(f"    • Minimalna temperatura:       {c['min_temp']} °C")
    print(f"    • Czas trwania max temp:       {format_duration(c['time_at_max_sec'])}")
    print(f"    • Średnie obroty wiatraka:     {c['avg_speed']}% (maksimum: {c['max_speed']}%)")
    print(f"    • Średnie obciążenie CPU:      {c['avg_load']}%")
    if c['high_temp_85c_sec'] > 0:
        print(f"    ⚠️ Uwaga: CPU przebywał w wysokiej temp. (>=85°C) przez {format_duration(c['high_temp_85c_sec'])}")
    print("-" * 65)
    print(" 🎮 TEMPERATURY KARTY GRAFICZNEJ (GPU):")
    print(f"    • Średnia temperatura:         {g['avg_temp']} °C")
    print(f"    • Maksymalna temperatura:      {g['max_temp']} °C")
    print(f"    • Minimalna temperatura:       {g['min_temp']} °C")
    print(f"    • Czas trwania max temp:       {format_duration(g['time_at_max_sec'])}")
    print(f"    • Średnie obroty wiatraka:     {g['avg_speed']}% (maksimum: {g['max_speed']}%)")
    print(f"    • Średnie obciążenie GPU:      {g['avg_load']}%")
    print(f"    • Tryb Cichy (Zero-RPM 0%):     {format_duration(g['zero_rpm_sec'])} ({g['zero_rpm_pct']}% czasu)")
    print("-" * 65)
    print(" ⚙️ UDZIAŁ PROFILI CHŁODZENIA:")
    for prof, pct in stats["profiles_share"].items():
        print(f"    • Profil {prof:10s}: {pct}% czasu")
    print("=" * 65)

def main():
    target_path = None
    output_json = False
    
    for arg in sys.argv[1:]:
        if arg == "--json":
            output_json = True
        elif not arg.startswith("--"):
            target_path = arg
            
    log_file = find_log_file(target_path)
    if not log_file:
        print("\n❌ Błąd: Nie znaleziono pliku logów telemetry.csv!")
        print("Upewnij się, że opcja 'Zapisywanie logów' jest włączona w ustawieniach programu.")
        print("Możesz również podać ścieżkę do pliku jako argument: python3 nitro_log_summary.py /sciezka/do/telemetry.csv\n")
        sys.exit(1)
        
    stats = analyze_logs(log_file)
    
    if output_json:
        print(json.dumps(stats, indent=2, ensure_ascii=False))
    else:
        print_summary(stats)

if __name__ == "__main__":
    main()
