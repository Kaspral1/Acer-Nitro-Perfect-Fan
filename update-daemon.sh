#!/usr/bin/env bash
# Aktualizacja daemona systemowego do wersji z katalogu repozytorium.
#   sudo ./update-daemon.sh

set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB=/usr/local/lib/acer-nitro-perfect-fan
SERVICE=acer-nitro-perfect-fan.service

[ "$(id -u)" -eq 0 ] || { echo "Uruchom: sudo ./update-daemon.sh"; exit 1; }

echo ">>> Instalacja daemona + fan_backend.py → $LIB"
install -o root -g root -m 755 "$SRC/nitro_fan_daemon.py" "$LIB/nitro_fan_daemon.py"
install -o root -g root -m 644 "$SRC/fan_backend.py"      "$LIB/fan_backend.py"
systemctl restart "$SERVICE"
sleep 1
systemctl --no-pager --lines=8 status "$SERVICE" || true
echo ">>> Gotowe."
