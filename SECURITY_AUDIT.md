# Raport Audytu Bezpieczeństwa — Acer Nitro Perfect Fan

**Data audytu:** Marzec 2026
**Aplikacja:** Acer Nitro Perfect Fan
**Wersja:** 1.1.0
**Status audytu:** Zakończony (Pozytywny z zaleceniami usprawnień)

---

## 1. Podsumowanie Wykonawcze (Executive Summary)

Przeprowadzono kompleksowy audyt bezpieczeństwa projektu **Acer Nitro Perfect Fan** (zarówno modułu daemona systemd, mostka Python stdio/IPC, jak i interfejsu GUI opartego na Electronie oraz reguł udev i skryptów instalacyjnych).

Głównym celem programu jest sterowanie wentylatorami i podświetleniem klawiatury w laptopach Acer Nitro 5 z wykorzystaniem sterownika jądra `acer-nitro-ec` (hwmon) lub alternatywnie `nbfc-linux`.

### Główny wniosek
Projekt prezentuje **bardzo wysoki poziom bezpieczeństwa** i jest wzorcowo zaprojektowany pod kątem zasady najmniejszych uprawnień (Least Privilege):
- Daemon systemd **nie działa jako root**, lecz jako wyizolowany użytkownik systemowy `acer_nitro_perfect_fan`.
- Wykorzystano reguły udev do nadania wąskich uprawnień do plików `pwm1` / `pwm2` w `/sys` dla grupy usługi, bez konieczności nadawania usłudze uprawnień root.
- Interfejs GUI (Electron) działa całkowicie w przestrzeni użytkownika, komunikując się z backendem Python poprzez bezpieczne strumienie `stdio` (JSON-RPC / stdio IPC).
- Interfejs Electron używa `contextIsolation: true`, `nodeIntegration: false` oraz waliduje otwierane linki zewnętrzne za pomocą rygorystycznej białej listy (`Set`).
- Wywołania zewnętrznych poleceń systemowych (`nvidia-smi`, `sensors`, `lspci`) w Pythonie używają wyłącznie bezpiecznych list argumentów (bez `shell=True`), wykluczając podatności typu Command Injection.

Zidentyfikowano **jedną drobną podatność o niskim/średnim priorytecie** dotyczącą zbyt szerokich uprawnień dla atrybutów podświetlenia klawiatury w regule udev oraz zgłoszono kilka uwag informacyjnych i dobrych praktyk.

---

## 2. Zakres Audytu (Audit Scope)

Audytem objęto następujące pliki i komponenty repozytorium:

1. **Skrypty systemowe i konfiguracja usługi systemd:**
   - `acer-nitro-perfect-fan.service` (jednostka systemd)
   - `99-acer-nitro-ec.rules` (reguły udev)
   - `install.sh`, `uninstall.sh`, `restore-auto.sh`, `check-system.sh`

2. **Backend Python i mostek komunikacyjny:**
   - `nitro_fan_daemon.py` (daemon sterujący)
   - `fan_backend.py` (warstwa abstrakcji I/O hwmon / NBFC)
   - `nbfc_control_api.py` (mostek stdio JSON IPC dla GUI)
   - `nitro_log_summary.py` (analizator logów telemetrycznych)

3. **Aplikacja Electron (GUI):**
   - `gui-app/main.js` (proces główny Electron)
   - `gui-app/preload.js` (mostek kontekstowy IPC)
   - `gui-app/package.json` (zależności i konfiguracja skrótów/budowania)

---

## 3. Zidentyfikowane Podatności i Uwag (Findings & Vulnerabilities)

### Tabela Podsumowująca

| ID | Poziom Zagrożenia | Komponent | Opis Krótki | Status |
|---|---|---|---|---|
| ANP-SEC-01 | **Średnie / Niskie** | `99-acer-nitro-ec.rules` | World-writable (`0666`) na atrybutach sysfs klawiatury | Zalecana poprawka |
| ANP-SEC-02 | **Niskie** | `/etc/nitro-fan/config.json` | Dostęp do zapisu pliku konfiguracyjnego dla grupy użytkownika | Akceptowalne / Informacyjne |
| ANP-SEC-03 | **Informacyjne** | `gui-app/main.js` & `preload.js` | Bezpieczna izolacja IPC i brak powłoki shell w Electronie | Pozytywne (Dobra Praktyka) |
| ANP-SEC-04 | **Informacyjne** | `nbfc_control_api.py` / `fan_backend.py` | Brak podatności Command Injection przy wywołaniach `subprocess` | Pozytywne (Dobra Praktyka) |
| ANP-SEC-05 | **Informacyjne** | `acer-nitro-perfect-fan.service` | Utwardzenie usługi systemd oraz mechanizm awaryjny `ExecStopPost` | Pozytywne (Dobra Praktyka) |

