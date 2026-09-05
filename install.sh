#!/usr/bin/env bash
# Instalacja daemona Acer Nitro Perfect Fan (Linux + systemd).
# Backend: acer_nitro_ec, nbfc-linux albo DAMX na AN16-41 - patrz INSTALL_PL.md.
#
# Repozytorium zwykle leży w /home (bywa zaszyfrowane, montowane przy logowaniu)
# — dlatego daemon i jego konfiguracja są kopiowane na /, gdzie systemd
# widzi je od startu systemu.
#
# Wymagania: właściwy backend dla modelu (acer_nitro_ec, NBFC lub DAMX).
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

# --- Wykrywanie backendu ------------------------------------------------------
HAS_EC=0
if [ -d /sys/module/acer_nitro_ec ] \
   || grep -qs '^acer_nitro_ec$' /sys/class/hwmon/hwmon*/name 2>/dev/null; then
    HAS_EC=1
fi
HAS_NBFC=0
if systemctl is-active --quiet nbfc_service 2>/dev/null \
   || [ -S /run/nbfc_service.socket ] || [ -S /var/run/nbfc_service.socket ]; then
    HAS_NBFC=1
fi
HAS_DAMX=0
if [ -S /run/DAMX.sock ] || [ -S /var/run/DAMX.sock ]; then
    if PYTHONPATH="$SRC" python3 -c 'from fan_backend import BACKEND_DAMX, detect_backend; detect_backend(BACKEND_DAMX)' >/dev/null 2>&1; then
        HAS_DAMX=1
    fi
fi

MODEL="$(cat /sys/class/dmi/id/product_name 2>/dev/null || true)"
IS_AN16_41=0
case "$MODEL" in
    *AN16-41*) IS_AN16_41=1 ;;
esac
CASE_MODEL_SUPPORTED=0
case "$MODEL" in
    *AN515-44*|*AN515-46*|*AN515-54*|*AN515-56*|*AN515-57*|*AN515-58*|*AN517-55*)
        CASE_MODEL_SUPPORTED=1
        ;;
esac

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

# AN16-41 używa sprawdzonego stosu DAMX/linuwu_sense, nigdy starego sterownika EC.
USE_DAMX=0
if [ "$IS_AN16_41" -eq 1 ]; then
    echo ">>> Wykryto Acer Nitro AN16-41 - wybieram wariant DAMX/linuwu_sense."
    KERNEL_VERSION="$(uname -r | cut -d- -f1)"
    if [ "$(printf '%s\n%s\n' '6.13' "$KERNEL_VERSION" | sort -V | head -n1)" != "6.13" ]; then
        echo "!!! STOP: AN16-41 przez DAMX wymaga jądra Linux 6.13 lub nowszego (jest $KERNEL_VERSION)."
        echo "    Opcja --force nie omija tego zabezpieczenia."
        exit 1
    fi
    if [ "$HAS_EC" -eq 1 ] || [ "$HAS_NBFC" -eq 1 ]; then
        echo "!!! STOP: AN16-41 ma aktywny konfliktujący backend acer_nitro_ec lub NBFC."
        echo "    Wyłącz go przed instalacją; na tym modelu program używa wyłącznie DAMX."
        exit 1
    fi
    if [ "$HAS_DAMX" -eq 0 ]; then
        echo "!!! STOP: AN16-41 wymaga działającego DAMX z funkcją fan_speed."
        echo "    Zainstaluj DAMX z oficjalnego wydania, uruchom ponownie system i wróć do ./setup.sh:"
        echo "    https://github.com/PXDiv/Div-Acer-Manager-Max/releases"
        echo "    Opcja --force nie omija tego zabezpieczenia."
        exit 1
    fi
    USE_DAMX=1
fi

