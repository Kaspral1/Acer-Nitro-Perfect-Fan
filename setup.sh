#!/usr/bin/env bash
# One-command setup for Acer Nitro Perfect Fan:
#   1. install packages (apt / dnf / pacman / zypper)
#   2. check the laptop (./check-system.sh)
#   3. install the fan driver + system service (sudo ./install.sh)
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
echo "This will install system packages, a fan driver and a background service (sudo)."
printf 'Continue? [Y/n] '
read -r ANSWER
case "${ANSWER:-Y}" in [nN]*) echo "Aborted."; exit 0 ;; esac

# --- 1. Packages ---------------------------------------------------------------
step "1/4  Packages"
KERN="$(uname -r)"
if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y git python3 nodejs npm lm-sensors dkms build-essential "linux-headers-$KERN"
elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y git python3 nodejs npm lm_sensors dkms gcc make "kernel-devel-$KERN"
elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --needed --noconfirm git python nodejs npm lm_sensors dkms base-devel linux-headers
elif command -v zypper >/dev/null 2>&1; then
    sudo zypper install -y git python3 nodejs npm sensors dkms gcc make kernel-default-devel
else
    echo "Unknown package manager. Install manually: git python3 nodejs npm lm-sensors dkms kernel headers"
fi

# --- 2. Compatibility check ----------------------------------------------------
step "2/4  Laptop check"
chmod +x check-system.sh install.sh 2>/dev/null || true
./check-system.sh || true

# --- 3. Driver + system service ------------------------------------------------
step "3/4  Fan driver + system service"
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
