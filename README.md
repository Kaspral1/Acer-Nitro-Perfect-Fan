# Acer Nitro Perfect Fan <a href="https://www.buymeacoffee.com/Kaspral" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/arial-yellow.png" alt="Buy Me a Coffee" align="right" height="36"></a>

[![Linux](https://img.shields.io/badge/OS-Linux-orange.svg)](https://www.kernel.org/)
[![Python](https://img.shields.io/badge/Backend-Python%203-blue.svg)](https://www.python.org/)
[![Electron](https://img.shields.io/badge/GUI-Electron-47848F.svg)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v1.1-informational.svg)](gui-app/package.json)

**Acer Nitro Perfect Fan** — Linux + systemd fan control for **Acer Nitro 5**.  
systemd daemon → shared JSON → Python stdio bridge → Electron dashboard.

**Supported models** (same EC map, upstream `acer-nitro-ec`):

- Acer Nitro 5 AN515-44
- Acer Nitro 5 AN515-46
- Acer Nitro 5 AN515-54 — **fully tested** (development machine)
- Acer Nitro 5 AN515-56
- Acer Nitro 5 AN515-57
- Acer Nitro 5 AN515-58
- Acer Nitro 5 AN517-55

**Other laptops:** install [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux) and a matching profile — see [Other laptops (NBFC)](#other-laptops-nbfc).

**Nitro** theme (default):

![Acer Nitro Perfect Fan — Nitro theme](assets/Screenshot.png)

**OutRun** theme (Settings → Theme):

![Acer Nitro Perfect Fan — OutRun theme](assets/Screenshot-outrun.png)

| Start here | |
|------------|---|
| **Never used a terminal?** | **[INSTALL.md](INSTALL.md)** (copy-paste) |
| **Po polsku** | [INSTALL_PL.md](INSTALL_PL.md) · [README_PL.md](README_PL.md) |
| **Compatible models** | **[COMPATIBLE-MODELS.md](COMPATIBLE-MODELS.md)** |
| Is my laptop supported? | `./check-system.sh` → plain **YES / MAYBE / NO** verdict (read-only) |

## Quick start

Three commands. The script checks your laptop first, then installs everything:

```bash
git clone https://github.com/Kaspral1/Acer-Nitro-Perfect-Fan.git
cd Acer-Nitro-Perfect-Fan
./setup.sh
```

Then open the app:

```bash
cd gui-app && npm start
```

That is all — the fan service runs in the background and starts at boot.
Step-by-step version with explanations: **[INSTALL.md](INSTALL.md)**.

> **Safety.** Manual fan control can **overheat and damage hardware**. CPU PWM is **hard-clamped to 30%** (daemon + API + GUI). GPU may still use Zero-RPM when cool. **Use at your own risk.**

Windows and macOS are **not** supported.

---

## Features

**Fans** (daemon — starts at boot, GUI not required afterwards)

- Cooling profiles: Silent / Balanced / Turbo with independent CPU & GPU curves
- Custom curve editor: temperature (°C) → speed (%) with live preview
- Manual PWM: master + per-fan sliders (CPU floor 30%, GPU may go to 0% in dynamic mode)
- GPU Zero-RPM hysteresis: stop below ~40°C, restart above ~48°C
- EMA smoothing: fast ramp-up, slow spin-down

**CPU power profile** (sidebar — Eco / Quiet / Balanced / Sport / Max)

- Changes CPU turbo and power caps through a separately installed [DAMX](https://github.com/PXDiv/Div-Acer-Manager-Max) daemon, independent of fan curves
  - **Eco** (`low-power`): gov=powersave, epp=power, max_pct=50, min_pct=17, Turbo OFF
  - **Quiet** (`quiet`): gov=balance_power, epp=power, max_pct=100, min_pct=17, Turbo OFF
  - **Balanced** (`balanced`): gov=powersave, epp=balance_power, max_pct=100, min_pct=17, Turbo ON
  - **Sport** (`balanced-performance`): gov=powersave, epp=balance_performance, max_pct=100, min_pct=17, Turbo ON
  - **Max** (`performance`): gov=performance, epp=performance, max_pct=100, min_pct=30, Turbo ON
- Pick it **once**. DAMX stores it and reapplies it at login/boot — you do not need to leave this window open
- Without DAMX the rest of the panel still works; those five buttons stay offline

**Keyboard backlight** (Settings, **AN515-54** + `acer-nitro-ec`)

- Levels **Off / 25 / 50 / 75 / 100**, plus optional “turn off after 30 s”
- Written straight to the Embedded Controller. Set it once; it **stays after reboot** with this program closed
- On stock Linux the firmware only offered BIOS-off or a 30 s timeout, and **every boot came back at 100%**. This panel is the missing “keep my level” control

![Settings — keyboard backlight Off / 25 / 50 / 75 / 100](assets/Screenshot-settings.png)

**Interface**

- Four color themes: **Nitro** (default), **OutRun**, **Matrix**, and **Reddit** — Settings → Theme, remembered after restart
- System tray, i18n (PL / EN / ES / DE / CS)
- Optional CSV telemetry — Statistics: temperature summary, **daily report** (one local calendar day at a time), view logs, **delete logs** (with confirmation)
- Connection badge: online / offline when the Python bridge is silent

---

## Laptop compatibility

The daemon picks a backend at start (`backend` in `/etc/nitro-fan/config.json`, default `auto`):

1. **`acer_nitro_ec`** — hwmon `pwm1` / `pwm2` (preferred when the module is loaded)
2. **`nbfc`** — [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux) socket, if the kernel module is missing

`auto` will **not** drive NBFC while `acer_nitro_ec` exists. That avoids two writers on the same EC.

### Verified

| Model | Status |
|-------|--------|
| **Acer Nitro 5 AN515-54** | Fully tested (development machine) |

### Same EC map as Acer Nitro 5 AN515-54 (needs patched `acer-nitro-ec`)

Upstream DKMS only loads on:

| Model |
|-------|
| Acer Nitro 5 AN515-44 |
| Acer Nitro 5 AN515-46 |
| Acer Nitro 5 AN515-54 |
| Acer Nitro 5 AN515-56 |
| Acer Nitro 5 AN515-57 |
| Acer Nitro 5 AN515-58 |
| Acer Nitro 5 AN517-55 |

This repo can add these extra models (`regs_an515_46` — **not** fully verified):

| Model |
|-------|
| Acer Nitro 5 AN515-51 |
| Acer Nitro 5 AN515-55 |
| Acer Nitro 5 AN517-51 |
| Acer Nitro 5 AN517-54 |

```bash
sudo ./acer-nitro-ec/apply.sh
./check-system.sh
```

### Other laptops (NBFC)

**Other laptops can use this program too** — same GUI, same fan curves. You must install [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux) yourself, and your model must already have a working NBFC profile. This app does **not** invent fan control for unknown hardware.

| Your machine | What you need |
|--------------|----------------|
| **Acer Nitro 5 AN515-54** (and the list above) | `acer_nitro_ec` is enough. NBFC is optional. |
| **Another laptop** listed in `nbfc config -l` | Install nbfc-linux, start `nbfc_service`, select **your** profile, set `"backend": "nbfc"`. nbfc-linux ships ~180 configs. |
| Laptop **not** on that list, desktop, Windows, macOS | **Not supported.** |

Do **not** install this repo’s `Acer Nitro AN515-54.json` on a different model. Pick the profile that matches your DMI name (`nbfc config -l`).

**Not claimed** for the kernel module: Predator, Helios, Nitro V (different EC or WMI). They work here **only** if nbfc-linux already has a config for that exact model.

See [NBFC](#nbfc-alternative-backend) for commands.

```bash
grep -H . /sys/class/hwmon/hwmon*/name | grep acer_nitro_ec
ls -l /run/nbfc_service.socket
```

---

## Related project: keizenx/nitro-fan-control

This dashboard started as a fork of **[keizenx/nitro-fan-control](https://github.com/keizenx/nitro-fan-control)** (MIT). That app is a GUI **in front of NBFC**. This repo keeps a similar Electron UI; the daemon prefers `acer_nitro_ec` and can drive **nbfc-linux** when the kernel module is missing.

File names `nbfc_control_api.py` and `nbfc_config.json` are historical. They are this project's JSON/stdio bridge and default curves, **not** NBFC service files. The real NBFC laptop profile lives in [`nbfc/`](nbfc/).

| | **This project** | **keizenx/nitro-fan-control** |
|---|------------------|--------------------------------|
| Role | Daemon + GUI | GUI only |
| Fan backend | `acer_nitro_ec` **or** nbfc-linux (auto) | [NBFC](https://github.com/nbfc-linux/nbfc-linux) / [hirschmann/nbfc](https://github.com/hirschmann/nbfc) |
| Who writes the EC | daemon → hwmon, **or** daemon → `nbfc_service` | `nbfc_service` / `nbfc.exe` |
| OS | Linux + **systemd** only | Linux and **Windows** |
| Extra kernel module | `acer-nitro-ec` (DKMS) for the hwmon path | `ec_sys` / `acpi_ec` (`write_support=1`) |
| Curves | Interpolated °C→% editor, EMA, 30% CPU floor, GPU Zero-RPM | NBFC step thresholds; Silent/Balanced/Turbo as preset targets |
| Model coverage | patched AN515/AN517 list, plus any nbfc-linux config | Any laptop with an NBFC config (~180 models) |
| Packaged GUI | AppImage / `.deb` — **daemon still required** | AppImage / `.deb` / Windows installer |

Use this project on Linux. Use keizenx + NBFC when you need Windows.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Electron Dashboard (GUI)                       │
│   preload.js bridge · contextIsolation · Chart.js           │
└──────────────────────────────┬──────────────────────────────┘
                               │ IPC + Python stdio JSON
┌──────────────────────────────▼──────────────────────────────┐
│              Python API (nbfc_control_api.py)               │
└──────────────────────────────┬──────────────────────────────┘
                               │ /etc/nitro-fan/config.json
┌──────────────────────────────▼──────────────────────────────┐
│         Daemon (nitro_fan_daemon.py / acer-nitro-perfect-fan)        │
│              fan_backend.py  (auto detect)                  │
└───────────────┬─────────────────────────────┬───────────────┘
                │ hwmon pwm1/pwm2             │ UNIX socket
┌───────────────▼───────────────┐   ┌─────────▼──────────────┐
│     Kernel: acer_nitro_ec     │   │  nbfc_service (EC)     │
└───────────────────────────────┘   └────────────────────────┘
```

---

## Installation

Recommended: the **3-command [Quick start](#quick-start)** above. Full copy-paste walkthrough: **[INSTALL.md](INSTALL.md)**.

Manually, it is three steps: `./check-system.sh` (is this laptop supported?) → `sudo ./install.sh` (driver + service) → `cd gui-app && npm install && npm start` (GUI).

`install.sh` copies the daemon to `/usr/local/lib/acer-nitro-perfect-fan/`, writes `/etc/nitro-fan/`, installs udev `99-acer-nitro-ec.rules`, and enables `acer-nitro-perfect-fan.service`. A fan backend is needed first: `acer_nitro_ec` (loaded by the installer on supported models) or `nbfc_service`.

Optional AppImage / `.deb`: `cd gui-app && npm run dist`. The packaged GUI **still needs** the system daemon.

---

## Uninstall

```bash
sudo ./uninstall.sh
```

Stops the service, restores EC auto, removes unit/files/udev/config and the service user. The clone and `node_modules` stay.

Emergency: `./restore-auto.sh` or `sudo systemctl stop acer-nitro-perfect-fan.service`.

---

## Configuration (`/etc/nitro-fan/config.json`)

```json
{
    "mode": "dynamic",
    "backend": "auto",
    "profile": "Silent",
    "auto_logging": true,
    "curves": {
        "cpu": [[45.0, 30.0], [65.0, 30.0], [72.0, 40.0], [80.0, 60.0], [88.0, 100.0]],
        "gpu": [[50.0, 30.0], [58.0, 30.0], [68.0, 35.0], [75.0, 55.0], [85.0, 100.0]]
    },
    "manual_speeds": {
        "0": 30.0,
        "1": 30.0
    }
}
```

- `backend`: `auto` (default), `acer_nitro_ec`, or `nbfc`
- `mode`: `dynamic` (curves) or `manual` (fixed PWM from `manual_speeds`)
- Fan `0` = CPU, fan `1` = GPU
- Curve points and manual speeds below **30%** are raised to 30% (GUI, API, daemon)
- `speed_offset` (optional, default `0`): permanent **CPU vs GPU** boost (`−50…+50`). **Positive** adds to CPU; **negative** adds to GPU.

---

## NBFC (alternative backend)

[NoteBook FanControl](https://github.com/nbfc-linux/nbfc-linux) talks to the laptop Embedded Controller **directly**. That is how this program can drive **other laptops**, not only Acer Nitro 5: this app computes the curves, `nbfc_service` writes the EC.

**On another laptop** (not AN515-54):

1. Install [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux).
2. Check that your model exists: `nbfc config -l` (about 180 profiles). If it is missing, stop — this program cannot help.
3. Select **your** profile (`nbfc config -a "Exact Name From The List"`), then `sudo systemctl enable --now nbfc_service`.
4. Set `"backend": "nbfc"` in `/etc/nitro-fan/config.json` and run `sudo ./install.sh`.

The sibling GUI [keizenx/nitro-fan-control](https://github.com/keizenx/nitro-fan-control) uses that same NBFC path (and also works on Windows).

This repo ships a tested **Acer Nitro 5 AN515-54** profile (use it only on that model):

- [`nbfc/Acer Nitro AN515-54.json`](nbfc/Acer%20Nitro%20AN515-54.json) — laptop profile
- [`nbfc/nbfc.json`](nbfc/nbfc.json) — `SelectedConfigId` for `/etc/nbfc/nbfc.json`
- [`nbfc/README.md`](nbfc/README.md) — EC map and apply steps

**With this daemon on Acer Nitro 5 AN515-54** (curves stay here, NBFC only writes the EC):

```bash
sudo systemctl disable --now acer-nitro-perfect-fan.service
sudo ./nbfc/install-nbfc-config.sh
sudo systemctl enable --now nbfc_service
# optional: "backend": "nbfc" in /etc/nitro-fan/config.json
sudo ./install.sh
```

If `acer_nitro_ec` is also loaded, `auto` prefers hwmon. Force NBFC with `"backend": "nbfc"` only when you really want that path.

**NBFC alone** (keizenx GUI or `nbfc set`) — stop this daemon first.

| Fan | RPM read | Duty write | Manual unlock |
|-----|----------|------------|---------------|
| CPU | 19 (`0x13`) | 55 (`0x37`) | 34 (`0x22`) = 12 |
| GPU | 21 (`0x15`) | 58 (`0x3A`) | 33 (`0x21`) = 48 |
| Both | — | — | 151 (`0x97`) = 1 |

---

## Troubleshooting

1. **Fans ignore sliders** — `systemctl status acer-nitro-perfect-fan.service`, `./check-system.sh`
2. **GUI offline** — Python bridge not running; read the terminal where you ran `npm start`
3. **Stock EC auto** — `./restore-auto.sh` or reboot after stopping the service
4. **Missing charts** — `npm install` in `gui-app`
5. **Fans oscillate** — two writers. `systemctl is-active acer-nitro-perfect-fan.service nbfc_service`

More: [INSTALL.md](INSTALL.md#10-troubleshooting).

---

## Development

```bash
cd gui-app && npm test
python3 -m py_compile fan_backend.py nbfc_control_api.py nitro_fan_daemon.py nitro_log_summary.py
python3 test_fan_backend.py
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — [LICENSE](LICENSE).

Copyright (c) 2024 [keizenx](https://github.com/keizenx)  
Copyright (c) 2026 [Kaspral1](https://github.com/Kaspral1)

GUI lineage: [keizenx/nitro-fan-control](https://github.com/keizenx/nitro-fan-control).  
NBFC profile based on the AN515-54 EC map by Chandradeep Dey / alex-fl.

Developed by Kaspral1 with assistance from AI coding tools. All design decisions and the published code are the maintainer’s responsibility.

**This project stays MIT** when power-profile buttons are used. Those buttons talk to a separately installed [Div Acer Manager Max (DAMX)](https://github.com/PXDiv/Div-Acer-Manager-Max) daemon (and [Linuwu-Sense](https://github.com/PXDiv/Div-Linuwu-Sense)) over a Unix socket. DAMX is **GPL-3.0** and is **not** bundled here. The optional `acer-nitro-ec` kernel module in this repo is **GPL-2.0**. Details: [THIRD_PARTY.md](THIRD_PARTY.md).
