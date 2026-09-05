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

# Backend DAMX: 0,0 oznacza firmware'owy tryb automatyczny obu wentylatorów.
if grep -Eq '"backend"[[:space:]]*:[[:space:]]*"damx"' /etc/nitro-fan/config.json 2>/dev/null \
   && { [ -S /run/DAMX.sock ] || [ -S /var/run/DAMX.sock ]; }; then
    python3 - <<'PY' >/dev/null 2>&1 || true
import json
import socket
from pathlib import Path

path = next(str(p) for p in (Path("/run/DAMX.sock"), Path("/var/run/DAMX.sock")) if p.is_socket())
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(2)
s.connect(path)
s.sendall(json.dumps({"command": "set_fan_speed", "params": {"cpu": 0, "gpu": 0}}).encode())
s.recv(4096)
s.close()
PY
fi

# Backend NBFC: oddaj progi z profilu nbfc-linux (daemon nie pisze już % ręcznie).
if [ -S /run/nbfc_service.socket ] || [ -S /var/run/nbfc_service.socket ]; then
    if command -v nbfc >/dev/null 2>&1; then
        nbfc set -a >/dev/null 2>&1 || true
    fi
fi
exit 0
