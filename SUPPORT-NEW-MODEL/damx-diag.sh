#!/bin/bash
# damx-diag.sh - remote DAMX diagnostics for Acer laptops (incl. AN16-41)
#
# Usage:
#   ./damx-diag.sh pre    - BEFORE installing DAMX (read-only, changes nothing)
#   ./damx-diag.sh post   - AFTER installing DAMX and rebooting (verification + short fan test)
#
# Output: report file ~/damx-report-<mode>.txt - attach it to the GitHub issue.
# This script does NOT install DAMX and does not change system settings
# (except for a few-second fan test in "post" mode, after which it restores
# automatic fan control).

set -u
MODE="${1:-}"
REPORT="$HOME/damx-report-${MODE:-none}.txt"

if [ "$MODE" != "pre" ] && [ "$MODE" != "post" ]; then
    echo "Usage: $0 pre|post"
    echo "  pre  - diagnostics before installing DAMX (safe, read-only)"
    echo "  post - verification after installing DAMX and rebooting"
    exit 1
fi

# All output goes to the screen and to the report file.
exec > >(tee "$REPORT") 2>&1

echo "=================================================="
echo " DAMX diagnostics - mode: $MODE"
echo " Date: $(date)"
echo "=================================================="

section() {
    echo ""
    echo "--- $1 ---"
}

have() { command -v "$1" >/dev/null 2>&1; }

read_file() {
    # read_file <path> <label>
    if [ -r "$1" ]; then
        echo "$2: $(cat "$1" 2>/dev/null)"
    else
        echo "$2: (file $1 not found)"
    fi
}

kernel_at_least() {
    # kernel_at_least <major.minor> - version comparison
    [ "$(printf '%s\n%s\n' "$1" "$(uname -r | cut -d- -f1)" | sort -V | head -n1)" = "$1" ]
}

# =========================================================
# Common part: hardware and system identification
# =========================================================
section "Hardware (DMI)"
read_file /sys/class/dmi/id/sys_vendor "Vendor"
read_file /sys/class/dmi/id/product_name "Model"
read_file /sys/class/dmi/id/bios_version "BIOS"

section "System"
if [ -r /etc/os-release ]; then
    grep '^PRETTY_NAME=' /etc/os-release
fi
echo "Kernel: $(uname -r)"
if kernel_at_least "6.13"; then
    echo "Kernel version: OK (>= 6.13, DAMX requirement)"
else
    echo "WARNING: kernel < 6.13 - DAMX requires at least 6.13!"
fi
if [ -e "/lib/modules/$(uname -r)/build" ]; then
    echo "Kernel headers: OK (needed to build the driver)"
else
    echo "WARNING: kernel headers missing (linux-headers / kernel-devel package) - the DAMX driver will not build"
fi
if have mokutil; then
    echo "Secure Boot: $(mokutil --sb-state 2>/dev/null | head -n1)"
else
    echo "Secure Boot: could not check (mokutil missing)"
fi

section "Potential conflicts"
if lsmod 2>/dev/null | grep -q '^acer_wmi'; then
    echo "acer_wmi: loaded (stock driver - the DAMX installer will replace it, this is normal)"
else
    echo "acer_wmi: not loaded"
fi
if have systemctl && systemctl is-active --quiet nbfc_service 2>/dev/null; then
    echo "WARNING: nbfc-linux is RUNNING - conflict! Disable it before installing DAMX: sudo systemctl disable --now nbfc_service"
else
    echo "nbfc-linux: not running (OK)"
fi
if have systemctl && systemctl is-active --quiet damx-daemon 2>/dev/null; then
    echo "damx-daemon: running (is DAMX already installed?)"
fi

section "Basic sensors (before DAMX)"
if have sensors; then
    sensors 2>/dev/null | grep -Ei 'fan|temp|°C' | head -n 20
else
    echo "lm-sensors not installed (not required, but helpful: sudo apt install lm-sensors)"
fi

# =========================================================
# "pre" mode ends here
# =========================================================
if [ "$MODE" = "pre" ]; then
    section "Done (pre mode)"
    echo "Nothing was changed on your system."
    echo "Keep the report: $REPORT"
    echo "You will attach it to the GitHub issue (step 4 in INSTRUCTIONS.md)."
    exit 0
fi

# =========================================================
# "post" mode: DAMX installation verification
# =========================================================
section "damx-daemon service"
if have systemctl; then
    systemctl status damx-daemon --no-pager -l 2>&1 | head -n 15
else
    echo "no systemctl?!"
fi

section "IPC socket /var/run/DAMX.sock"
if [ -S /var/run/DAMX.sock ]; then
    echo "Socket: present (OK)"
    if have python3; then
        python3 - <<'PYEOF'
