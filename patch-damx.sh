#!/usr/bin/env bash
# Skrypt aktualizujący parametry profili CPU w lokalnej instalacji DAMX.
# Gwarantuje, że zachowanie programu DAMX jest zgodne z najnowszą konfiguracją
# zdefiniowaną w interfejsie i dokumentacji Acer Nitro Perfect Fan.
# Wymaga uruchomienia przez sudo.

DAMX_BIN="/usr/local/sbin/damx-apply-cpu-profile"

if [ ! -f "$DAMX_BIN" ]; then
    echo "Błąd: Nie znaleziono pliku $DAMX_BIN. Czy demon DAMX jest na pewno zainstalowany w tym systemie?"
    exit 1
fi

[ "$(id -u)" -eq 0 ] || { echo "Uruchom przez sudo: sudo ./patch-damx.sh"; exit 1; }

echo "Znaleziono instalację DAMX: $DAMX_BIN"
echo "Tworzę kopię zapasową w ${DAMX_BIN}.bak..."
cp "$DAMX_BIN" "${DAMX_BIN}.bak"

echo "Wgrywanie nowych wartości profili..."

awk '
BEGIN { in_case = 0 }
/^case "\$profile" in/ {
    print $0
    print "  low-power|eco|power-saver|power_saver)"
    print "    gov=\"powersave\""
    print "    epp=\"power\""
    print "    max_pct=50"
    print "    min_pct=17"
    print "    no_turbo=1"
    print "    ;;"
    print "  quiet)"
    print "    gov=\"balance_power\""
    print "    epp=\"power\""
    print "    max_pct=100"
    print "    min_pct=17"
    print "    no_turbo=1"
    print "    ;;"
    print "  balanced)"
    print "    gov=\"powersave\""
    print "    epp=\"balance_power\""
    print "    max_pct=100"
    print "    min_pct=17"
    print "    no_turbo=0"
    print "    ;;"
    print "  balanced-performance|balanced_performance)"
    print "    gov=\"powersave\""
    print "    epp=\"balance_performance\""
    print "    max_pct=100"
    print "    min_pct=17"
    print "    no_turbo=0"
    print "    ;;"
    print "  performance|turbo)"
    print "    gov=\"performance\""
    print "    epp=\"performance\""
    print "    max_pct=100"
    print "    min_pct=30"
    print "    no_turbo=0"
    print "    ;;"
    print "  *)"
    print "    echo \"unknown profile '\''$profile'\'', using balanced\" >&2"
    print "    profile=\"balanced\""
    print "    gov=\"powersave\""
    print "    epp=\"balance_power\""
    print "    ;;"
    in_case = 1
    next
}
/^esac/ {
    if (in_case) {
        in_case = 0
    }
}
{
    if (!in_case) print $0
}
' "${DAMX_BIN}.bak" > "$DAMX_BIN"

chmod +x "$DAMX_BIN"

echo "Sukces! Zaktualizowano parametry DAMX."
echo "Możesz teraz przetestować profile zasilania w Acer Nitro Perfect Fan."
