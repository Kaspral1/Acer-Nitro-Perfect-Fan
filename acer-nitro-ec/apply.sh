#!/usr/bin/env bash
# Alias: pełny instalator sterownika (wentylatory + czerwona klawiatura na AN515-54).
#   sudo ./acer-nitro-ec/apply.sh
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install-kbd-backlight.sh" "$@"
