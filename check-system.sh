#!/usr/bin/env bash
# Read-only compatibility check. Changes nothing: no fans, services, or files.
# Prints a final YES / MAYBE / NO verdict and the exact next step.
#
#   ./check-system.sh

set -u

ok()   { printf '  [OK]   %s\n' "$*"; }
warn() { printf '  [!!]   %s\n' "$*"; }
info() { printf '  [--]   %s\n' "$*"; }

# Models with the same EC map (handled by the bundled acer-nitro-ec driver).
EC_MODELS="AN515-44 AN515-46 AN515-54 AN515-56 AN515-57 AN515-58 AN517-55"
# Extra models the repo patch can add — not fully verified.
EC_EXTRA="AN515-51 AN515-55 AN517-51 AN517-54"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Acer Nitro Perfect Fan — system check (read-only) ==="
echo

# --- Laptop -------------------------------------------------------------------
MODEL="$(cat /sys/class/dmi/id/product_name 2>/dev/null || echo '(no DMI)')"
VENDOR="$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null || echo '?')"
IS_AN16_41=0
case "$MODEL" in *AN16-41*) IS_AN16_41=1 ;; esac
echo "Laptop"
info "vendor:  $VENDOR"
info "model:   $MODEL"
info "kernel:  $(uname -r)"
info "distro:  $(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-?}" || uname -s)"

MODEL_OK=0        # on the EC driver list
MODEL_EXTRA=0     # patchable, not verified
for m in $EC_MODELS; do
    case "$MODEL" in *"$m"*) MODEL_OK=1 ;; esac
done
if [ "$MODEL_OK" -eq 0 ]; then
    for m in $EC_EXTRA; do
        case "$MODEL" in *"$m"*) MODEL_EXTRA=1 ;; esac
    done
fi
if [ "$IS_AN16_41" -eq 1 ]; then
    ok "model has a dedicated DAMX/linuwu_sense installation path"
elif [ "$MODEL_OK" -eq 1 ]; then
    ok "model is on the supported list (acer-nitro-ec driver)"
elif [ "$MODEL_EXTRA" -eq 1 ]; then
    warn "model is patchable but NOT fully verified ($EC_EXTRA)"
else
    info "model has no dedicated repo path - only a verified NBFC profile may work"
fi
echo

KERNEL_OK=0
[ "$(printf '%s\n%s\n' '6.13' "$(uname -r | cut -d- -f1)" | sort -V | head -n1)" = "6.13" ] && KERNEL_OK=1

# --- Tools ---------------------------------------------------------------------
echo "Tools"
for t in git python3 node npm systemctl dkms; do
    if [ "$IS_AN16_41" -eq 1 ] && [ "$t" = "dkms" ]; then
        info "dkms not required on the AN16-41 DAMX path"
        continue
    fi
    if command -v "$t" >/dev/null 2>&1; then
        ok "$t"
    else
        case "$t" in
            git)       warn "missing git — sudo apt install git" ;;
            python3)   warn "missing python3 — sudo apt install python3" ;;
            node|npm)  warn "missing $t — sudo apt install nodejs npm" ;;
            systemctl) warn "missing systemd — this project needs systemd" ;;
            dkms)      info "missing dkms (needed to build the EC driver) — sudo apt install dkms" ;;
        esac
    fi
done
if command -v sensors >/dev/null 2>&1; then
    ok "lm-sensors"
else
    info "no lm-sensors (optional): sudo apt install lm-sensors"
fi
if [ "$IS_AN16_41" -eq 1 ]; then
    info "kernel headers not required on the AN16-41 DAMX path"
elif [ -d "/lib/modules/$(uname -r)/build" ]; then
    ok "kernel headers ($(uname -r))"
else
    warn "no kernel headers — sudo apt install linux-headers-\$(uname -r)"
fi

