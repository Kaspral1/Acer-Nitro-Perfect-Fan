#!/usr/bin/env bash
# Odinstalowanie Acer Nitro Perfect Fan (daemon, udev, config, użytkownik serwisowy).
#
#   sudo ./uninstall.sh
#
# GUI (gui-app/node_modules) usuń ręcznie z katalogu projektu — ten skrypt
# nie kasuje sklonowanego repozytorium.

set -euo pipefail

UNIT=/etc/systemd/system/acer-nitro-perfect-fan.service
SERVICE=acer-nitro-perfect-fan.service
LIB=/usr/local/lib/acer-nitro-perfect-fan
ETC=/etc/nitro-fan
UDEV_RULE=/etc/udev/rules.d/99-acer-nitro-ec.rules
SVC_USER=acer_nitro_perfect_fan
LOG_DIR=/var/log/nitro-fan

[ "$(id -u)" -eq 0 ] || { echo "Uruchom przez sudo: sudo ./uninstall.sh"; exit 1; }

echo ">>> Zatrzymywanie i wyłączanie $SERVICE"
if systemctl list-unit-files "$SERVICE" >/dev/null 2>&1; then
    systemctl disable --now "$SERVICE" 2>/dev/null || true
fi
if systemctl list-unit-files acer-speedfan.service >/dev/null 2>&1 \
   || [ -f /etc/systemd/system/acer-speedfan.service ]; then
    echo ">>> Zatrzymywanie poprzedniej usługi acer-speedfan.service"
    systemctl disable --now acer-speedfan.service 2>/dev/null || true
fi

# Przywróć automatyczne EC zanim usuniemy skrypt restore-auto
if [ -x "$LIB/restore-auto.sh" ]; then
    echo ">>> Przywracanie trybu auto EC"
    "$LIB/restore-auto.sh" || true
elif [ -x /usr/local/lib/acer-speedfan/restore-auto.sh ]; then
    echo ">>> Przywracanie trybu auto EC (poprzednia instalacja)"
    /usr/local/lib/acer-speedfan/restore-auto.sh || true
fi

echo ">>> Usuwanie jednostki systemd"
rm -f "$UNIT" /etc/systemd/system/acer-speedfan.service
systemctl daemon-reload || true
systemctl reset-failed "$SERVICE" 2>/dev/null || true
systemctl reset-failed acer-speedfan.service 2>/dev/null || true

echo ">>> Usuwanie plików daemona ($LIB)"
rm -rf "$LIB" /usr/local/lib/acer-speedfan

echo ">>> Usuwanie reguły udev"
rm -f "$UDEV_RULE"
udevadm control --reload 2>/dev/null || true

if [ -d "$ETC" ]; then
    echo ">>> Usuwanie konfiguracji $ETC"
    rm -rf "$ETC"
fi

if [ -d "$LOG_DIR" ]; then
    echo ">>> Usuwanie logów $LOG_DIR"
    rm -rf "$LOG_DIR"
fi

if id -u "$SVC_USER" >/dev/null 2>&1; then
    echo ">>> Usuwanie użytkownika serwisowego $SVC_USER"
    userdel "$SVC_USER" 2>/dev/null || true
fi
if id -u acer_speedfan >/dev/null 2>&1; then
    echo ">>> Usuwanie poprzedniego użytkownika acer_speedfan"
    userdel acer_speedfan 2>/dev/null || true
    groupdel acer_speedfan 2>/dev/null || true
fi

echo
echo ">>> Odinstalowano usługę systemową."
echo "    Katalog projektu (git clone) i zależności GUI nie zostały usunięte."
echo "    Opcjonalnie:  rm -rf gui-app/node_modules"
echo "    Logi użytkownika (jeśli były):  ~/.config/nitro-fan/"
