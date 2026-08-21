# Acer Nitro Perfect Fan — beginner install guide

Copy-paste the commands. You do not need to be a programmer.

**Polski:** [INSTALL_PL.md](INSTALL_PL.md)  
**Technical reference:** [README.md](README.md)

## Simplest install — Acer Nitro AN515-54

If you have an **Acer Nitro AN515-54**, run only these commands. The installer
will install the fan driver, system service, and configuration for you.

```bash
sudo apt update
sudo apt install -y git python3 nodejs npm lm-sensors dkms build-essential linux-headers-$(uname -r)
git clone https://github.com/Kaspral1/Acer-Nitro-Perfect-Fan.git
cd Acer-Nitro-Perfect-Fan
sudo ./install.sh
cd gui-app
npm install
npm start
```

The application window should open and show **ONLINE**. Do not run
`acer-nitro-ec/install-kbd-backlight.sh` or `nbfc/install-nbfc-config.sh`
manually when using this path.

If you have another model or installation reports an error, continue with the
full guide and diagnostics below.

On another laptop, `install.sh` does not load the `acer-nitro-ec` driver. If a
working `nbfc-linux` profile is available, the installer keeps NBFC as the fan
backend.

---

## 1. Is this for you?

| Question | Answer |
|----------|--------|
| OS? | **Linux + systemd** only (Mint, Ubuntu, Debian, Fedora…). |
| Windows / macOS? | **No.** Use [keizenx/nitro-fan-control](https://github.com/keizenx/nitro-fan-control) + NBFC on Windows. |
| Laptop? | **Acer Nitro 5.** Fully tested: **AN515-54**. |
| Predator / Helios / Nitro V? | **Not claimed.** Different EC or WMI. |

Check your model:

```bash
cat /sys/class/dmi/id/product_name
```

You want something like `Nitro AN515-54`.

With the bundled `acer-nitro-ec` driver, the supported models are:

- Acer Nitro 5 AN515-44
- Acer Nitro 5 AN515-46
- Acer Nitro 5 AN515-54 — fully tested
- Acer Nitro 5 AN515-56
- Acer Nitro 5 AN515-57
- Acer Nitro 5 AN515-58
- Acer Nitro 5 AN517-55

AN515-51, AN515-55, AN517-51, and AN517-54 can also be tried after applying
the driver patch, but they are not fully verified. Other laptops may work only
through `nbfc-linux` with a matching NBFC profile.

> **Safety.** Manual fan control can overheat the machine. The **CPU fan is hard-clamped to 30%**. Use at your own risk.

---

## 2. What gets installed

Two pieces. You need both.

1. **Background service (daemon)** — starts with the computer, even with no window open. This is what actually writes fan speeds. Pick Silent / Balanced / Turbo once; the service keeps using that profile.
2. **Window (GUI)** — sliders, fan profiles, charts, two color themes (Nitro / OutRun). On AN515-54, Settings also has keyboard backlight **Off / 25 / 50 / 75 / 100** (and optional 30 s timeout) through `acer-nitro-ec` — **not** DAMX. That level is stored in the EC, so it survives reboot with the window closed. CPU power profiles (Eco / Quiet / Balanced / Sport / Max) need a separately installed **DAMX** daemon (Div Acer Manager Max, **GPL-3.0**). Pick a CPU profile once; DAMX reapplies it at boot. This project does not ship or install DAMX. The rest of the panel works without it.

An AppImage **does not replace** the service. Always run `install.sh` first.

---

## 3. Terminal basics

1. `Ctrl+Alt+T` (or menu → Terminal).
2. Paste a command, press **Enter**.
3. A `[sudo] password` prompt is your login password. **Nothing appears as you type.** Then Enter.
4. If asked `Y/n`, type `Y` and Enter.

---

## 4. One-time packages

Mint / Ubuntu / Debian:

```bash
sudo apt update
sudo apt install -y git python3 nodejs npm lm-sensors dkms build-essential linux-headers-$(uname -r)
```

Check:

```bash
python3 --version
node --version
npm --version
```

Need Python **3.8+** and Node **16+**.

---

## 5. Get the project

**A — folder already on disk:**

```bash
cd ~/Acer-Nitro-Perfect-Fan
```

Change the path if yours is different.

**B — clone from GitHub:**

```bash
cd ~
git clone https://github.com/Kaspral1/Acer-Nitro-Perfect-Fan.git
cd Acer-Nitro-Perfect-Fan
```

**C — ZIP from GitHub:** unpack, `cd` into that folder.

Then:

```bash
chmod +x check-system.sh install.sh uninstall.sh update-daemon.sh restore-auto.sh
./check-system.sh
```

Read-only. A green `[OK]` on `acer_nitro_ec` or the NBFC socket means a backend exists.

---

## 6. Fan backend

The app will not poke EC registers itself. It needs **one** backend.

### 6a. Preferred: `acer_nitro_ec`

```bash
grep -H . /sys/class/hwmon/hwmon*/name | grep acer_nitro_ec
```

- **A match** → go to step 7.
- **No output** → install / patch the DKMS module:

```bash
sudo ./acer-nitro-ec/install-kbd-backlight.sh
```

(`apply.sh` is the same installer.) This is the fan driver **and**, on AN515-54, the keyboard backlight sysfs. Then re-run the `grep`. You should also have:

```bash
cat /sys/devices/platform/acer-nitro-ec/kbd_backlight
```

Models not on the DMI list (Nitro V, most Predators) will **not** appear after this patch. Use 6b or another tool.

### 6b. Fallback: NBFC

Only if 6a failed **and** [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux) is installed:

```bash
sudo ./nbfc/install-nbfc-config.sh
sudo systemctl enable --now nbfc_service
```

Do not run two EC writers at once. Details: [nbfc/README.md](nbfc/README.md).

---

## 7. System service

From the project folder:

```bash
sudo ./install.sh
```

This copies the daemon to `/usr/local/lib/acer-nitro-perfect-fan/` (outside an encrypted `/home`, so it works at boot), creates user `acer_nitro_perfect_fan`, writes `/etc/nitro-fan/config.json` if missing, and enables `acer-nitro-perfect-fan.service`.

Look for **`active (running)`** in the status dump.

Later:

```bash
systemctl status acer-nitro-perfect-fan.service
```

Press `q` to leave.

---

## 8. GUI

```bash
cd gui-app
npm install
npm start
```

The first `npm install` downloads Electron and needs the network.

You want an **ONLINE** badge, not a red OFFLINE.

- **MANUAL** — sliders write PWM.
- **AUTO** — Silent / Balanced / Turbo **fan** curves (this is not the CPU power profile).
- **POWER PROFILE** (Eco / Quiet / Balanced / Sport / Max) — CPU turbo/caps via DAMX. Set once; DAMX applies it in the background at boot. The GUI can stay closed.
- **Settings** — keyboard backlight Off / 25 / 50 / 75 / 100 and “turn off after 30 s”. Set once; the EC keeps it. Stock Linux always came back at max brightness on boot.
- **Settings → Theme** — Nitro or OutRun.

Next day:

```bash
cd ~/Acer-Nitro-Perfect-Fan/gui-app
npm start
```

Do not re-run `install.sh` unless you are reinstalling.

Optional AppImage:

```bash
cd gui-app
npm run dist
```

Artifacts land in `gui-app/dist/`. The **step 7 service is still required**.

---

## 9. Prove it works

```bash
watch -n1 sensors
```

or

```bash
./check-system.sh
```

Change a profile or move the master slider in MANUAL. RPM in `sensors` should move within 1–2 seconds. `Ctrl+C` stops `watch`.

---

## 10. Troubleshooting

| Symptom | What to do |
|---------|------------|
| Service `failed` / restart loop | `journalctl -u acer-nitro-perfect-fan.service -n 50 --no-pager` and `./check-system.sh` |
| GUI OFFLINE | Keep the `npm start` terminal open; read the errors. Usually skipped `npm install`. |
| Sliders do nothing | `systemctl status acer-nitro-perfect-fan.service`. Another fan tool must not write the EC. |
| Fans oscillate | Two controllers. Keep **one**: this daemon **or** standalone NBFC. |
| Too loud / too hot | **Restore auto** in the GUI, or the command below. |
| Keyboard backlight greyed out | Need AN515-54 + this tree's `acer-nitro-ec`. `sudo ./acer-nitro-ec/install-kbd-backlight.sh`, then `cat /sys/devices/platform/acer-nitro-ec/kbd_backlight`. |
| CPU Eco/Quiet/… buttons offline | DAMX is not running. `sudo systemctl start damx-daemon` (install DAMX separately). |

Hand control back to firmware:

```bash
./restore-auto.sh
```

or

```bash
sudo systemctl stop acer-nitro-perfect-fan.service
```

---

## 11. Uninstall

```bash
sudo ./uninstall.sh
```

Stops the service, restores EC auto, removes `/usr/local/lib/acer-nitro-perfect-fan` and `/etc/nitro-fan`. The git/ZIP folder stays. Optional: `rm -rf gui-app/node_modules`.

---

## 12. Update the daemon after pulling new files

```bash
sudo ./update-daemon.sh
```

Leaves `/etc/nitro-fan/config.json` untouched.

---

Do not write `/sys` PWM or EC registers by hand. Use the kernel module or NBFC.
