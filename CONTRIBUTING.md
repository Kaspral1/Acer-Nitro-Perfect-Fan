# Contributing

## Before you open a PR

```bash
python3 test_fan_backend.py
python3 test_nbfc_control_api.py
python3 test_nitro_fan_daemon.py
python3 -m py_compile fan_backend.py nbfc_control_api.py nitro_fan_daemon.py nitro_log_summary.py
cd gui-app && npm test
```

Shell scripts: `bash -n install.sh uninstall.sh restore-auto.sh update-daemon.sh nbfc/install-nbfc-config.sh acer-nitro-ec/apply.sh`.

## Compatibility reports

Do **not** add a DMI string or poke EC registers because a laptop “looks similar”.

Open an issue and paste:

```bash
./check-system.sh
cat /sys/class/dmi/id/product_name
dmesg | grep -i -E 'acer_nitro_ec|nbfc' | tail -30
```

Predator / Helios / Nitro V use a different EC or WMI. They stay out of `acer-nitro-ec/dmi-models.patch` unless someone maps registers on real hardware.

## Rules

- **One EC writer.** If `acer_nitro_ec` is loaded, `auto` must keep ignoring NBFC.
- **CPU PWM floor stays at 30%** in daemon, API and GUI.
- Linux + systemd only. Do not add a Windows `nbfc.exe` path unless that is a dedicated, tested feature.
- Keep `antigravity.md` / `antigravity_PL.md` out of git — they are local notes and they over-claim hardware.

## Docs

- Beginners: [INSTALL.md](INSTALL.md) / [INSTALL_PL.md](INSTALL_PL.md)
- Keep README examples in sync with `nbfc_config.json` (including `"backend": "auto"`).
- File names `nbfc_control_api.py` and `nbfc_config.json` are historical. They are **this** project's bridge and default curves, not nbfc-linux service files.

## License

MIT. Preserve both copyright lines in [LICENSE](LICENSE) (`keizenx` 2024, `Kaspral1` 2026).
Power-profile IPC talks to separately installed DAMX (**GPL-3.0**, not vendored). Bundled `acer-nitro-ec` is **GPL-2.0**. Keep [THIRD_PARTY.md](THIRD_PARTY.md) accurate.