---

### Szczegółowy Opis Zidentyfikowanych Kwestii

#### ANP-SEC-01: Zbyt szerokie uprawnienia (World-Writable 0666) dla atrybutów podświetlenia klawiatury
- **Poziom zagrożenia:** Średnie / Niskie (Medium / Low)
- **Komponent:** `99-acer-nitro-ec.rules`
- **Lokalizacja kodu:**
  ```udev
  ACTION=="add", SUBSYSTEM=="platform", KERNEL=="acer-nitro-ec", \
      RUN+="/bin/sh -c 'chmod 0666 /sys/devices/platform/acer-nitro-ec/kbd_backlight /sys/devices/platform/acer-nitro-ec/kbd_timeout 2>/dev/null || true'"
  ```
- **Opis:**
  Reguła udev nadaje uprawnienia odczytu i zapisu dla wszystkich użytkowników w systemie (`0666`) na plikach `/sys/devices/platform/acer-nitro-ec/kbd_backlight` oraz `kbd_timeout`. Oznacza to, że dowolny lokalny nieuprawniony użytkownik lub złośliwy proces działający na koncie innego użytkownika może zmieniać jasność i timeout podświetlenia klawiatury.
- **Wpływ:**
  Podatność nie pozwala na eskalację uprawnień do konta root, ale narusza zasadę najmniejszych uprawnień.
- **Rekomendacja:**
  Zmienić regułę udev, aby przypisywała grupę `acer_nitro_perfect_fan` (lub grupę zalogowanego użytkownika) i nadawała uprawnienia `0664` zamiast `0666`:
  ```udev
  ACTION=="add", SUBSYSTEM=="platform", KERNEL=="acer-nitro-ec", \
      RUN+="/bin/sh -c 'chgrp acer_nitro_perfect_fan /sys/devices/platform/acer-nitro-ec/kbd_backlight /sys/devices/platform/acer-nitro-ec/kbd_timeout 2>/dev/null && chmod g+w /sys/devices/platform/acer-nitro-ec/kbd_backlight /sys/devices/platform/acer-nitro-ec/kbd_timeout 2>/dev/null || true'"
  ```

---

#### ANP-SEC-02: Dostęp do zapisu pliku `/etc/nitro-fan/config.json` dla grupy użytkownika
- **Poziom zagrożenia:** Niskie (Low) / Informacyjne
- **Komponent:** `install.sh` / `nitro_fan_daemon.py`
- **Opis:**
  Skrypt instalacyjny tworzy katalog `/etc/nitro-fan` oraz plik `config.json` z prawami `775` / `664` należącymi do grupy zalogowanego użytkownika (`$GROUP`). Umożliwia to dashboardowi Electron (działającemu bez roota) bezśredni zapis zmian konfiguracji (krzywe, tryb, offset prędkości).
- **Wpływ:**
  Złośliwy proces działający na koncie tego samego użytkownika może edytować `config.json`.
- **Ocena Ryzyka & Mitygacja:**
  Daemon `nitro_fan_daemon.py` wczytuje plik i stosuje rygorystyczne filtrowanie i zaciskanie zakrokowego (clamping):
  - Minimalna prędkość wentylatora CPU jest twardo ograniczona do `30%` (`MIN_PCT_CPU = 30`), co zapobiega wyłączeniu wentylatora CPU i przegrzaniu procesora.
  - Wszystkie punkty krzywych są walidowane i porządkowane.
  - Przy braku ważnego odczytu temperatury daemon przechodzi w bezpieczny tryb awaryjny (`FALLBACK_PCT = 70%`).
  Architektura jest więc dobrze zabezpieczona przed złośliwą modyfikacją parametrów w pliku JSON.

---

#### ANP-SEC-03: Bezpieczeństwo interfejsu Electron (GUI IPC & Izolacja Kontekstu)
- **Poziom zagrożenia:** Informacyjne (Dobra Praktyka)
- **Komponent:** `gui-app/main.js`, `gui-app/preload.js`
- **Analiza:**
  - `contextIsolation: true` oraz `nodeIntegration: false` zabezpieczają renderer przed bezpośrednim dostępem do Node.js.
  - Funkcja `openExternal` waliduje docelowy URL względem sztywnej białej listy (`EXTERNAL_URLS`), zapobiegając otwieraniu niebezpiecznych adresów URI lub lokalnych skryptów executable przez shell Electrona.
  - Skrypt Python jest uruchamiany bezpośrednio przy użyciu `spawn('python3', [pythonScriptPath])` bez powłoki systemowej (`shell: false`).

