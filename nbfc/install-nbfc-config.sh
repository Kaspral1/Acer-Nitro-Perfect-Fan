#!/usr/bin/env bash
# Install the bundled Acer Nitro AN515-54 NBFC profile and select it.
#
# This does NOT start nbfc_service and does NOT stop acer-nitro-perfect-fan.
# You must pick one backend — see nbfc/README.md.
#
#   sudo ./nbfc/install-nbfc-config.sh

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="$SRC/Acer Nitro AN515-54.json"
DEST_DIR=/usr/share/nbfc/configs
DEST="$DEST_DIR/Acer Nitro AN515-54.json"
NAME="Acer Nitro AN515-54"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo ./nbfc/install-nbfc-config.sh"; exit 1; }
[ -f "$PROFILE" ] || { echo "Missing profile: $PROFILE"; exit 1; }

if ! command -v nbfc >/dev/null 2>&1; then
    echo "!!! nbfc CLI not found. Install nbfc-linux first:"
    echo "    https://github.com/nbfc-linux/nbfc-linux"
    exit 1
fi

if systemctl is-active --quiet acer-nitro-perfect-fan.service 2>/dev/null \
   || systemctl is-active --quiet acer-speedfan.service 2>/dev/null; then
    echo ">>> Acer Nitro Perfect Fan daemon is running."
    echo "    auto backend prefers acer_nitro_ec if that hwmon exists."
    echo "    To drive fans through NBFC: set \"backend\": \"nbfc\" in"
    echo "    /etc/nitro-fan/config.json and restart acer-nitro-perfect-fan."
    echo
fi

echo ">>> Installing profile → $DEST"
install -d -m 755 "$DEST_DIR"
install -m 644 "$PROFILE" "$DEST"

echo ">>> Selecting config: $NAME"
if nbfc config -a "$NAME"; then
    echo ">>> Selected. Start NBFC with:  sudo systemctl enable --now nbfc_service"
else
    echo "!!! nbfc config -a failed (is nbfc_service installed?)."
    echo "    You can still copy nbfc/nbfc.json to /etc/nbfc/nbfc.json by hand."
    exit 1
fi