# Nie instaluj na sprzęcie, którym daemon nie miałby czym sterować.
if [ "$FORCE" -eq 0 ] && [ "$CASE_MODEL_SUPPORTED" -eq 0 ] && [ "$HAS_EC" -eq 0 ] && [ "$HAS_NBFC" -eq 0 ] && [ "$USE_DAMX" -eq 0 ]; then
    echo "!!! STOP: model '$MODEL' nie jest na liście obsługiwanych i nie wykryto nbfc_service."
    echo "    Bez backendu wentylatorów usługa nie miałaby czym sterować."
    echo "    Jeśli nbfc-linux obsługuje ten model: zainstaluj nbfc, wybierz profil"
    echo "    (nbfc config -l, potem sudo nbfc config -a \"Model\") i uruchom nbfc_service, potem wróć tutaj."
    echo "    Świadome wymuszenie: sudo ./install.sh --force"
    exit 1
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

if [ "$USE_DAMX" -eq 1 ]; then
    if ! runuser -u "$SVC_USER" -- env PYTHONPATH="$LIB" /usr/bin/python3 -c 'from fan_backend import BACKEND_DAMX, detect_backend; detect_backend(BACKEND_DAMX)' >/dev/null 2>&1; then
        echo "!!! STOP: użytkownik usługi $SVC_USER nie ma dostępu do DAMX.sock lub fan_speed."
        echo "    Sprawdź uprawnienia gniazda i usługę damx-daemon."
        exit 1
    fi
fi

# --- Sterownik EC + podświetlenie klawiatury (bez DAMX) ----------------------
# Buduje acer-nitro-ec z LED 0–4 i timeout 30 s, zdejmuje stary .ko z updates/.
if [ "$USE_DAMX" -eq 1 ]; then
    echo ">>> Pomijam acer-nitro-ec i reguły EC - AN16-41 korzysta z DAMX."
elif [ "$CASE_MODEL_SUPPORTED" -eq 1 ] && [ -x "$SRC/acer-nitro-ec/install-kbd-backlight.sh" ]; then
    echo ">>> Sterownik acer-nitro-ec (wentylatory + klawiatura)"
    bash "$SRC/acer-nitro-ec/install-kbd-backlight.sh"
    HAS_EC=0
    grep -qs '^acer_nitro_ec$' /sys/class/hwmon/hwmon*/name 2>/dev/null && HAS_EC=1
elif [ "$CASE_MODEL_SUPPORTED" -eq 0 ] && [ "$HAS_NBFC" -eq 1 ]; then
    echo ">>> Model '$MODEL' — pomijam acer-nitro-ec; użyję nbfc_service."
fi

# Po próbie załadowania sterownika: bez żadnego backendu nie instaluj usługi,
# która tylko restartowałaby się w pętli.
if [ "$FORCE" -eq 0 ] && [ "$HAS_EC" -eq 0 ] && [ "$HAS_NBFC" -eq 0 ] && [ "$USE_DAMX" -eq 0 ]; then
    echo "!!! STOP: nie wykryto ani acer_nitro_ec, ani nbfc_service."
    echo "    Sterownik nie załadował się (Secure Boot? brak nagłówków jądra?)."
    echo "    Diagnostyka: ./check-system.sh"
    echo "    Świadome wymuszenie: sudo ./install.sh --force"
    exit 1
fi

# --- Reguła udev: zapis do PWM i LED bez roota --------------------------------
if [ "$USE_DAMX" -eq 0 ]; then
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
else
    echo ">>> Pomijam regułę udev EC (DAMX zarządza dostępem do linuwu_sense)"
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
if [ "$USE_DAMX" -eq 1 ]; then
    python3 - "$ETC/config.json" <<'PY'
import json
import os
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
data["backend"] = "damx"
tmp = path.with_name(f".{path.name}.damx.tmp")
tmp.write_text(json.dumps(data, indent=4) + "\n", encoding="utf-8")
os.replace(tmp, path)
PY
    chown root:"$GROUP" "$ETC/config.json"
    chmod 664 "$ETC/config.json"
    echo "    backend ustawiony na damx dla AN16-41"
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