# Secure Boot blocks unsigned DKMS modules (the EC driver).
SB="unknown"
if command -v mokutil >/dev/null 2>&1; then
    case "$(mokutil --sb-state 2>/dev/null)" in
        *enabled*)  SB=on ;;
        *disabled*) SB=off ;;
    esac
else
    EFIVAR="$(echo /sys/firmware/efi/efivars/SecureBoot-* 2>/dev/null)"
    if [ -f "$EFIVAR" ]; then
        [ "$(od -An -j4 -tu1 "$EFIVAR" 2>/dev/null | tr -d ' \n')" = "1" ] && SB=on || SB=off
    fi
fi
if [ "$IS_AN16_41" -eq 1 ]; then
    info "Secure Boot does not affect the skipped acer_nitro_ec DKMS path"
else
    case "$SB" in
        on)  warn "Secure Boot is ON - an unsigned DKMS driver may not load (disable it or sign the module)" ;;
        off) ok "Secure Boot is off" ;;
        *)   info "Secure Boot state unknown" ;;
    esac
fi
echo

# --- Fan backend ---------------------------------------------------------------
echo "Fan backend"
HAS_EC=0
if [ -d /sys/module/acer_nitro_ec ] \
   || grep -qs '^acer_nitro_ec$' /sys/class/hwmon/hwmon*/name 2>/dev/null; then
    HAS_EC=1
    HWMON="$(grep -l '^acer_nitro_ec$' /sys/class/hwmon/hwmon*/name 2>/dev/null | head -1 || true)"
    if [ -n "$HWMON" ]; then
        ok "acer_nitro_ec loaded (${HWMON%/name})"
    else
        warn "acer_nitro_ec module loaded without its hwmon device"
    fi
else
    if [ "$IS_AN16_41" -eq 1 ]; then
        info "acer_nitro_ec not loaded (correct for the AN16-41 DAMX path)"
    else
        info "acer_nitro_ec not loaded yet - the installer loads it on supported models"
    fi
fi

HAS_NBFC=0
if [ -S /run/nbfc_service.socket ] || [ -S /var/run/nbfc_service.socket ]; then
    HAS_NBFC=1
    ok "nbfc_service socket present"
    if [ -f /etc/nbfc/nbfc.json ]; then
        PROF="$(grep -o '"SelectedConfigId"[^,}]*' /etc/nbfc/nbfc.json 2>/dev/null | cut -d'"' -f4)"
        [ -n "$PROF" ] && ok "NBFC profile selected: $PROF" || warn "NBFC has no profile selected — run: nbfc config -l"
    fi
elif command -v nbfc >/dev/null 2>&1; then
    info "nbfc installed but the service is not running — sudo systemctl enable --now nbfc_service"
else
    info "no nbfc-linux (fine on supported Nitro models; required on other laptops)"
fi
HAS_DAMX=0
if command -v python3 >/dev/null 2>&1 && { [ -S /run/DAMX.sock ] || [ -S /var/run/DAMX.sock ]; }; then
    if PYTHONPATH="$SCRIPT_DIR" python3 -c 'from fan_backend import BACKEND_DAMX, detect_backend; detect_backend(BACKEND_DAMX)' >/dev/null 2>&1; then
        HAS_DAMX=1
        ok "DAMX socket responds and exposes fan_speed"
    else
        warn "DAMX socket exists, but fan_speed is unavailable"
    fi
elif [ "$IS_AN16_41" -eq 1 ]; then
    info "DAMX is not running (required for the AN16-41 path)"
fi
if [ "$HAS_EC" -eq 1 ] && [ "$HAS_NBFC" -eq 1 ]; then
    warn "both backends present — the daemon in auto mode uses hwmon and will not write via NBFC"
fi
if [ "$IS_AN16_41" -eq 1 ] && { [ "$HAS_EC" -eq 1 ] || [ "$HAS_NBFC" -eq 1 ]; }; then
    warn "AN16-41 must use only DAMX; disable acer_nitro_ec/NBFC before installation"
