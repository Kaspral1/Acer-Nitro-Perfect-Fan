# Acer Nitro Perfect Fan — instalacja dla początkujących

Ta instrukcja jest napisana tak, żeby dało się ją wykonać **kopiując komendy jedna po drugiej**. Nie musisz programować.

**Po angielsku:** [INSTALL.md](INSTALL.md)  
**Szczegóły techniczne:** [README_PL.md](README_PL.md)

---

## 1. Czy ten program jest dla Ciebie?

| Pytanie | Odpowiedź |
|---------|-----------|
| Jaki system? | **Tylko Linux** z `systemd` (Linux Mint, Ubuntu, Debian, Fedora…). |
| Windows / macOS? | **Nie.** Na Windowsie użyj [keizenx/nitro-fan-control](https://github.com/keizenx/nitro-fan-control) + NBFC. |
| Jaki laptop? | **Acer Nitro 5.** W pełni przetestowany: **AN515-54**. |
| Predator / Helios / Nitro V? | **Nie obiecujemy.** Inny układ sterowania wentylatorami. |

Sprawdź model (wklej w terminal i naciśnij Enter):

```bash
cat /sys/class/dmi/id/product_name
```

Powinno pojawić się coś w stylu `Nitro AN515-54`.

> **Ostrzeżenie.** Ręczne sterowanie wentylatorami może przegrzać laptopa. Wentylator **CPU nigdy nie spadnie poniżej 30%**. Używasz na własną odpowiedzialność.

---

## 2. Co zostanie zainstalowane

Program ma **dwie części**. Obie są potrzebne.

1. **Usługa w tle (daemon)** — działa po starcie systemu, nawet bez otwartego okna. To ona naprawdę kręci wentylatorami.
2. **Okienko (GUI)** — suwaki, profile Silent / Normalny / Turbo, wykresy. Na AN515-54 także jasność czerwonej klawiatury i gaśnięcie po 30 s (przez `acer-nitro-ec`, **bez DAMX**). Profile zasilania CPU (Eco / Cichy / Balans / Sport / Max) wymagają osobno zainstalowanego **DAMX** (Div Acer Manager Max, **GPL-3.0**) — ten program go nie instaluje i nie zawiera jego kodu. Bez DAMX reszta panelu działa.

Sama paczka AppImage **nie zastępuje** usługi. Najpierw zawsze `install.sh`.

---

## 3. Terminal — 30 sekund teorii

1. Naciśnij `Ctrl+Alt+T` (albo Menu → Terminal).
2. Każdą komendę wklejasz i zatwierdzasz **Enter**.
3. Gdy system poprosi o hasło (`[sudo] password`), wpisz hasło do swojego konta. **Znaki się nie pokazują** — to normalne. Potem Enter.
4. Jeśli komenda zapyta `Y/n`, wpisz `Y` i Enter.

---

## 4. Jednorazowo: potrzebne programy

Na Linux Mint / Ubuntu / Debian:

```bash
sudo apt update
sudo apt install -y git python3 nodejs npm lm-sensors dkms build-essential linux-headers-$(uname -r)
```

Potem sprawdź, czy wszystko jest na miejscu:

```bash
python3 --version
node --version
npm --version
```

Masz mieć Pythona **3.8+** i Node **16+**. Jeśli `node` nie istnieje, napisz w zgłoszeniu wynik `cat /etc/os-release`.

---

## 5. Pobierz projekt

**Wariant A — folder już leży na dysku:**

```bash
cd ~/Acer-Nitro-Perfect-Fan
# albo stara nazwa folderu:
# cd ~/Pulpit/acer-fancontrol
```

Jeśli katalog nazywa się inaczej, wejdź do niego zamiast tej ścieżki.

**Wariant B — świeży klon z GitHuba:**

```bash
cd ~
git clone https://github.com/Kaspral1/Acer-Nitro-Perfect-Fan.git
cd Acer-Nitro-Perfect-Fan
```

**Wariant C — plik ZIP z GitHuba:** rozpakuj, wejdź do rozpakowanego folderu (`cd …`).

Potem (w tym samym terminalu) zrób szybki przegląd komputera:

```bash
chmod +x check-system.sh install.sh uninstall.sh update-daemon.sh restore-auto.sh
./check-system.sh
```

Nic nie zmienia na wentylatorach. Zielone `[OK]` przy `acer_nitro_ec` albo gnieździe NBFC znaczy, że jest czym sterować.

---

## 6. Sterownik wentylatorów

Program nie „zgaduje” rejestrów płyty. Potrzebuje **jednego** z dwóch backendów:

### 6a. Zalecane: `acer_nitro_ec` (moduł jądra)

Sprawdź:

```bash
grep -H . /sys/class/hwmon/hwmon*/name | grep acer_nitro_ec
```

- **Jest linia z `acer_nitro_ec`** → idź do kroku 7.
- **Nie ma nic** → zainstaluj / rozszerz sterownik:

```bash
sudo ./acer-nitro-ec/install-kbd-backlight.sh
```

To ten sam sterownik co w `install.sh`: wentylatory **oraz** (na AN515-54) podświetlenie klawiatury. Potem ponów `grep` z góry. Powinno też być:

```bash
cat /sys/devices/platform/acer-nitro-ec/kbd_backlight
```

Modele spoza listy (np. nowszy Nitro V) **nie ożyją** po tym patchu. Zostaje ścieżka 6b albo inny program.

### 6b. Plan B: NBFC (gdy nie ma sterownika)

Tylko gdy krok 6a się nie udał **i** masz już [nbfc-linux](https://github.com/nbfc-linux/nbfc-linux):

```bash
sudo ./nbfc/install-nbfc-config.sh
sudo systemctl enable --now nbfc_service
```

Nie uruchamiaj **naraz** dwóch programów piszących do tych samych wentylatorów (ten daemon + osobne NBFC GUI). Szczegóły: [nbfc/README.md](nbfc/README.md).

---

## 7. Usługa systemowa (to jest „instalacja”)

Z katalogu projektu:

```bash
sudo ./install.sh
```

Skrypt:

- kopiuje daemon na `/usr/local/lib/acer-nitro-perfect-fan/` (poza zaszyfrowanym `/home`, więc działa od startu),
- tworzy użytkownika `acer_nitro_perfect_fan`,
- zapisuje konfigurację w `/etc/nitro-fan/config.json` (nie nadpisze Twojej, jeśli już jest),
- włącza usługę `acer-nitro-perfect-fan.service`.

Na końcu zobaczysz kilka linii `systemctl status`. Szukaj **`active (running)`**.

Sprawdzenie później:

```bash
systemctl status acer-nitro-perfect-fan.service
```

`q` zamyka ten podgląd.

---

## 8. Okienko (panel)

W **tym samym** katalogu projektu:

```bash
cd gui-app
npm install
npm start
```

Pierwsze `npm install` trwa minutę albo dłużej i ściąga Electron — to normalne, potrzebny jest internet.

Powinno otworzyć się okno **Acer Nitro Perfect Fan**.

- Badge w górze ma być **ONLINE** (nie czerwony OFFLINE).
- Suwaki ruszają wentylatory dopiero w trybie **MANUAL**.
- W trybie **AUTO** działają krzywe (Silent / Normalny / Turbo).

Żeby uruchomić panel kolejnego dnia:

```bash
cd ~/Acer-Nitro-Perfect-Fan/gui-app
npm start
```

(ścieżkę zmień, jeśli projekt leży gdzie indziej). Usługa w tle już działa — nie musisz powtarzać `install.sh`.

### Opcjonalnie: plik AppImage

```bash
cd gui-app
npm run dist
```

Pliki pojawią się w `gui-app/dist/`. **Usługa z kroku 7 nadal musi być zainstalowana.**

---

## 9. Jak poznać, że działa

W drugim terminalu:

```bash
watch -n1 sensors
```

Albo:

```bash
./check-system.sh
```

W GUI zmień profil albo wejdź w MANUAL i rusz masterem. Obroty w `sensors` powinny się zmienić w ciągu 1–2 sekund.

`Ctrl+C` zamyka `watch`.

---

## 10. Gdy coś pójdzie nie tak

| Objaw | Co zrobić |
|-------|-----------|
| `sudo: polecenie nie znalezione` albo „Uruchom przez sudo” | Dopisz `sudo` na początku komendy. |
| Usługa `failed` / restartuje się | `journalctl -u acer-nitro-perfect-fan.service -n 50 --no-pager` oraz `./check-system.sh`. |
| GUI pokazuje OFFLINE | Zostaw otwarty terminal z `npm start` i przeczytaj czerwone linie. Najczęściej: nie było `npm install`. |
| Wentylatory ignorują suwaki | `systemctl status acer-nitro-perfect-fan.service`. Drugi program (NitroSense, inne NBFC) nie może pisać do EC w tym samym czasie. |
| Wentylatory „skaczą” | Dwa kontrolery naraz. Zostaw **jeden**: albo ten daemon, albo samo NBFC. |
| Laptop za głośny / za gorący | Przycisk **PRZYWRÓĆ AUTO** w GUI albo komenda poniżej. |
| Zły model / `unsupported model` | Skopiuj wynik `./check-system.sh` i otwórz zgłoszenie. Nie dokładaj modelu „na ślepo”. |

Natychmiast oddaj sterowanie płycie (firmware auto):

```bash
./restore-auto.sh
```

Albo zatrzymaj usługę:

```bash
sudo systemctl stop acer-nitro-perfect-fan.service
```

---

## 11. Odinstalowanie

```bash
cd ~/Acer-Nitro-Perfect-Fan
sudo ./uninstall.sh
```

To wyłącza usługę, przywraca auto EC i kasuje pliki z `/usr/local` oraz `/etc/nitro-fan`. **Folder projektu zostaje.** Żeby posprzątać resztę:

```bash
rm -rf gui-app/node_modules
```

Sam katalog projektu (`Acer-Nitro-Perfect-Fan` albo stary `acer-fancontrol`) usuwasz dopiero gdy jesteś pewien.

---

## 12. Aktualizacja daemona (gdy ściągniesz nowszą wersję plików)

```bash
cd ~/Acer-Nitro-Perfect-Fan
sudo ./update-daemon.sh
```

Nie rusza Twojego `/etc/nitro-fan/config.json`.

---

Nie ruszaj plików w `/sys` ani rejestrów płyty ręcznie. Program ma do tego sterownik albo NBFC — omijanie tego może uszkodzić sprzęt.
