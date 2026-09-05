#!/usr/bin/env bash
# One-command setup for Acer Nitro Perfect Fan:
#   1. install packages (apt / dnf / pacman / zypper)
#   2. check the laptop (./check-system.sh)
#   3. install the selected fan backend integration + system service (sudo ./install.sh)
#   4. build the GUI dependencies (npm install)
#
# Run it as a normal user from the repo folder — it asks for sudo when needed:
#
#   ./setup.sh

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

step() { printf '\n>>> %s\n' "$*"; }

[ -f install.sh ] || { echo "Run this from the repo folder (install.sh not found)."; exit 1; }
[ "$(id -u)" -ne 0 ] || { echo "Do not run as root — start it as your normal user:  ./setup.sh"; exit 1; }

echo "=== Acer Nitro Perfect Fan — setup ==="
MODEL="$(cat /sys/class/dmi/id/product_name 2>/dev/null || true)"
IS_AN16_41=0
case "$MODEL" in *AN16-41*) IS_AN16_41=1 ;; esac
if [ "$IS_AN16_41" -eq 1 ]; then
    echo "Detected $MODEL: the installer will use DAMX/linuwu_sense and will not install acer_nitro_ec."
else
    echo "This will install system packages, a fan driver and a background service (sudo)."
fi
printf 'Continue? [Y/n] '
read -r ANSWER
case "${ANSWER:-Y}" in [nN]*) echo "Aborted."; exit 0 ;; esac

# --- 1. Packages ---------------------------------------------------------------
step "1/4  Packages"
KERN="$(uname -r)"
if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    if [ "$IS_AN16_41" -eq 1 ]; then
        sudo apt-get install -y git python3 nodejs npm lm-sensors
    else
        sudo apt-get install -y git python3 nodejs npm lm-sensors dkms build-essential "linux-headers-$KERN"
    fi
elif command -v dnf >/dev/null 2>&1; then
    if [ "$IS_AN16_41" -eq 1 ]; then
        sudo dnf install -y git python3 nodejs npm lm_sensors
    else
        sudo dnf install -y git python3 nodejs npm lm_sensors dkms gcc make "kernel-devel-$KERN"
    fi
elif command -v pacman >/dev/null 2>&1; then
    if [ "$IS_AN16_41" -eq 1 ]; then
        sudo pacman -S --needed --noconfirm git python nodejs npm lm_sensors
    else
        sudo pacman -S --needed --noconfirm git python nodejs npm lm_sensors dkms base-devel linux-headers
    fi
elif command -v zypper >/dev/null 2>&1; then
    if [ "$IS_AN16_41" -eq 1 ]; then
        sudo zypper install -y git python3 nodejs npm sensors
    else
        sudo zypper install -y git python3 nodejs npm sensors dkms gcc make kernel-default-devel
    fi
else
    if [ "$IS_AN16_41" -eq 1 ]; then
        echo "Unknown package manager. Install manually: git python3 nodejs npm lm-sensors"
    else
        echo "Unknown package manager. Install manually: git python3 nodejs npm lm-sensors dkms kernel headers"
    fi
fi

# --- 2. Compatibility check ----------------------------------------------------
step "2/4  Laptop check"
chmod +x check-system.sh install.sh 2>/dev/null || true
VERDICT=2
./check-system.sh && VERDICT=0 || VERDICT=$?
case "$VERDICT" in
    0) ;;
    1)
        if [ "$IS_AN16_41" -eq 1 ]; then
            echo
            echo "AN16-41 needs DAMX before Perfect Fan can be installed."
            echo "Install the official DAMX release, reboot, then run ./setup.sh again:"
            echo "https://github.com/PXDiv/Div-Acer-Manager-Max/releases"
            exit 1
        fi
        echo
        echo "The check returned MAYBE. The steps above explain what is missing."
        printf 'Install anyway? [y/N] '
        read -r FORCE_ANSWER
        case "${FORCE_ANSWER:-N}" in
            [yY]*) ;;
            *) echo "Aborted."; exit 1 ;;
        esac
        ;;
    *)
        echo
        if [ "$IS_AN16_41" -eq 1 ]; then
            echo "The AN16-41 check returned NO. Fix the kernel/DAMX/backend conflict shown above,"
            echo "then run ./setup.sh again. This safety check cannot be bypassed."
        else
            echo "The check returned NO: no supported fan backend on this laptop."
            echo "Setup stops here so nothing half-broken gets installed."
            echo "If nbfc-linux supports your model, follow INSTALL.md (NBFC path) first."
        fi
        exit 1
        ;;
esac

# --- 3. Driver + system service ------------------------------------------------
step "3/4  Fan backend + system service"
sudo ./install.sh

# --- 4. GUI dependencies -------------------------------------------------------
step "4/4  GUI dependencies"
(cd gui-app && npm install)

echo
echo "=== Done ==="
echo "Start the app with:"
echo "    cd gui-app && npm start"
echo "The fan service already runs in the background and starts at boot."
echo "If the window shows OFFLINE, run ./check-system.sh and read the verdict."
