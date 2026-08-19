# Third-party software

Acer Nitro Perfect Fan is MIT-licensed ([LICENSE](LICENSE)).
It does **not** relicense itself when optional integrations are present.

## Div Acer Manager Max (DAMX)

**Project:** [PXDiv/Div-Acer-Manager-Max](https://github.com/PXDiv/Div-Acer-Manager-Max)  
**Driver:** [PXDiv/Div-Linuwu-Sense](https://github.com/PXDiv/Div-Linuwu-Sense) (`linuwu_sense`)  
**License:** GNU General Public License v3.0

The sidebar **power profiles** (Eco / Quiet / Balanced / Sport / Max) send
JSON commands to a DAMX daemon that is already installed on the machine
(`/var/run/DAMX.sock`). This repository does **not** vendor DAMX sources,
binaries, or Linuwu-Sense.

DAMX remains a separate program under GPL-3.0. Install, update, and
distribute it on its own terms. If DAMX is missing, Perfect Fan still
runs; only those CPU power-profile buttons stay offline.

Pick a profile once. The DAMX daemon (typically `damx-daemon.service`)
stores it under `/var/lib/damx/thermal_profile` and reapplies it at boot.
Perfect Fan does not need to stay open for that.

## acer-nitro-ec (bundled kernel module)

**Path:** [`acer-nitro-ec/`](acer-nitro-ec/)  
**License:** GPL-2.0 (`SPDX-License-Identifier: GPL-2.0` in `acer-nitro-ec.c`)

Optional DKMS module for fan PWM / hwmon and, on AN515-54, red keyboard
backlight (`kbd_backlight` 0–4, `kbd_timeout` 0/1). The GUI writes those
sysfs files; the EC keeps the last level after reboot without userspace.
Shipping this tree does not change the MIT license of the userspace
daemon or Electron GUI.
