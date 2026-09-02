# Technical details

The front page ([README.md](README.md)) is intentionally short. Everything
technical lives here.

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

The daemon picks a backend at start (`backend` in `/etc/nitro-fan/config.json`,
default `auto`):

1. **`acer_nitro_ec`** — hwmon `pwm1` / `pwm2` (preferred when the module is loaded)
2. **`nbfc`** — [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux) socket, if the kernel module is missing

`auto` will **not** drive NBFC while `acer_nitro_ec` exists. That avoids two
writers on the same EC.

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

## CPU power profiles (DAMX)

The sidebar buttons (Eco / Quiet / Balanced / Sport / Max) talk to a separately
installed [DAMX](https://github.com/PXDiv/Div-Acer-Manager-Max) daemon and are
independent of the fan curves:

| Button | DAMX profile | governor | EPP | max % | min % | Turbo |
|--------|--------------|----------|-----|-------|-------|-------|
| Eco | `low-power` | powersave | power | 50 | 17 | off |
| Quiet | `quiet` | balance_power | power | 100 | 17 | off |
| Balanced | `balanced` | powersave | balance_power | 100 | 17 | on |
| Sport | `balanced-performance` | powersave | balance_performance | 100 | 17 | on |
| Max | `performance` | performance | performance | 100 | 30 | on |

Pick it **once** — DAMX stores it and reapplies it at login/boot. Without DAMX
the rest of the panel still works; those five buttons stay offline.

## NBFC (alternative backend)

[NoteBook FanControl](https://github.com/nbfc-linux/nbfc-linux) talks to the
laptop Embedded Controller **directly**. That is how this program can drive
**other laptops**, not only Acer Nitro 5: this app computes the curves,
`nbfc_service` writes the EC.

**On another laptop** (not AN515-54):

1. Install [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux).
2. Check that your model exists: `nbfc config -l` (about 180 profiles). If it is missing, stop — this program cannot help.
3. Select **your** profile (`nbfc config -a "Exact Name From The List"`), then `sudo systemctl enable --now nbfc_service`.
4. Set `"backend": "nbfc"` in `/etc/nitro-fan/config.json` and run `sudo ./install.sh`.

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

If `acer_nitro_ec` is also loaded, `auto` prefers hwmon. Force NBFC with
`"backend": "nbfc"` only when you really want that path.

**NBFC alone** (keizenx GUI or `nbfc set`) — stop this daemon first.

| Fan | RPM read | Duty write | Manual unlock |
|-----|----------|------------|---------------|
| CPU | 19 (`0x13`) | 55 (`0x37`) | 34 (`0x22`) = 12 |
| GPU | 21 (`0x15`) | 58 (`0x3A`) | 33 (`0x21`) = 48 |
| Both | — | — | 151 (`0x97`) = 1 |

Handy checks:

```bash
grep -H . /sys/class/hwmon/hwmon*/name | grep acer_nitro_ec
ls -l /run/nbfc_service.socket
```

## Experimental driver patch (more models)

This repo can add these extra models to the EC driver (`regs_an515_46` —
**not** fully verified): AN515-51, AN515-55, AN517-51, AN517-54.

```bash
sudo ./acer-nitro-ec/apply.sh
./check-system.sh
```

## Related project: keizenx/nitro-fan-control

This dashboard started as a fork of **[keizenx/nitro-fan-control](https://github.com/keizenx/nitro-fan-control)** (MIT).
That app is a GUI **in front of NBFC**. This repo keeps a similar Electron UI;
the daemon prefers `acer_nitro_ec` and can drive **nbfc-linux** when the kernel
module is missing.

File names `nbfc_control_api.py` and `nbfc_config.json` are historical. They are
this project's JSON/stdio bridge and default curves, **not** NBFC service files.
The real NBFC laptop profile lives in [`nbfc/`](nbfc/).

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

## Development

```bash
cd gui-app && npm test
python3 -m py_compile fan_backend.py nbfc_control_api.py nitro_fan_daemon.py nitro_log_summary.py
python3 test_fan_backend.py
```

See [CONTRIBUTING.md](CONTRIBUTING.md).
