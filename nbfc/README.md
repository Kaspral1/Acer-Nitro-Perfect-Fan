# NBFC profile for Acer Nitro AN515-54

Beginners: start with [INSTALL.md](../INSTALL.md) / [INSTALL_PL.md](../INSTALL_PL.md). This folder is the **nbfc-linux** laptop profile, not the Electron GUI.

Two ways to use these files:

1. **This project's daemon + nbfc_service** — `acer-nitro-perfect-fan` computes curves and
   sends `%` to NBFC over `/run/nbfc_service.socket`. Set `"backend": "nbfc"`
   (or leave `"auto"` when `acer_nitro_ec` is **not** loaded).
2. **NBFC only** — keizenx GUI or `nbfc set`. Stop `acer-nitro-perfect-fan.service` first.

> If **both** `acer_nitro_ec` and `nbfc_service` are present, `auto` picks hwmon
> and does not write through NBFC (avoids two writers on the same EC).

| File | Role |
|------|------|
| [`Acer Nitro AN515-54.json`](Acer%20Nitro%20AN515-54.json) | NBFC laptop profile (EC map + default thresholds) |
| [`nbfc.json`](nbfc.json) | nbfc-linux service config (`SelectedConfigId`) |

The GUI in this repo (`gui-app/`) talks to `nitro_fan_daemon.py`, not to `nbfc`.
To use this profile you need the **nbfc-linux CLI** (or [keizenx/nitro-fan-control](https://github.com/keizenx/nitro-fan-control) as a frontend).

## Apply the profile

```bash
# 1. Install nbfc-linux (Debian/Ubuntu/Mint package, or build from source)
#    https://github.com/nbfc-linux/nbfc-linux

# 2. Install the profile + select it
sudo ./nbfc/install-nbfc-config.sh

# 3. Start NBFC (required — it is the EC writer)
sudo systemctl enable --now nbfc_service
nbfc status

# 4. Optional: force this daemon onto NBFC even if acer_nitro_ec exists
#    "backend": "nbfc"  in /etc/nitro-fan/config.json
sudo systemctl restart acer-nitro-perfect-fan.service
```

Manual equivalent of the helper script:

```bash
sudo install -m 644 "nbfc/Acer Nitro AN515-54.json" \
  /usr/share/nbfc/configs/"Acer Nitro AN515-54.json"
sudo nbfc config -a "Acer Nitro AN515-54"
```

Hwmon-only (stop using NBFC as the writer):

```bash
sudo systemctl disable --now nbfc_service
# leave "backend": "auto" — daemon uses acer_nitro_ec if loaded
sudo systemctl restart acer-nitro-perfect-fan.service
```

## EC register map (AN515-54)

Same dual-fan layout as many AN515-4x / AN515-5x units. Values are **decimal**
(NBFC JSON). Hex in parentheses.

| Role | Register | Typical value |
|------|----------|----------------|
| CPU fan RPM (read) | 19 (`0x13`) | 0–6122 |
| GPU fan RPM (read) | 21 (`0x15`) | 0–6122 |
| CPU duty (write) | 55 (`0x37`) | 0–100 % |
| GPU duty (write) | 58 (`0x3A`) | 0–100 % |
| CPU manual unlock | 34 (`0x22`) | `12` (auto reset `0` or `4`) |
| GPU manual unlock | 33 (`0x21`) | `48` (auto reset `0` or `16`) |
| Global manual | 151 (`0x97`) | `1` |

`acer_nitro_ec` exposes the same fans as hwmon `pwm1` / `pwm2` so this project
does not poke those registers itself.

## Thresholds vs this project's curves

NBFC uses **step thresholds** (`UpThreshold` / `DownThreshold` / `FanSpeed`).
This project uses **interpolated curves** in `/etc/nitro-fan/config.json`
plus EMA smoothing and a 30 % CPU floor.

The bundled NBFC steps are a conservative silent-leaning default (fans can
sit at 0 % until ~42 °C). They are **not** a 1:1 copy of Silent / Balanced / Turbo.

## Related models

nbfc-linux already ships close cousins (`Acer Nitro AN515-45`, `-51`, `-57`, `-58`, …).
If your DMI model is not AN515-54, start from the closest official config
(`nbfc config -l | grep -i nitro`) instead of forcing this file.
