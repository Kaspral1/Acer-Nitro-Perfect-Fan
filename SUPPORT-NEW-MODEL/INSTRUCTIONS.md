# DAMX test on an Acer Nitro - instructions for the laptop owner

Thank you for helping with this test! We are checking whether **DAMX**
(Div Acer Manager Max) can properly control the fans on your laptop model.
This is groundwork for a new fan-control application.

The whole thing takes about 15-20 minutes. One reboot is required.

## Where the results go

Results are published as a **GitHub Issue** in our project:
https://github.com/Kaspral1/Acer-Nitro-Perfect-Fan/issues

This keeps the results public so they also help other owners of the same
model. You will need a (free) GitHub account. The files produced by this
test contain no personal data - the reports may at most include your
username inside directory paths (e.g. `/home/john/...`), which is harmless;
feel free to review them before publishing.

## Requirements

- An Acer laptop (e.g. Nitro 16 AN16-41) running **Linux** (Ubuntu, Mint,
  Fedora, Arch... - anything with systemd).
- Kernel **6.13 or newer** (the script checks this in step 1).
- Internet connection.
- Administrator privileges (`sudo`).
- A GitHub account (to publish the results).

## Step 1 - diagnostics before installation (2 minutes)

You received the file `damx-diag.sh`. In a terminal, in the folder
containing it:

```bash
chmod +x damx-diag.sh
./damx-diag.sh pre
```

The script **only reads** system information - it changes nothing.
It creates `~/damx-report-pre.txt` - keep it; you will attach it to the
GitHub issue in step 4.

If the script reports "kernel < 6.13" or missing kernel headers - don't
stop: publish just the step-1 report as an issue (see step 4) and mention
what the script said. That is valuable information for us too.

## Step 1b - ACPI dump (optional, 2 minutes, very helpful)

If you can, please also prepare a dump of your motherboard firmware
(the ACPI tables). It lets us understand how the factory cooling system is
managed on your model - this helps if DAMX does not work 100%.

**This is safe and contains none of your data.** The dump files are code
provided by the hardware manufacturer (Acer) - no personal files, passwords,
usernames or even hardware serial numbers; just hardware definitions and
cooling logic. They can safely be published on GitHub.

1. Install the ACPI tools:
   - **Ubuntu / Debian / Mint:** `sudo apt update && sudo apt install -y acpica-tools`
   - **Arch / Manjaro:** `sudo pacman -S acpica`
   - **Fedora:** `sudo dnf install acpica-tools`

2. Paste this whole block into your terminal at once:

   ```bash
   mkdir -p ~/acpi_dump && cd ~/acpi_dump && sudo acpidump -b && iasl -d *.dat && zip -r ~/acpi_dump_my_model.zip ~/acpi_dump && echo "DONE! The file acpi_dump_my_model.zip is in your home directory."
   ```

3. `acpi_dump_my_model.zip` will appear in your home directory - keep it
   for step 4.

## Step 2 - installing DAMX (10 minutes + reboot)

1. Download the latest DAMX release:
   https://github.com/PXDiv/Div-Acer-Manager-Max/releases
   (the `DAMX-*.tar.xz` file in the Assets section of the newest release).

2. Extract it and run the installer:

   ```bash
   tar -xJf DAMX-*.tar.xz
   cd DAMX-*        # the folder name may differ
   chmod +x setup.sh
   ./setup.sh
   ```

3. In the menu choose **`1` (Install)**.

4. **If Secure Boot is enabled**, the installer will ask for a one-time
   password and schedule a MOK key enrollment:
   - after reboot you will see the blue MOK Manager screen → choose
     **Enroll MOK → Continue → Yes** and enter that password,
   - once the system boots again, **run `./setup.sh` one more time** and
     choose `1` again to finish the installation.

5. **Reboot** when the installation completes.

If anything goes wrong: logs are in `/var/log/DAMX_Daemon_Log.log`,
and the project FAQ is at
https://github.com/PXDiv/Div-Acer-Manager-Max/blob/main/FAQ.md
(to uninstall: `./setup.sh` → option `3`).

## Step 3 - verification after reboot (3 minutes)

After the reboot, in a terminal, in the folder with the script:

```bash
./damx-diag.sh post
```

The script checks the DAMX service and sensors, and runs a **short fan
test**: for ~8 seconds it sets the fans to 50% (you should hear the speed
change), then automatically restores automatic fan control.
Remember **whether you heard the change** (yes/no) - you will add this to
the issue.

It creates `~/damx-report-post.txt`.

## Step 4 - publishing the results on GitHub

1. Go to https://github.com/Kaspral1/Acer-Nitro-Perfect-Fan/issues
   and click **New Issue** (login required).
2. Title: `DAMX test - Acer Nitro [your exact model, e.g. AN16-41]`
3. In the body write:
   - the exact laptop model (e.g. from the sticker on the chassis),
   - your distro and kernel version (they are in the report),
   - the answer: **did you hear the fan speed change during the step-3
     test?** (yes/no),
   - whether anything went wrong along the way.
4. **Drag and drop** these files into the text box:
   - `~/damx-report-pre.txt`
   - `~/damx-report-post.txt`
   - `~/acpi_dump_my_model.zip` (if you did step 1b)
5. Submit with **Submit new issue**. Done - thank you!

## Step 5 - after the test

You can keep DAMX - you get a free app for fan control, performance
profiles and keyboard backlight (the "DAMX" icon in the app menu).
If you don't want to keep it: `./setup.sh` → option `3` (Uninstall)
and reboot.

## Safety

- The `damx-diag.sh` script is open for inspection - it only reads system
  configuration and changes fan speed once for 8 seconds, then restores
  automatic control (even if the script is interrupted).
- DAMX is an open-source project (GPL-3.0) installed from its official
  repo: https://github.com/PXDiv/Div-Acer-Manager-Max
- The DAMX installer replaces the stock `acer_wmi` driver - uninstalling
  restores the previous state.