fi
echo

# --- Service -------------------------------------------------------------------
echo "Service"
if systemctl list-unit-files acer-nitro-perfect-fan.service >/dev/null 2>&1; then
    STATE="$(systemctl is-active acer-nitro-perfect-fan.service 2>/dev/null || true)"
    ENABLED="$(systemctl is-enabled acer-nitro-perfect-fan.service 2>/dev/null || true)"
    if [ "$STATE" = "active" ]; then
        ok "acer-nitro-perfect-fan.service = $STATE (enabled: $ENABLED)"
    else
        warn "acer-nitro-perfect-fan.service = ${STATE:-missing} (enabled: ${ENABLED:-?})"
    fi
else
    info "service not installed yet — sudo ./install.sh"
fi
echo

# --- Verdict -------------------------------------------------------------------
# Exit code: 0 = YES (supported), 1 = MAYBE (needs a manual step), 2 = NO.
echo "=== Verdict ==="
VERDICT=2
if ! command -v systemctl >/dev/null 2>&1; then
    warn "NO — this project needs Linux with systemd."
elif [ "$IS_AN16_41" -eq 1 ] && [ "$KERNEL_OK" -eq 0 ]; then
    warn "NO - AN16-41 through DAMX requires Linux kernel 6.13 or newer."
elif [ "$IS_AN16_41" -eq 1 ] && { [ "$HAS_EC" -eq 1 ] || [ "$HAS_NBFC" -eq 1 ]; }; then
    warn "NO - conflicting fan backend detected; AN16-41 uses DAMX only."
elif [ "$IS_AN16_41" -eq 1 ] && [ "$HAS_DAMX" -eq 1 ]; then
    VERDICT=0
    ok "YES - AN16-41 will use the dedicated DAMX installation path."
    info "Continue with:  sudo ./install.sh"
elif [ "$IS_AN16_41" -eq 1 ]; then
    VERDICT=1
    warn "MAYBE - AN16-41 is supported, but DAMX with fan_speed must be installed first."
    info "Official releases: https://github.com/PXDiv/Div-Acer-Manager-Max/releases"
elif [ "$HAS_EC" -eq 1 ]; then
    VERDICT=0
    ok "YES — the EC driver is loaded. Install or finish with:  sudo ./install.sh"
elif [ "$MODEL_OK" -eq 1 ]; then
    if [ "$SB" = "on" ]; then
        VERDICT=1
        warn "MAYBE — model is supported, but Secure Boot may block the unsigned driver."
        info "Turn Secure Boot off (or sign the module), then:  sudo ./install.sh"
    else
        VERDICT=0
        ok "YES — supported model. The installer will load the driver:  sudo ./install.sh"
    fi
elif [ "$MODEL_EXTRA" -eq 1 ]; then
    VERDICT=1
    warn "MAYBE — $MODEL can work with the driver patch, but is not fully verified."
    info "Try:  sudo ./acer-nitro-ec/apply.sh  then re-run  ./check-system.sh"
elif [ "$HAS_NBFC" -eq 1 ]; then
    VERDICT=0
    ok "YES (via NBFC) — set \"backend\": \"nbfc\" in /etc/nitro-fan/config.json after install."
    info "Make sure the selected NBFC profile matches:  nbfc config -l"
elif command -v nbfc >/dev/null 2>&1; then
    VERDICT=1
    warn "MAYBE (via NBFC) — start the service and select your profile:"
    info "nbfc config -l   →   sudo nbfc config -a \"Your Model\"   →   sudo systemctl enable --now nbfc_service"
else
    warn "NO (yet) — no fan backend for '$MODEL'."
    info "If nbfc-linux has a profile for this model, install it first; otherwise this app cannot help."
fi
echo
echo "Paste this output into a GitHub issue if something is wrong."
echo "Service logs:  journalctl -u acer-nitro-perfect-fan.service -n 40 --no-pager"
exit "$VERDICT"
