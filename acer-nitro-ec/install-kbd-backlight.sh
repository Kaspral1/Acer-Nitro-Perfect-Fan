#!/usr/bin/env bash
# Wgrywa acer-nitro-ec z podświetleniem klawiatury (EC 0x31) i regułę udev.
#   sudo ./acer-nitro-ec/install-kbd-backlight.sh
#   sudo ./acer-nitro-ec/install-kbd-backlight.sh --reload   # tylko podmiana w RAM
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SRC/.." && pwd)"
VERSION="${ACER_NITRO_EC_VERSION:-1.0.0}"
DEST="/usr/src/acer-nitro-ec-${VERSION}"
RMMOD="${RMMOD:-/usr/sbin/rmmod}"
MODPROBE="${MODPROBE:-/usr/sbin/modprobe}"
INSMOD="${INSMOD:-/usr/sbin/insmod}"
DEPMOD="${DEPMOD:-/usr/sbin/depmod}"
RELOAD_ONLY=0
[ "${1:-}" = "--reload" ] && RELOAD_ONLY=1

[ "$(id -u)" -eq 0 ] || { echo "Uruchom: sudo $0 ${1:-}"; exit 1; }

KVER="$(uname -r)"
live_src() { cat /sys/module/acer_nitro_ec/srcversion 2>/dev/null || echo none; }
module_loaded() { [ -d /sys/module/acer_nitro_ec ]; }

# GUI i daemon trzymają hwmon — sam systemctl stop nie wystarcza.
stop_module_holders() {
    echo ">>> Zatrzymuję procesy trzymające acer_nitro_ec"
    systemctl stop acer-nitro-perfect-fan.service 2>/dev/null || true
    pkill -f '/nbfc_control_api.py' 2>/dev/null || true
    pkill -f '/nitro_fan_daemon.py' 2>/dev/null || true
    pkill -f '/usr/local/lib/acer-nitro-perfect-fan/nitro_fan_daemon.py' 2>/dev/null || true
    # Electron sam odpala backend — bez tego rmmod przegrywa z otwartym hwmon
    pkill -f '/Acer Nitro Perfect Fan/gui-app' 2>/dev/null || true
    pkill -f '/acer-nitro-perfect-fan' 2>/dev/null || true
    sleep 0.6
}

unload_module() {
    if ! module_loaded; then
        echo ">>> Moduł nie jest załadowany"
        return 0
    fi
    echo ">>> LIVE przed wyładowaniem: $(live_src)  refcnt=$(cat /sys/module/acer_nitro_ec/refcnt 2>/dev/null || echo ?)"
    echo ">>> Wyładowuję acer_nitro_ec (rmmod)"
    "$RMMOD" acer_nitro_ec 2>/dev/null || "$RMMOD" -f acer_nitro_ec 2>/dev/null || true
    sleep 0.3
    if module_loaded; then
        echo ">>> rmmod nie zszedł — ponawiam po zabiciu holderów"
        stop_module_holders
        "$RMMOD" -f acer_nitro_ec 2>/dev/null || true
        sleep 0.3
    fi
    if module_loaded; then
        echo "!!! Moduł nadal w RAM (src=$(live_src) refcnt=$(cat /sys/module/acer_nitro_ec/refcnt))"
        echo "    Zamknij Acer Nitro Perfect Fan (także ikonę w tacke) i:"
        echo "    sudo $0 --reload"
        grep '^acer_nitro_ec' /proc/modules || true
        exit 1
    fi
    echo ">>> Moduł wyładowany"
}

load_new_module() {
    local disk live ko
    ko="$(modinfo -n acer-nitro-ec 2>/dev/null || true)"
    disk="$(modinfo -F srcversion acer-nitro-ec 2>/dev/null || echo none)"
    if [ -z "$ko" ] || [ "$disk" = "none" ]; then
        echo "!!! Brak pliku acer-nitro-ec w modules.dep — najpierw pełny install (bez --reload)"
        exit 1
    fi
    echo ">>> Ładuję $ko  src=$disk"
    "$MODPROBE" acer_nitro_ec
    live="$(live_src)"
    if [ "$live" != "$disk" ]; then
        echo ">>> modprobe dał '$live' zamiast '$disk' — insmod na sztywno"
        module_loaded && { "$RMMOD" -f acer_nitro_ec 2>/dev/null || true; sleep 0.2; }
        "$INSMOD" "$ko"
        live="$(live_src)"
    fi
    echo ">>> LIVE po załadowaniu: $live"
    echo ">>> plik na dysku:       $disk  ($ko)"
    if [ "$live" = "none" ] || [ "$live" != "$disk" ]; then
        echo "!!! W RAM-ie nie ma świeżo zbudowanego modułu"
        exit 1
    fi
}

