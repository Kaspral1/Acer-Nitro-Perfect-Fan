#!/bin/sh
# Przywraca wiatrakom firmware'owy tryb auto EC.
# Wołane przez ExecStopPost — musi zadziałać także wtedy, gdy daemon
# nie zdążył obsłużyć sygnału (SIGKILL, OOM, panic w pętli).

for h in /sys/class/hwmon/hwmon*; do
    [ "$(cat "$h/name" 2>/dev/null)" = "acer_nitro_ec" ] || continue
    for n in 1 2; do
        # 2 = auto; jeśli EC odrzuci, 0 (turbo) jest głośne, ale bezpieczne.
        echo 2 > "$h/pwm${n}_enable" 2>/dev/null || echo 0 > "$h/pwm${n}_enable" 2>/dev/null
    done
done

# Backend NBFC: oddaj progi z profilu nbfc-linux (daemon nie pisze już % ręcznie).
if [ -S /run/nbfc_service.socket ] || [ -S /var/run/nbfc_service.socket ]; then
    if command -v nbfc >/dev/null 2>&1; then
        nbfc set -a >/dev/null 2>&1 || true
    fi
fi
exit 0
