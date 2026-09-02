# Changelog

## v1.1 (2026)

- Version shown as **v1.1** (package semver `1.1.0`).
- Four color themes: **Nitro** (default), **OutRun**, **Matrix** and **Reddit** (Settings → Theme), remembered after restart. Screenshots: `assets/Screenshot.png`, `assets/Screenshot-outrun.png`, `assets/Screenshot_matrix.png`, `assets/Screenshot_reddit.png`.
- Fixed: Reddit and Matrix shipped as CSS only — added the missing theme cards, theme validation, chart palettes and i18n keys.
- `setup.sh`: one-command install — packages (apt / dnf / pacman / zypper), laptop check, driver + service, GUI dependencies.
- `check-system.sh`: English output, model / Secure Boot / kernel-headers / NBFC-profile checks, and a final **YES / MAYBE / NO** verdict with the next command.
- README (EN/PL) slimmed to a quick-start front page with one screenshot; architecture, `config.json`, NBFC backend and development details moved to `TECHNICAL.md`.
- Sidebar copy: **Profil prędkości**, **Obciążenie sprzętu**, **Temperatury**. DAMX credit lives in Settings only.
- CPU clock (**TAKTOWANIE**) in the load card, same style as CPU / GPU / RAM / VRAM.
- Power-profile descriptions on hover only (Eco / Cichy: turbo off with 40% / 55% caps; Balans / Sport / Max: turbo on).
- Section titles centered over their cards; app title uses the system UI font.
- Contrast: CPU labels use a lighter blue (`#4DB3F5`, WCAG AA); history-chart axis ticks and empty-sensor copy raised to readable greys. High-temp badge is warning amber, not Intel blue.
- Docs: keyboard backlight **Off / 25 / 50 / 75 / 100** is an EC write — set once, survives reboot with the GUI closed. CPU power profile is the same idea via the DAMX daemon at boot. Fan daemon was already persistent.
- Python bridge (`sensors` / `nvidia-smi` / `lspci`): 3s subprocess timeout so a hung query cannot stall the GUI.
- Statistics: **Kasuj logi** deletes `telemetry.csv` (with confirmation). If auto-logging is on, a new file starts on the next sample.
- Statistics: **Dzienny raport** browses the same telemetry stats one local calendar day at a time.

## v1.0 (2026)

Project / GitHub name: **Acer Nitro Perfect Fan** (repository `Kaspral1/Acer-Nitro-Perfect-Fan`).

- Dual fan backend: `acer_nitro_ec` (hwmon) or **nbfc-linux**, selected by `"backend": "auto"` in `/etc/nitro-fan/config.json`. Auto prefers hwmon so two writers never share the EC.
- Bundled NBFC laptop profile for **Acer Nitro AN515-54** (`nbfc/`).
- Optional DKMS DMI expansion: AN515-51 / 55, AN517-51 / 54 (`acer-nitro-ec/`).
- Install / update / restore scripts and systemd unit know about both backends.
- Version shown as **v1.0** (package semver `1.0.0`).
- Factory default curves (CPU = GPU, temps 45/55/65/75/85 °C): Silent 30/30/30/42/65, Balanced 30/32/42/62/100, Turbo 45/60/80/95/100. Settings can edit those defaults; **Przywróć** returns to this factory. Custom curves stay separate.
- GPU Zero-RPM only in Silent. Silent and Balanced keep CPU/GPU lockstep; Turbo uses the GPU curve with +5 pt boost.
- Docs: beginner install (EN/PL), honest compatibility list, MIT copyright for both keizenx and Kaspral1.
- CI: Python compile, `test_fan_backend.py`, `test_nbfc_control_api.py`, `test_nitro_fan_daemon.py`, i18n key parity, `bash -n`, NBFC JSON.
- Sidebar power profiles (Eco / Quiet / Balanced / Sport / Max) via DAMX daemon socket — independent of fan curves.
- License notice for DAMX (GPL-3.0, not bundled) and `acer-nitro-ec` (GPL-2.0): Settings → Licenses, sidebar credit, [THIRD_PARTY.md](THIRD_PARTY.md). The userspace app stays MIT.
- Manual sliders: telemetry cannot overwrite Master/CPU/GPU/offset while a change is in flight.
- CPU and GPU sliders are independent when offset is 0. Master still sets both, but no longer follows min(CPU, GPU).

Verified hardware for this release: **Acer Nitro 5 AN515-54** on Linux + systemd.
