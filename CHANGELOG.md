# Changelog

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
- Manual sliders: telemetry cannot overwrite Master/CPU/GPU/offset while a change is in flight.
- CPU and GPU sliders are independent when offset is 0. Master still sets both, but no longer follows min(CPU, GPU).

Verified hardware for this release: **Acer Nitro 5 AN515-54** on Linux + systemd.
