# Acer Nitro Perfect Fan <a href="https://www.buymeacoffee.com/Kaspral" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/arial-yellow.png" alt="Buy Me a Coffee" align="right" height="36"></a>

[![Linux](https://img.shields.io/badge/OS-Linux-orange.svg)](https://www.kernel.org/)
[![Python](https://img.shields.io/badge/Backend-Python%203-blue.svg)](https://www.python.org/)
[![Electron](https://img.shields.io/badge/GUI-Electron-47848F.svg)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v1.1-informational.svg)](gui-app/package.json)

Fan control for **Acer Nitro 5** on Linux with systemd: a background daemon plus an Electron dashboard.

**Supported:** Acer Nitro 5 AN515-44 / 46 / **54** (fully tested) / 56 / 57 / 58 and AN517-55. Other laptops work through [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux) if it has a profile for your model. See [COMPATIBLE-MODELS.md](COMPATIBLE-MODELS.md). Windows and macOS are **not** supported.

![Acer Nitro Perfect Fan](assets/Screenshot.png)

## Quick start

```bash
git clone https://github.com/Kaspral1/Acer-Nitro-Perfect-Fan.git
cd Acer-Nitro-Perfect-Fan
./setup.sh
cd gui-app && npm start
```

`setup.sh` checks your laptop first and stops on hardware it cannot drive safely. Then it installs the packages, the fan driver, the background service and the GUI.

- **Will it run on my laptop?** Run `./check-system.sh`. It is read-only and ends with a plain **YES / MAYBE / NO**.
- **Step by step:** [INSTALL.md](INSTALL.md) · **Po polsku:** [INSTALL_PL.md](INSTALL_PL.md) · [README_PL.md](README_PL.md)

> **Safety.** Manual fan control can overheat and damage hardware. CPU PWM is hard-clamped to 30%, and the installer refuses to run without a working fan backend. **Use at your own risk.**

## Features

- Cooling profiles **Silent / Balanced / Turbo** and a custom temperature to speed curve editor with live preview.
- Manual PWM sliders (CPU floor 30%), GPU Zero-RPM, EMA smoothing. Set it once and the daemon keeps it, no window needed.
- CPU power profiles **Eco ... Max** (turbo and power caps) via the optional [DAMX](https://github.com/PXDiv/Div-Acer-Manager-Max) daemon.
- Keyboard backlight **Off / 25 / 50 / 75 / 100** that survives reboot (AN515-54).
- Four themes (Nitro / OutRun / Matrix / Reddit) and a system tray icon.
- Interface in Polish, English, Spanish, German and Czech.
- Optional **local** CSV log with daily reports. The file stays in the project folder on your disk; nothing is ever sent anywhere.

## Documentation

| Topic | File |
|-------|------|
| Install walkthrough | [INSTALL.md](INSTALL.md) · [INSTALL_PL.md](INSTALL_PL.md) |
| Compatible laptops | [COMPATIBLE-MODELS.md](COMPATIBLE-MODELS.md) · [PL](COMPATIBLE-MODELS_PL.md) |
| Architecture, config, NBFC backend, development | [TECHNICAL.md](TECHNICAL.md) |
| Adding support for a new model | [SUPPORT-NEW-MODEL.md](SUPPORT-NEW-MODEL.md) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |

**Uninstall:** `sudo ./uninstall.sh`. Emergency: `./restore-auto.sh`.

**Trouble?** Run `./check-system.sh` and paste its output into a GitHub issue.

## License

MIT, see [LICENSE](LICENSE). © 2024 [keizenx](https://github.com/keizenx), © 2026 [Kaspral1](https://github.com/Kaspral1). GUI lineage: [keizenx/nitro-fan-control](https://github.com/keizenx/nitro-fan-control). Optional parts: the `acer-nitro-ec` kernel module is GPL-2.0, DAMX is GPL-3.0 and not bundled. Details in [THIRD_PARTY.md](THIRD_PARTY.md).

Developed by Kaspral1 with assistance from AI coding tools. All design decisions and the published code are the maintainer's responsibility.