install_udev_and_check_kbd() {
    echo ">>> udev"
    install -o root -g root -m 644 "$ROOT/99-acer-nitro-ec.rules" /etc/udev/rules.d/99-acer-nitro-ec.rules
    udevadm control --reload
    udevadm trigger --subsystem-match=platform --action=add || true
    local kbd=/sys/devices/platform/acer-nitro-ec/kbd_backlight
    local kto=/sys/devices/platform/acer-nitro-ec/kbd_timeout
    local model
    model="$(cat /sys/class/dmi/id/product_name 2>/dev/null || true)"
    if [ -e "$kbd" ]; then
        chgrp acer_nitro_perfect_fan "$kbd" 2>/dev/null || true
        chmod 0664 "$kbd" || true
        if [ -e "$kto" ]; then
            chgrp acer_nitro_perfect_fan "$kto" 2>/dev/null || true
            chmod 0664 "$kto" || true
        fi
        echo ">>> KBD OK: level=$(cat "$kbd") timeout=$(cat "$kto" 2>/dev/null || echo n/a)"
    elif echo "$model" | grep -q 'AN515-54'; then
        echo "!!! Brak $kbd na $model"
        dmesg | grep -i 'acer-nitro\|kbd_' | tail -20 || true
        exit 1
    else
        echo ">>> Model '$model' — sysfs klawiatury tylko na AN515-54."
    fi
}

if [ "$RELOAD_ONLY" -eq 1 ]; then
    echo ">>> Tryb --reload (bez przebudowy DKMS)"
    stop_module_holders
    unload_module
    load_new_module
    systemctl start acer-nitro-perfect-fan.service 2>/dev/null || true
    install_udev_and_check_kbd
    echo "done"
    exit 0
fi

[ -f "$SRC/acer-nitro-ec.c" ] || { echo "Brak $SRC/acer-nitro-ec.c"; exit 1; }

if ! command -v dkms >/dev/null 2>&1; then
    echo "!!! Brak dkms.  sudo apt install dkms build-essential linux-headers-\$(uname -r)"
    exit 1
fi

if [ ! -d "/lib/modules/$KVER/build" ]; then
    echo "!!! Brak nagłówków: sudo apt install linux-headers-$KVER"
    exit 1
fi

echo ">>> Kopiuję źródła do $DEST"
mkdir -p "$DEST"
install -m 644 "$SRC/acer-nitro-ec.c" "$DEST/acer-nitro-ec.c"
install -m 644 "$SRC/Makefile" "$DEST/Makefile"
install -m 644 "$SRC/dkms.conf" "$DEST/dkms.conf"
# Lipcowy leftover /usr/src/.../acer-nitro-ec.ko (8CB7197B) = to, co siedzi w RAM.
echo ">>> Usuwam stare artefakty .ko/.o z $DEST"
rm -f "$DEST"/acer-nitro-ec.ko "$DEST"/acer-nitro-ec.o \
      "$DEST"/acer-nitro-ec.mod "$DEST"/acer-nitro-ec.mod.c \
      "$DEST"/acer-nitro-ec.mod.o "$DEST"/Module.symvers \
      "$DEST"/modules.order "$DEST"/.module-common.o
rm -f "$DEST"/.acer-nitro-ec.*.cmd "$DEST"/.Module.symvers.cmd \
      "$DEST"/.modules.order.cmd "$DEST"/..module-common.o.cmd

if dkms status -m acer-nitro-ec -v "$VERSION" 2>/dev/null | grep -q installed; then
    echo ">>> dkms remove acer-nitro-ec/$VERSION"
    dkms remove "acer-nitro-ec/$VERSION" --all || true
fi
if ! dkms status -m acer-nitro-ec -v "$VERSION" 2>/dev/null | grep -q added; then
    dkms add "$DEST"
fi

echo ">>> dkms install acer-nitro-ec/$VERSION"
dkms install "acer-nitro-ec/$VERSION"

# Stary plik z lipca w updates/ (poza dkms/) wygrywa z nowym — kasuj oba warianty.
echo ">>> Usuwam ewentualny stary updates/acer-nitro-ec.ko"
rm -f "/lib/modules/$KVER/updates/acer-nitro-ec.ko" \
      "/lib/modules/$KVER/updates/acer-nitro-ec.ko.zst"
"$DEPMOD" -a "$KVER"

stop_module_holders
unload_module
load_new_module

systemctl start acer-nitro-perfect-fan.service 2>/dev/null || true
install_udev_and_check_kbd
echo "done"
