#!/usr/bin/env bash
# Nakłada dmi-models.patch na acer-nitro-ec i przebudowuje DKMS.
#   sudo ./acer-nitro-ec/apply.sh

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH="$SRC/dmi-models.patch"
VERSION="${ACER_NITRO_EC_VERSION:-1.0.0}"
UPSTREAM="${ACER_NITRO_EC_GIT:-https://github.com/OrnelasD-Rogers/acer-nitro-ec.git}"
DEST="/usr/src/acer-nitro-ec-${VERSION}"

[ "$(id -u)" -eq 0 ] || { echo "Uruchom: sudo ./acer-nitro-ec/apply.sh"; exit 1; }
[ -f "$PATCH" ] || { echo "Brak $PATCH"; exit 1; }

if ! command -v dkms >/dev/null 2>&1; then
    echo "!!! Brak dkms. Debian/Mint:  sudo apt install dkms build-essential linux-headers-\$(uname -r)"
    exit 1
fi

KVER="$(uname -r)"
if [ ! -d "/lib/modules/$KVER/build" ]; then
    echo "!!! Brak nagłówków jądra: /lib/modules/$KVER/build"
    echo "    sudo apt install linux-headers-$KVER"
    exit 1
fi

if [ ! -d "$DEST" ]; then
    if ! command -v git >/dev/null 2>&1; then
        echo "!!! Brak $DEST i brak git — nie mogę pobrać źródeł."
        exit 1
    fi
    echo ">>> Klonuję $UPSTREAM → $DEST"
    git clone --depth 1 "$UPSTREAM" "$DEST"
fi

cd "$DEST"
if grep -q 'AN515-55' acer-nitro-ec.c 2>/dev/null; then
    echo ">>> Patch DMI już nałożony w $DEST"
else
    echo ">>> Nakładam dmi-models.patch"
    patch -p1 < "$PATCH"
fi

if dkms status -m acer-nitro-ec -v "$VERSION" 2>/dev/null | grep -q installed; then
    echo ">>> dkms remove acer-nitro-ec/$VERSION"
    dkms remove "acer-nitro-ec/$VERSION" --all || true
fi

if ! dkms status -m acer-nitro-ec -v "$VERSION" 2>/dev/null | grep -q added; then
    echo ">>> dkms add $DEST"
    dkms add "$DEST"
fi

echo ">>> dkms install acer-nitro-ec/$VERSION"
dkms install "acer-nitro-ec/$VERSION"

if lsmod | grep -q '^acer_nitro_ec'; then
    echo ">>> Przeładowuję acer_nitro_ec"
    modprobe -r acer_nitro_ec || true
fi
modprobe acer_nitro_ec || true

echo
if grep -qs '^acer_nitro_ec$' /sys/class/hwmon/hwmon*/name 2>/dev/null; then
    echo ">>> hwmon acer_nitro_ec jest widoczny."
else
    echo "!!! Moduł zainstalowany, ale hwmon się nie pojawił."
    echo "    dmesg | grep acer_nitro_ec"
    echo "    DMI: $(cat /sys/class/dmi/id/product_name 2>/dev/null || echo '?')"
fi
