# Acer Nitro Perfect Fan <a href="https://www.buymeacoffee.com/Kaspral" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/arial-yellow.png" alt="Buy Me a Coffee" align="right" height="36"></a>

[![Linux](https://img.shields.io/badge/OS-Linux-orange.svg)](https://www.kernel.org/)
[![Python](https://img.shields.io/badge/Backend-Python%203-blue.svg)](https://www.python.org/)
[![Electron](https://img.shields.io/badge/GUI-Electron-47848F.svg)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v1.1-informational.svg)](gui-app/package.json)

Sterowanie wentylatorami dla **Acer Nitro 5** na Linuxie z systemd: daemon w tle plus dashboard Electron.

**Obsługiwane:** Acer Nitro 5 AN515-44 / 46 / **54** (w pełni przetestowany) / 56 / 57 / 58 oraz AN517-55. Inne laptopy działają przez [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux), jeśli ma profil dla Twojego modelu. Zobacz [COMPATIBLE-MODELS_PL.md](COMPATIBLE-MODELS_PL.md). Windows i macOS **nie są** obsługiwane.

![Acer Nitro Perfect Fan](assets/Screenshot.png)

## Szybki start

```bash
git clone https://github.com/Kaspral1/Acer-Nitro-Perfect-Fan.git
cd Acer-Nitro-Perfect-Fan
./setup.sh
cd gui-app && npm start
```

`setup.sh` najpierw sprawdza laptopa i zatrzymuje się na sprzęcie, którym nie może bezpiecznie sterować. Potem instaluje pakiety, sterownik wentylatorów, usługę w tle i GUI.

- **Czy zadziała na moim laptopie?** Uruchom `./check-system.sh`. Nic nie zmienia, a na końcu wypisuje prosty werdykt **YES / MAYBE / NO**.
- **Krok po kroku:** [INSTALL_PL.md](INSTALL_PL.md) · **English:** [README.md](README.md) · [INSTALL.md](INSTALL.md)

> **Ostrzeżenie.** Ręczne sterowanie może przegrzać i uszkodzić sprzęt. PWM CPU ma twardą podłogę 30%, a instalator odmawia pracy bez działającego backendu wentylatorów. **Używasz na własną odpowiedzialność.**

## Funkcje

- Profile **Cichy / Normalny / Turbo** i edytor własnych krzywych temperatura do obrotów z podglądem na żywo.
- Ręczne suwaki PWM (CPU min. 30%), Zero-RPM GPU, wygładzanie EMA. Ustawiasz raz, daemon pilnuje dalej bez otwartego okna.
- Profile zasilania CPU **Eco ... Max** (turbo i limity mocy) przez opcjonalny daemon [DAMX](https://github.com/PXDiv/Div-Acer-Manager-Max).
- Podświetlenie klawiatury **Off / 25 / 50 / 75 / 100**, które zostaje po restarcie (AN515-54).
- Cztery motywy (Nitro / OutRun / Matrix / Reddit), zasobnik systemowy, pięć języków, telemetria CSV z dziennymi raportami.

## Dokumentacja

| Temat | Plik |
|-------|------|
| Instalacja krok po kroku | [INSTALL_PL.md](INSTALL_PL.md) · [INSTALL.md](INSTALL.md) |
| Kompatybilne laptopy | [COMPATIBLE-MODELS_PL.md](COMPATIBLE-MODELS_PL.md) |
| Architektura, konfiguracja, backend NBFC, development (EN) | [TECHNICAL.md](TECHNICAL.md) |
| Dodanie obsługi nowego modelu | [SUPPORT-NEW-MODEL_PL.md](SUPPORT-NEW-MODEL_PL.md) |
| Lista zmian | [CHANGELOG.md](CHANGELOG.md) |

**Odinstalowanie:** `sudo ./uninstall.sh`. Awaryjnie: `./restore-auto.sh`.

**Coś nie działa?** Uruchom `./check-system.sh` i wklej wydruk do zgłoszenia na GitHubie.

## Licencja

MIT, zobacz [LICENSE](LICENSE). © 2024 [keizenx](https://github.com/keizenx), © 2026 [Kaspral1](https://github.com/Kaspral1). Rodowód GUI: [keizenx/nitro-fan-control](https://github.com/keizenx/nitro-fan-control). Części opcjonalne: moduł jądra `acer-nitro-ec` jest GPL-2.0, DAMX jest GPL-3.0 i nie jest dołączony. Szczegóły w [THIRD_PARTY.md](THIRD_PARTY.md).

Program powstał przy współpracy z narzędziami AI. Decyzje projektowe i publikowany kod są odpowiedzialnością opiekuna repozytorium (Kaspral1).