---

#### ANP-SEC-04: Bezpieczne wywołania Subprocess w Pythonie
- **Poziom zagrożenia:** Informacyjne (Dobra Praktyka)
- **Komponent:** `nbfc_control_api.py`, `fan_backend.py`
- **Analiza:**
  - Wszystkie interakcje ze stosem systemowym (wywołania `sensors`, `nvidia-smi`, `lspci`) realizowane są przy użyciu `subprocess.run(cmd, capture_output=True, text=True, check=True)` gdzie `cmd` jest tablicą ciągów znaków (listą argumentów).
  - Żadne polecenie nie używa flagi `shell=True`, a dane wejściowe przekazywane przez stdio JSON z Electrona nie są doklejane do poleceń powłoki. Wyklucza to podatności z rodziny Command Injection.

---

#### ANP-SEC-05: Hardening usługi systemd i ochrona sprzętowa
- **Poziom zagrożenia:** Informacyjne (Dobra Praktyka)
- **Komponent:** `acer-nitro-perfect-fan.service`, `restore-auto.sh`
- **Analiza:**
  - Usługa systemd definiuje dyrektywy utwardzające: `ProtectSystem=full`, `ProtectHome=yes`, `PrivateTmp=yes`, `NoNewPrivileges=yes`.
  - Usługa uruchamiana jest na dedykowanym koncie systemowym `User=acer_nitro_perfect_fan`, a nie jako root.
  - W dyrektywie `ExecStopPost` wykorzystano skrypt `restore-auto.sh` z prefiksem `+` (uprawnienia roota), co gwarantuje, że w przypadku zatrzymania, awarii lub ubicia daemona sygnałem `SIGKILL`, wiatraki zostaną natychmiast przywrócone do automatycznego sterowania przez firmware EC.

---

## 4. Analiza Wektorów Ataku (Attack Vectors)

1. **Lokalny nieuprawniony użytkownik (Multi-user system):**
   - *Wektor:* Zapis do `/sys/devices/platform/acer-nitro-ec/kbd_backlight` z powodu praw `0666`.
   - *Skutek:* Możliwość zmiany poziomu podświetlenia klawiatury bez uprawnień root. Brak możliwości wykonania kodu ani eskalacji uprawnień.
   - *Mitygacja:* Zmiana chmod na `0664` z przypisaniem grupy usługi (zgodnie z ANP-SEC-01).

2. **Modyfikacja komend przez Stdio IPC (Electron <-> Python):**
   - *Wektor:* Przesyłanie złośliwych komunikatów JSON na standardowe wejście `nbfc_control_api.py`.
   - *Skutek:* Wszystkie komendy IPC (`set_fan_speed`, `set_curve`, `apply_profile`, `set_speed_offset`) są walidowane i sprowadzane do dopuszczalnych zakresów numerycznych (clamping / minimum 30% CPU / ograniczenia zakrokowo -50..+50).
   - *Mitygacja:* Walidacja wejścia jest w pełni skuteczna.

3. **Uszkodzenie termiczne sprzętu przez złe krzywe wentylatorów:**
   - *Wektor:* Ustawienie w konfiguracji prędkości wentylatora na 0%.
   - *Skutek:* Daemon twardo wymusza podłogę 30% dla CPU, a w przypadku wykrycia temperatury krytycznej (>=88°C) wymusza 100% PWM.
   - *Mitygacja:* Zabezpieczenie sprzętowe w kodzie daemona zapobiega uszkodzeniu procesora.

---

## 5. Rekomendacje Naprawcze (Actionable Recommendations)

1. **Poprawka w `99-acer-nitro-ec.rules`:**
   Zamienić uprawnienia `0666` dla podświetlenia klawiatury na `0664` z dedykowaną grupą `acer_nitro_perfect_fan`.
2. **Utrzymanie dotychczasowych zasad bezpieczeństwa:**
   Zaleca się zachowanie w przyszłych wersjach projektu obecnej architektury z podziałem na nieuprzywilejowany daemon, wyizolowany proces Electron z walidacją IPC oraz brak użycia `shell=True` w wywołaniach systemowych.

---

*Raport sporządzono na podstawie analizy kodu źródłowego repozytorium Acer Nitro Perfect Fan.*
