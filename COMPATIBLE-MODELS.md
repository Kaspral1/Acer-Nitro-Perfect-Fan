# Compatible laptop models

## Supported by the bundled `acer-nitro-ec` driver

These models use the EC map supported by the bundled kernel driver:

- Acer Nitro 5 AN515-44
- Acer Nitro 5 AN515-46
- Acer Nitro 5 AN515-54 — fully tested
- Acer Nitro 5 AN515-56
- Acer Nitro 5 AN515-57
- Acer Nitro 5 AN515-58
- Acer Nitro 5 AN517-55

The fan control path is `acer_nitro_ec` through the Linux hwmon interface.
The AN515-54 is the only model fully tested by the project maintainer.

## Experimental models with the optional driver patch

The repository can add these DMI models to the driver with
`acer-nitro-ec/dmi-models.patch`:

- Acer Nitro 5 AN515-51
- Acer Nitro 5 AN515-55
- Acer Nitro 5 AN517-51
- Acer Nitro 5 AN517-54

These models are not fully verified. Apply the patch only if you can test fan
control safely on the exact laptop model.

## Models controlled through NBFC

The application can also use `nbfc-linux` as its fan-control backend. In this
mode, compatibility is determined by the NBFC profile installed on the system,
not by this repository. This includes other Acer Nitro, Acer Predator, Acer
Helios, Nitro V, and non-Acer laptops when `nbfc-linux` provides a working
profile for the exact model.

List the profiles available on your system with:

```bash
nbfc config -l
```

Use the profile that exactly matches the laptop's DMI/model name. The bundled
`nbfc/Acer Nitro AN515-54.json` profile must not be used on another model.

To use an NBFC profile:

```bash
sudo ./nbfc/install-nbfc-config.sh
sudo systemctl enable --now nbfc_service
```

Then set `"backend": "nbfc"` in `/etc/nitro-fan/config.json`. Do not run two
fan controllers against the same EC at the same time.

## Not supported

- Windows and macOS
- Desktop computers
- Any laptop without a tested `acer-nitro-ec` mapping or a working
  `nbfc-linux` profile
