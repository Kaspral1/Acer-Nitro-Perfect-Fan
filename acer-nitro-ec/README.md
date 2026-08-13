# acer-nitro-ec DMI expansion

Beginners: [INSTALL.md](../INSTALL.md) step 6a / [INSTALL_PL.md](../INSTALL_PL.md).

Upstream [acer-nitro-ec](https://github.com/OrnelasD-Rogers/acer-nitro-ec) only
loads on a short DMI list, even though `AN515-51`, `AN515-55`, `AN517-51` and
`AN517-54` share the same dual-fan EC map as AN515-54 (`regs_an515_46`).

`dmi-models.patch` adds those four names. PWM still goes through hwmon
`pwm1`/`pwm2` — this project does not poke EC registers itself.

## Install / rebuild DKMS

```bash
sudo ./acer-nitro-ec/apply.sh
```

Needs `dkms`, kernel headers (`linux-headers-$(uname -r)`), and either an
existing `/usr/src/acer-nitro-ec-*` tree or `git`.

After a successful build:

```bash
grep -H . /sys/class/hwmon/hwmon*/name | grep acer_nitro_ec
```

If the module still says `unsupported model`, your DMI string is different —
send `cat /sys/class/dmi/id/product_name` in a GitHub issue.

Predator / Helios / Nitro V are **not** added here on purpose (different EC/WMI).
Use the NBFC backend for models that already have an nbfc-linux config.
