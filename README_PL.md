# Acer Nitro Perfect Fan <a href="https://www.buymeacoffee.com/Kaspral" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/arial-yellow.png" alt="Buy Me a Coffee" align="right" height="36"></a>

[![Linux](https://img.shields.io/badge/OS-Linux-orange.svg)](https://www.kernel.org/)
[![Python](https://img.shields.io/badge/Backend-Python%203-blue.svg)](https://www.python.org/)
[![Electron](https://img.shields.io/badge/GUI-Electron-47848F.svg)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v1.1-informational.svg)](gui-app/package.json)
[![CI](https://github.com/Kaspral1/Acer-Nitro-Perfect-Fan/actions/workflows/ci.yml/badge.svg)](https://github.com/Kaspral1/Acer-Nitro-Perfect-Fan/actions/workflows/ci.yml)

**Acer Nitro Perfect Fan** — sterowanie wentylatorami na **Linuxie + systemd** dla **Acer Nitro 5**.  
Demon systemd → wspólny JSON → most Python → dashboard Electron.

**Obsługiwane modele** (ta sama mapa EC, upstream `acer-nitro-ec`):

- Acer Nitro 5 AN515-44
- Acer Nitro 5 AN515-46
- Acer Nitro 5 AN515-54 — **w pełni przetestowany** (maszyna deweloperska)
- Acer Nitro 5 AN515-56
- Acer Nitro 5 AN515-57
- Acer Nitro 5 AN515-58
- Acer Nitro 5 AN517-55

**Inne laptopy:** zainstaluj [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux) i pasujący profil — zobacz [Inne laptopy (NBFC)](#inne-laptopy-nbfc).

Motyw **Nitro** (domyślny):

![Acer Nitro Perfect Fan — motyw Nitro](assets/Screenshot.png)

Motyw **OutRun** (Ustawienia → Motyw):

![Acer Nitro Perfect Fan — motyw OutRun](assets/Screenshot-outrun.png)

| Zacznij tutaj | |
|---------------|---|
| **Nie programuję** | **[INSTALL_PL.md](INSTALL_PL.md)** — kopiuj komendy |
| English | [INSTALL.md](INSTALL.md) · [README.md](README.md) |
| Diagnostyka | `./check-system.sh` (tylko odczyt) |

> **Ostrzeżenie.** Ręczne sterowanie może **przegrzać i uszkodzić sprzęt**. PWM **CPU ma twardą podłogę 30%** (daemon + API + GUI). GPU może nadal używać Zero-RPM na zimno. **Używasz na własną odpowiedzialność.**

Windows i macOS **nie są** obsługiwane.

---

## Funkcje

**Wentylatory** (daemon — startuje z systemem, okienko nie musi być otwarte)

- Profile: Cichy / Normalny / Turbo z osobnymi krzywymi CPU i GPU
- Edytor krzywych: temperatura (°C) → obroty (%) z podglądem
- Manualne PWM: master + osobne suwaki (CPU min. 30%, GPU w dynamic może 0%)
- Histereza Zero-RPM GPU: stop poniżej ~40°C, start powyżej ~48°C
- Wygładzanie EMA

**Profil zasilania CPU** (sidebar — Eco / Cichy / Balans / Sport / Max)

- Zmienia turbo i limity procesora przez osobno zainstalowany daemon [DAMX](https://github.com/PXDiv/Div-Acer-Manager-Max), niezależnie od krzywych wentylatorów
- Wystarczy wybrać **raz**. DAMX zapamiętuje wybór i wgrywa go przy starcie systemu — tego programu nie trzeba wtedy uruchamiać
- Bez DAMX reszta panelu działa; te pięć przycisków zostaje offline

**Podświetlanie klawiatury** (Ustawienia, **AN515-54** + `acer-nitro-ec`)

- Poziomy **Off / 25 / 50 / 75 / 100** oraz opcjonalne gaśnięcie po 30 s
- Zapis idzie wprost do Embedded Controllera. Ustawiasz raz; **zostaje po restarcie** przy zamkniętym programie
- Na zwykłym Linuksie BIOS dawał tylko wyłączenie albo timeout 30 s, a **każdy start wracał na 100%**. Ten panel to brakujące „zostaw mój poziom”

![Ustawienia — podświetlanie klawiatury Off / 25 / 50 / 75 / 100](assets/Screenshot-settings.png)

**Interfejs**

- Dwa motywy: **Nitro** (domyślny) i **OutRun** — Ustawienia → Motyw, zapamiętywane po restarcie
- Zasobnik systemowy, i18n (PL / EN / ES / DE / CS)
- Opcjonalne logi CSV + modal podsumowania
- Badge połączenia: online / offline

---

## Kompatybilność

Daemon na starcie wybiera backend (`backend` w `/etc/nitro-fan/config.json`, domyślnie `auto`):

1. **`acer_nitro_ec`** — hwmon `pwm1` / `pwm2` (gdy moduł jest załadowany)
2. **`nbfc`** — gniazdo [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux), gdy nie ma sterownika

`auto` **nie** pisze przez NBFC, gdy istnieje `acer_nitro_ec` (żeby dwa programy nie walczyły o EC).

### Zweryfikowane

| Model | Status |
|-------|--------|
| **Acer Nitro 5 AN515-54** | Pełne testy (maszyna deweloperska) |

### Ta sama mapa EC co Acer Nitro 5 AN515-54 (wymaga spatchowanego `acer-nitro-ec`)

Upstream DKMS ładuje się tylko na:

| Model |
|-------|
| Acer Nitro 5 AN515-44 |
| Acer Nitro 5 AN515-46 |
| Acer Nitro 5 AN515-54 |
| Acer Nitro 5 AN515-56 |
| Acer Nitro 5 AN515-57 |
| Acer Nitro 5 AN515-58 |
| Acer Nitro 5 AN517-55 |

Tutaj można dodać te dodatkowe modele (`regs_an515_46` — **nie** w pełni zweryfikowane):

| Model |
|-------|
| Acer Nitro 5 AN515-51 |
| Acer Nitro 5 AN515-55 |
| Acer Nitro 5 AN517-51 |
| Acer Nitro 5 AN517-54 |

```bash
sudo ./acer-nitro-ec/apply.sh
./check-system.sh
```

### Inne laptopy (NBFC)

**Inne laptopy też mogą używać tego programu** — to samo okienko, te same krzywe. Musisz sam zainstalować [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux), a Twój model musi już mieć działający profil NBFC. Ten program **nie** wymyśla sterowania wentylatorami dla nieznanego sprzętu.

| Twój komputer | Co jest potrzebne |
|---------------|-------------------|
| **Acer Nitro 5 AN515-54** (oraz lista powyżej) | Wystarczy `acer_nitro_ec`. NBFC jest opcjonalne. |
| **Inny laptop** z listy `nbfc config -l` | Zainstaluj nbfc-linux, uruchom `nbfc_service`, wybierz **swój** profil, ustaw `"backend": "nbfc"`. nbfc-linux ma ok. 180 konfigów. |
| Laptop **spoza** tej listy, desktop, Windows, macOS | **Nieobsługiwane.** |

**Nie** wgrywaj profilu `Acer Nitro AN515-54.json` z tego repo na inny model. Wybierz profil zgodny z nazwą DMI (`nbfc config -l`).

**Nie obiecujemy** dla modułu jądra: Predator, Helios, Nitro V (inny EC albo WMI). Tutaj zadziałają **tylko**, jeśli nbfc-linux już ma konfig dokładnie dla tego modelu.

Komendy: [NBFC](#nbfc-alternatywny-backend).

---

## Pokrewny projekt: keizenx/nitro-fan-control

Dashboard powstał jako fork **[keizenx/nitro-fan-control](https://github.com/keizenx/nitro-fan-control)** (MIT). Tamta aplikacja to GUI **przed NBFC**. Tutaj interfejs Electron zostaje; daemon woli `acer_nitro_ec`, a gdy go nie ma — steruje przez **nbfc-linux**.

Nazwy `nbfc_control_api.py` i `nbfc_config.json` są historyczne. To most JSON/stdio i domyślne krzywe **tego** projektu, nie pliki usługi NBFC. Prawdziwy profil laptopa jest w [`nbfc/`](nbfc/).

| | **Ten projekt** | **keizenx/nitro-fan-control** |
|---|-----------------|--------------------------------|
| Rola | Daemon + GUI | Tylko GUI |
| Backend | `acer_nitro_ec` **albo** nbfc-linux (auto) | [NBFC](https://github.com/nbfc-linux/nbfc-linux) / [hirschmann/nbfc](https://github.com/hirschmann/nbfc) |
| Kto pisze do EC | daemon → hwmon **albo** daemon → `nbfc_service` | `nbfc_service` / `nbfc.exe` |
| System | tylko Linux + **systemd** | Linux i **Windows** |
| Moduł jądra | `acer-nitro-ec` (DKMS) na ścieżce hwmon | `ec_sys` / `acpi_ec` (`write_support=1`) |
| Krzywe | interpolowany edytor °C→%, EMA, podłoga CPU 30%, Zero-RPM GPU | progi schodkowe NBFC |
| Modele | spatchowana lista AN515/AN517 + konfigi nbfc-linux | każdy laptop z konfigiem NBFC (~180 modeli) |
| Paczka GUI | AppImage / `.deb` — **demon nadal wymagany** | AppImage / `.deb` / installer Windows |

Na Linuksie — ten projekt. Na Windowsie — keizenx + NBFC.

---

## Architektura

```
┌─────────────────────────────────────────────────────────────┐
│              Dashboard Electron (GUI)                       │
└──────────────────────────────┬──────────────────────────────┘
                               │ IPC + JSON stdio
┌──────────────────────────────▼──────────────────────────────┐
│              nbfc_control_api.py  (most, nazwa historyczna) │
└──────────────────────────────┬──────────────────────────────┘
                               │ /etc/nitro-fan/config.json
┌──────────────────────────────▼──────────────────────────────┐
│         nitro_fan_daemon.py  /  acer-nitro-perfect-fan.service       │
│              fan_backend.py  (auto: hwmon albo nbfc)        │
└───────────────┬─────────────────────────────┬───────────────┘
                │ hwmon pwm1/pwm2             │ gniazdo UNIX
┌───────────────▼───────────────┐   ┌─────────▼──────────────┐
│     Kernel: acer_nitro_ec     │   │  nbfc_service (EC)     │
└───────────────────────────────┘   └────────────────────────┘
```

---

## Instalacja

Pełna instrukcja „kopiuj i wklej”: **[INSTALL_PL.md](INSTALL_PL.md)**.

```bash
git clone https://github.com/Kaspral1/Acer-Nitro-Perfect-Fan.git
cd Acer-Nitro-Perfect-Fan
./check-system.sh
sudo ./install.sh
cd gui-app && npm install && npm start
```

`install.sh` kopiuje daemon do `/usr/local/lib/acer-nitro-perfect-fan/`, konfigurację do `/etc/nitro-fan/`, regułę udev i włącza `acer-nitro-perfect-fan.service`.

Opcjonalny AppImage / `.deb`: `cd gui-app && npm run dist`. Paczka GUI **nie zastępuje** demona.

---

## Odinstalowanie

```bash
sudo ./uninstall.sh
```

Zatrzymuje usługę, przywraca auto EC, usuwa unit/pliki/udev/config i użytkownika serwisowego. Repozytorium zostaje.

Awaryjnie: `./restore-auto.sh` albo `sudo systemctl stop acer-nitro-perfect-fan.service`.

---

## Konfiguracja (`/etc/nitro-fan/config.json`)

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

- `backend`: `auto` (domyślnie), `acer_nitro_ec` albo `nbfc`
- `mode`: `dynamic` (krzywe) albo `manual` (stałe PWM z `manual_speeds`)
- Wentylator `0` = CPU, `1` = GPU
- Wartości poniżej **30%** są podnoszone do 30% (GUI, API, daemon)
- `speed_offset` (opcjonalne, domyślnie `0`): trwały boost CPU vs GPU (`−50…+50`)

---

## NBFC (alternatywny backend)

[NoteBook FanControl](https://github.com/nbfc-linux/nbfc-linux) gada z Embedded Controllerem laptopa **bezpośrednio**. Dzięki temu ten program może sterować **innymi laptopami**, nie tylko Acer Nitro 5: krzywe liczy ta aplikacja, zapis do EC robi `nbfc_service`.

**Na innym laptopie** (nie AN515-54):

1. Zainstaluj [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux).
2. Sprawdź, czy Twój model jest na liście: `nbfc config -l` (ok. 180 profili). Jeśli go nie ma — stop; ten program nie pomoże.
3. Wybierz **swój** profil (`nbfc config -a "Dokładna nazwa z listy"`), potem `sudo systemctl enable --now nbfc_service`.
4. Ustaw `"backend": "nbfc"` w `/etc/nitro-fan/config.json` i uruchom `sudo ./install.sh`.

Pokrewne GUI [keizenx/nitro-fan-control](https://github.com/keizenx/nitro-fan-control) używa tej samej ścieżki NBFC (i działa też na Windowsie).

W repo jest przetestowany profil **Acer Nitro 5 AN515-54** (tylko na ten model):

- [`nbfc/Acer Nitro AN515-54.json`](nbfc/Acer%20Nitro%20AN515-54.json)
- [`nbfc/nbfc.json`](nbfc/nbfc.json)
- [`nbfc/README.md`](nbfc/README.md)

**Z daemonem tego projektu na Acer Nitro 5 AN515-54:**

```bash
sudo systemctl disable --now acer-nitro-perfect-fan.service
sudo ./nbfc/install-nbfc-config.sh
sudo systemctl enable --now nbfc_service
sudo ./install.sh
```

Gdy jest też `acer_nitro_ec`, `auto` wybiera hwmon. Wymuszenie: `"backend": "nbfc"`.

**Samo NBFC** (GUI keizenx albo `nbfc set`) — najpierw zatrzymaj tego demona.

| Wentylator | Odczyt RPM | Zapis duty | Odblokowanie manual |
|------------|------------|------------|---------------------|
| CPU | 19 (`0x13`) | 55 (`0x37`) | 34 (`0x22`) = 12 |
| GPU | 21 (`0x15`) | 58 (`0x3A`) | 33 (`0x21`) = 48 |
| Oba | — | — | 151 (`0x97`) = 1 |

---

## Rozwiązywanie problemów

1. **Wentylatory nie reagują** → `systemctl status acer-nitro-perfect-fan.service`, `./check-system.sh`
2. **GUI offline** → most Python nie działa — logi z terminala `npm start`
3. **Fabryczne auto EC** → `./restore-auto.sh`
4. **Brak wykresów** → `npm install` w `gui-app`
5. **Wentylatory skaczą** → dwa kontrolery. `systemctl is-active acer-nitro-perfect-fan.service nbfc_service`

Więcej: [INSTALL_PL.md](INSTALL_PL.md#10-gdy-coś-pójdzie-nie-tak).

---

## Development

```bash
cd gui-app && npm test
python3 -m py_compile fan_backend.py nbfc_control_api.py nitro_fan_daemon.py nitro_log_summary.py
python3 test_fan_backend.py
```

Zobacz [CONTRIBUTING.md](CONTRIBUTING.md). CI: `.github/workflows/ci.yml`.

---

## Licencja

MIT — [LICENSE](LICENSE).

Copyright (c) 2024 [keizenx](https://github.com/keizenx)  
Copyright (c) 2026 [Kaspral1](https://github.com/Kaspral1)

Rodowód GUI: [keizenx/nitro-fan-control](https://github.com/keizenx/nitro-fan-control).  
Profil NBFC na bazie mapy EC Chandradeep Dey / alex-fl (AN515-54).

**Ten projekt zostaje na MIT**, także gdy działają przyciski profili zasilania. One łączą się z osobno zainstalowanym daemonem [Div Acer Manager Max (DAMX)](https://github.com/PXDiv/Div-Acer-Manager-Max) (oraz [Linuwu-Sense](https://github.com/PXDiv/Div-Linuwu-Sense)) przez gniazdo Unix. DAMX jest na **GPL-3.0** i **nie jest** dołączony do tego repozytorium. Opcjonalny moduł jądra `acer-nitro-ec` w tym repo jest na **GPL-2.0**. Szczegóły: [THIRD_PARTY.md](THIRD_PARTY.md).
