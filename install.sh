#!/usr/bin/env bash
# Instalacja daemona Acer Nitro Perfect Fan (Linux + systemd).
# Backend: acer_nitro_ec (hwmon) albo nbfc-linux — patrz INSTALL_PL.md.
#
# Repozytorium zwykle leży w /home (bywa zaszyfrowane, montowane przy logowaniu)
# — dlatego daemon i jego konfiguracja są kopiowane na /, gdzie systemd
# widzi je od startu systemu.
#
# Wymagania: załadowany moduł jądra acer_nitro_ec (sterownik hwmon EC).
#
#   sudo ./install.sh

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB=/usr/local/lib/acer-nitro-perfect-fan
ETC=/etc/nitro-fan
UNIT=/etc/systemd/system/acer-nitro-perfect-fan.service
SERVICE=acer-nitro-perfect-fan.service
UDEV_RULE=/etc/udev/rules.d/99-acer-nitro-ec.rules
SVC_USER=acer_nitro_perfect_fan

[ "$(id -u)" -eq 0 ] || { echo "Uruchom przez sudo: sudo ./install.sh"; exit 1; }

OWNER="${SUDO_USER:-root}"
GROUP="$(id -gn "$OWNER")"

# --- Konflikt ze starszymi instalacjami / NBFC --------------------------------
if systemctl list-unit-files nitro-fan-daemon.service >/dev/null 2>&1; then
    echo "!!! UWAGA: wykryto starą usługę nitro-fan-daemon.service."
    echo "    Nie ruszam jej automatycznie, ale dwie usługi sterujące tymi"
    echo "    samymi wentylatorami będą ze sobą walczyć. Wyłącz ją ręcznie:"
    echo "      sudo systemctl disable --now nitro-fan-daemon.service"
    echo "      sudo rm /etc/systemd/system/nitro-fan-daemon.service && sudo systemctl daemon-reload"
    echo
fi

# Poprzednia nazwa programu (usługa / katalog / użytkownik) — zdejmij, żeby
# dwa daemony nie pisały do tego samego EC.
if [ -f /etc/systemd/system/acer-speedfan.service ] \
   || systemctl list-unit-files acer-speedfan.service >/dev/null 2>&1; then
    echo ">>> Usuwanie poprzedniej usługi acer-speedfan.service"
    systemctl disable --now acer-speedfan.service 2>/dev/null || true
    rm -f /etc/systemd/system/acer-speedfan.service
    systemctl daemon-reload || true
    systemctl reset-failed acer-speedfan.service 2>/dev/null || true
fi
if [ -d /usr/local/lib/acer-speedfan ]; then
    echo ">>> Usuwanie poprzedniego katalogu /usr/local/lib/acer-speedfan"
    rm -rf /usr/local/lib/acer-speedfan
fi
if id -u acer_speedfan >/dev/null 2>&1; then
    echo ">>> Usuwanie poprzedniego użytkownika acer_speedfan"
    userdel acer_speedfan 2>/dev/null || true
    groupdel acer_speedfan 2>/dev/null || true
fi

HAS_EC=0
grep -qs '^acer_nitro_ec$' /sys/class/hwmon/hwmon*/name 2>/dev/null && HAS_EC=1
HAS_NBFC=0
if systemctl is-active --quiet nbfc_service 2>/dev/null \
   || [ -S /run/nbfc_service.socket ] || [ -S /var/run/nbfc_service.socket ]; then
    HAS_NBFC=1
fi

if [ "$HAS_EC" -eq 1 ] && [ "$HAS_NBFC" -eq 1 ]; then
    echo "!!! UWAGA: są jednocześnie acer_nitro_ec i nbfc_service."
    echo "    Daemon wybierze acer_nitro_ec i NIE będzie pisał przez NBFC."
    echo "    Żeby nie dublować zapisu EC, wyłącz NBFC:"
    echo "      sudo systemctl disable --now nbfc_service"
    echo
elif [ "$HAS_EC" -eq 0 ] && [ "$HAS_NBFC" -eq 1 ]; then
    echo ">>> Brak acer_nitro_ec — daemon użyje nbfc_service jako backendu."
    echo "    Zostaw nbfc_service włączony. Profil: nbfc/README.md"
    echo
fi

# --- Użytkownik serwisowy ----------------------------------------------------
if ! id -u "$SVC_USER" >/dev/null 2>&1; then
    echo ">>> Tworzenie użytkownika serwisowego $SVC_USER"
    useradd -r -s /usr/sbin/nologin "$SVC_USER"
fi

# --- Daemon ------------------------------------------------------------------
echo ">>> Instalacja daemona do $LIB"
install -d -m 755 "$LIB"
# Kod należy do roota — użytkownik serwisowy nie może podmienić własnego demona.
install -o root -g root -m 755 "$SRC/nitro_fan_daemon.py" "$LIB/nitro_fan_daemon.py"
install -o root -g root -m 644 "$SRC/fan_backend.py"      "$LIB/fan_backend.py"
install -o root -g root -m 755 "$SRC/restore-auto.sh"     "$LIB/restore-auto.sh"

