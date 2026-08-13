---
name: Laptop compatibility
about: Report a model that should or should not load acer_nitro_ec / NBFC
title: "compat: "
labels: compatibility
---

Do **not** guess EC registers. Paste diagnostics instead.

```bash
./check-system.sh
cat /sys/class/dmi/id/product_name
uname -r
dmesg | grep -i -E 'acer_nitro_ec|nbfc|ec_sys' | tail -40
```

- Model printed by DMI:
- What you expected (hwmon / NBFC / GUI):
- What happened:
- Distro:
- Are `acer-nitro-perfect-fan.service` and `nbfc_service` both active? (`systemctl is-active acer-nitro-perfect-fan.service nbfc_service`)