import json, socket
def cmd(c, p=None):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(3)
    s.connect("/var/run/DAMX.sock")
    s.sendall(json.dumps({"command": c, "params": p or {}}).encode())
    data = s.recv(65536).decode(errors="replace")
    s.close()
    return data
for c in ("ping", "get_version", "get_supported_features", "get_all_settings"):
    try:
        print(f"{c}: {cmd(c)}")
    except Exception as e:
        print(f"{c}: ERROR: {e}")
PYEOF
    else
        echo "python3 missing - skipping socket communication test"
    fi
else
    echo "ERROR: socket missing - the DAMX daemon is not running. Check the log: sudo tail -50 /var/log/DAMX_Daemon_Log.log"
fi

section "linuwu_sense driver (sysfs)"
SYSFS="/sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi"
if [ -d /sys/module/linuwu_sense ]; then
    echo "linuwu_sense module: loaded (OK)"
else
    echo "ERROR: linuwu_sense module NOT loaded (driver failed to build or load)"
fi
for grp in nitro_sense predator_sense; do
    if [ -d "$SYSFS/$grp" ]; then
        echo "Group $grp: available"
        ls "$SYSFS/$grp" 2>/dev/null | sed 's/^/  - /'
    fi
done
FAN_CTL=""
for grp in nitro_sense predator_sense; do
    [ -w "$SYSFS/$grp/fan_speed" ] && FAN_CTL="$SYSFS/$grp/fan_speed" && break
    [ -e "$SYSFS/$grp/fan_speed" ] && FAN_CTL="$SYSFS/$grp/fan_speed" && break
done
if [ -n "$FAN_CTL" ]; then
    echo "fan_speed: $FAN_CTL = $(cat "$FAN_CTL" 2>/dev/null || echo 'read requires privileges')"
else
    echo "fan_speed: not found"
fi
if [ -r /sys/firmware/acpi/platform_profile_choices ]; then
    echo "Thermal profiles: $(cat /sys/firmware/acpi/platform_profile_choices)"
    echo "Active profile: $(cat /sys/firmware/acpi/platform_profile 2>/dev/null)"
fi

section "hwmon sensors (DAMX)"
HWMON_ACER=""
for h in /sys/class/hwmon/hwmon*; do
    [ -r "$h/name" ] || continue
    if [ "$(cat "$h/name")" = "acer" ]; then
        HWMON_ACER="$h"
        break
    fi
done
if [ -n "$HWMON_ACER" ]; then
    echo "hwmon 'acer': $HWMON_ACER (OK)"
    for f in "$HWMON_ACER"/temp*_input; do
        [ -r "$f" ] && echo "  $(basename "$f"): $(( $(cat "$f") / 1000 )) °C"
    done
    for f in "$HWMON_ACER"/fan*_input; do
        [ -r "$f" ] && echo "  $(basename "$f"): $(cat "$f") RPM"
    done
else
    echo "hwmon 'acer': missing (RPM/temperatures may be unavailable on this model)"
fi

section "Fan test (a few seconds)"
if [ -n "$FAN_CTL" ]; then
    echo "NOTE: for ~8 seconds the fans will be set to 50%, then return to auto mode."
    restore_auto() {
        echo "0,0" | sudo tee "$FAN_CTL" >/dev/null 2>&1 && echo "Automatic fan control restored."
    }
    trap restore_auto EXIT
    RPM_BEFORE=""
    [ -n "$HWMON_ACER" ] && [ -r "$HWMON_ACER/fan1_input" ] && RPM_BEFORE=$(cat "$HWMON_ACER/fan1_input")
    echo "RPM before test: ${RPM_BEFORE:-unknown}"
    if echo "50,50" | sudo tee "$FAN_CTL" >/dev/null 2>&1; then
        echo "Set to 50%... waiting 8 s"
        sleep 8
        RPM_DURING=""
        [ -n "$HWMON_ACER" ] && [ -r "$HWMON_ACER/fan1_input" ] && RPM_DURING=$(cat "$HWMON_ACER/fan1_input")
        echo "RPM during test: ${RPM_DURING:-unknown}"
        echo "Did you hear the fan speed change? (note it for the GitHub issue)"
    else
        echo "ERROR: failed to set fan speed (sudo tee $FAN_CTL)"
    fi
    restore_auto
    trap - EXIT
else
    echo "Skipped - no fan_speed interface."
fi

section "Daemon log (last lines)"
sudo tail -n 30 /var/log/DAMX_Daemon_Log.log 2>/dev/null || echo "(no log or insufficient permissions)"

section "Done (post mode)"
echo "Attach this report to the GitHub issue: $REPORT"
echo "(https://github.com/Kaspral1/Acer-Nitro-Perfect-Fan/issues - step 4 in INSTRUCTIONS.md)"
echo "Please also write in the issue: did you hear the fan speed change during the test? (yes/no)"