# --- Sterownik EC + podświetlenie klawiatury (bez DAMX) ----------------------
# Buduje acer-nitro-ec z LED 0–4 i timeout 30 s, zdejmuje stary .ko z updates/.
if [ -x "$SRC/acer-nitro-ec/install-kbd-backlight.sh" ]; then
    echo ">>> Sterownik acer-nitro-ec (wentylatory + klawiatura)"
    bash "$SRC/acer-nitro-ec/install-kbd-backlight.sh"
    HAS_EC=0
    grep -qs '^acer_nitro_ec$' /sys/class/hwmon/hwmon*/name 2>/dev/null && HAS_EC=1
fi

# --- Reguła udev: zapis do PWM i LED bez roota --------------------------------
echo ">>> Reguła udev w $UDEV_RULE"
install -o root -g root -m 644 "$SRC/99-acer-nitro-ec.rules" "$UDEV_RULE"
udevadm control --reload
udevadm trigger --subsystem-match=hwmon --action=add || true
udevadm trigger --subsystem-match=leds --action=add || true
for h in /sys/class/hwmon/hwmon*; do
    [ "$(cat "$h/name" 2>/dev/null)" = "acer_nitro_ec" ] || continue
    chgrp "$SVC_USER" "$h"/pwm1 "$h"/pwm1_enable "$h"/pwm2 "$h"/pwm2_enable
    chmod g+w "$h"/pwm1 "$h"/pwm1_enable "$h"/pwm2 "$h"/pwm2_enable
done
if [ -e /sys/devices/platform/acer-nitro-ec/kbd_backlight ]; then
    chmod 0666 /sys/devices/platform/acer-nitro-ec/kbd_backlight || true
    [ -e /sys/devices/platform/acer-nitro-ec/kbd_timeout ] && chmod 0666 /sys/devices/platform/acer-nitro-ec/kbd_timeout || true
fi

if [ "$HAS_EC" -eq 0 ] && [ "$HAS_NBFC" -eq 0 ]; then
    echo "!!! UWAGA: nie wykryto ani acer_nitro_ec, ani nbfc_service."
    echo "    Usługa będzie się restartować, dopóki nie pojawi się backend."
    echo "    Sterownik:  sudo ./acer-nitro-ec/install-kbd-backlight.sh"
    echo "    albo NBFC:  sudo ./nbfc/install-nbfc-config.sh && sudo systemctl enable --now nbfc_service"
    echo
fi

# --- Konfiguracja (zapisywalna dla użytkownika GUI, bez roota) ---------------
echo ">>> Konfiguracja w $ETC (zapisywalna dla $OWNER:$GROUP, żeby GUI działało bez roota)"
install -d -m 775 -o root -g "$GROUP" "$ETC"
if [ ! -f "$ETC/config.json" ]; then
    if [ -f "$SRC/nbfc_config.json" ]; then
        echo "    migracja istniejącego nbfc_config.json"
        install -m 664 -o root -g "$GROUP" "$SRC/nbfc_config.json" "$ETC/config.json"
    else
        echo "    zapis konfiguracji domyślnej"
        cat > "$ETC/config.json" <<'JSON'
{
    "mode": "dynamic",
    "backend": "auto",
    "profile": "Silent",
    "curve_source": "default",
    "curves": {
        "cpu": [[45, 30], [55, 30], [65, 30], [75, 42], [85, 65]],
        "gpu": [[45, 30], [55, 30], [65, 30], [75, 42], [85, 65]]
    },
    "default_profiles": {
        "Silent": {
            "cpu": [[45, 30], [55, 30], [65, 30], [75, 42], [85, 65]],
            "gpu": [[45, 30], [55, 30], [65, 30], [75, 42], [85, 65]]
        },
        "Balanced": {
            "cpu": [[45, 30], [55, 32], [65, 42], [75, 62], [85, 100]],
            "gpu": [[45, 30], [55, 32], [65, 42], [75, 62], [85, 100]]
        },
        "Turbo": {
            "cpu": [[45, 45], [55, 60], [65, 80], [75, 95], [85, 100]],
            "gpu": [[45, 45], [55, 60], [65, 80], [75, 95], [85, 100]]
        }
    },
    "manual_speeds": {"0": 30.0, "1": 30.0},
    "speed_offset": 0
}
JSON
        chown root:"$GROUP" "$ETC/config.json"
        chmod 664 "$ETC/config.json"
    fi
else
    echo "    $ETC/config.json już istnieje — nie nadpisuję"
fi

# --- Usługa -------------------------------------------------------------------
echo ">>> Rejestracja usługi $SERVICE"
install -m 644 "$SRC/acer-nitro-perfect-fan.service" "$UNIT"
systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"

sleep 3
echo
systemctl --no-pager --lines=5 status "$SERVICE" || true
echo
echo ">>> Gotowe. Podgląd na żywo:  watch -n1 sensors"
echo ">>> Diagnostyka:  ./check-system.sh"
echo ">>> GUI:  cd gui-app && npm install && npm start"
echo ">>> Instrukcja dla początkujących:  INSTALL_PL.md"
echo ">>> Odinstalowanie:  sudo ./uninstall.sh"
echo
echo "!!! OSTRZEŻENIE: ręczne PWM może przegrzać sprzęt."
echo "    CPU ma podłogę 30% w daemonie/API/GUI. Używasz na własną odpowiedzialność."
