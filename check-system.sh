#!/usr/bin/env bash
# Read-only diagnostics for a GitHub issue or the beginner install guide.
# Does not change fans, services, or files.
#
#   ./check-system.sh

set -u

ok()   { printf '  [OK]   %s\n' "$*"; }
warn() { printf '  [!!]   %s\n' "$*"; }
info() { printf '  [--]   %s\n' "$*"; }

echo "=== Acer Nitro Perfect Fan — diagnostyka (tylko odczyt) ==="
echo

MODEL="$(cat /sys/class/dmi/id/product_name 2>/dev/null || echo '(brak DMI)')"
VENDOR="$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null || echo '?')"
echo "Laptop"
info "producent: $VENDOR"
info "model DMI: $MODEL"
info "jądro:     $(uname -r)"
info "system:    $(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-?}" || uname -s)"
echo

echo "Narzędzia"
if command -v python3 >/dev/null 2>&1; then
    ok "python3  $($(command -v python3) --version 2>&1 | awk '{print $2}')"
else
    warn "brak python3  — sudo apt install python3"
fi
if command -v node >/dev/null 2>&1; then
    ok "node     $(node --version)"
else
    warn "brak node  — sudo apt install nodejs npm"
fi
if command -v npm >/dev/null 2>&1; then
    ok "npm      $(npm --version)"
else
    warn "brak npm"
fi
if command -v systemctl >/dev/null 2>&1; then
    ok "systemd"
else
    warn "brak systemd — ten projekt działa tylko z systemd"
fi
if command -v sensors >/dev/null 2>&1; then
    ok "lm-sensors"
else
    info "brak polecenia sensors (opcjonalne): sudo apt install lm-sensors"
fi
echo

echo "Backend wentylatorów"
HAS_EC=0
if grep -qs '^acer_nitro_ec$' /sys/class/hwmon/hwmon*/name 2>/dev/null; then
    HAS_EC=1
    HWMON="$(grep -l '^acer_nitro_ec$' /sys/class/hwmon/hwmon*/name 2>/dev/null | head -1)"
    ok "acer_nitro_ec  (${HWMON%/name})"
else
    warn "brak hwmon acer_nitro_ec"
    info "sterownik: sudo ./acer-nitro-ec/apply.sh"
fi

HAS_NBFC=0
if [ -S /run/nbfc_service.socket ] || [ -S /var/run/nbfc_service.socket ]; then
    HAS_NBFC=1
    ok "gniazdo nbfc_service"
else
    info "brak gniazda nbfc_service (OK, gdy działa acer_nitro_ec)"
fi
if command -v nbfc >/dev/null 2>&1; then
    info "nbfc CLI: $(command -v nbfc)"
fi
if [ "$HAS_EC" -eq 1 ] && [ "$HAS_NBFC" -eq 1 ]; then
    warn "oba backendy naraz — daemon w trybie auto wybierze hwmon i nie będzie pisał przez NBFC"
fi
if [ "$HAS_EC" -eq 0 ] && [ "$HAS_NBFC" -eq 0 ]; then
    warn "żaden backend nie jest gotowy — wentylatory nie ruszą z tego programu"
fi
echo

echo "Usługa acer-nitro-perfect-fan"
if systemctl list-unit-files acer-nitro-perfect-fan.service >/dev/null 2>&1; then
    STATE="$(systemctl is-active acer-nitro-perfect-fan.service 2>/dev/null || true)"
    ENABLED="$(systemctl is-enabled acer-nitro-perfect-fan.service 2>/dev/null || true)"
    if [ "$STATE" = "active" ]; then
        ok "acer-nitro-perfect-fan.service = $STATE  (włączona: $ENABLED)"
    else
        warn "acer-nitro-perfect-fan.service = ${STATE:-brak}  (włączona: ${ENABLED:-?})"
        info "instalacja: sudo ./install.sh"
    fi
else
    warn "usługa nie jest zainstalowana  — sudo ./install.sh"
fi
if [ -f /etc/nitro-fan/config.json ]; then
    BACKEND="$(python3 -c 'import json; print(json.load(open("/etc/nitro-fan/config.json")).get("backend","auto"))' 2>/dev/null || echo '?')"
    ok "config /etc/nitro-fan/config.json  (backend=$BACKEND)"
else
    info "brak /etc/nitro-fan/config.json (powstanie przy install.sh)"
fi
if id acer_nitro_perfect_fan >/dev/null 2>&1; then
    ok "użytkownik serwisowy acer_nitro_perfect_fan"
else
    info "brak użytkownika acer_nitro_perfect_fan (powstanie przy install.sh)"
fi
echo

echo "Konflikt (dwa programy piszące do EC)"
if systemctl is-active --quiet nbfc_service 2>/dev/null; then
    if [ "$HAS_EC" -eq 1 ]; then
        warn "nbfc_service jest aktywny obok acer_nitro_ec"
    else
        info "nbfc_service aktywny (to OK, gdy używasz backendu nbfc)"
    fi
fi
echo

echo "Gotowe. Wklej ten wydruk do zgłoszenia na GitHub, jeśli coś nie działa."
echo "Logi usługi:  journalctl -u acer-nitro-perfect-fan.service -n 40 --no-pager"
