# Jak pomóc w dodaniu wsparcia dla Twojego modelu (Linux)

Jeśli Twój laptop (np. nowsze modele Acer Nitro z zablokowanym odczytem wentylatorów z poziomu EC) nie jest jeszcze w pełni wspierany przez **Acer Nitro Perfect Fan**, możesz pomóc nam rozpracować sposób, w jaki fabryczny system zarządza chłodzeniem.

Wszystkie potrzebne do tego informacje ukryte są w oprogramowaniu układowym Twojej płyty głównej (tabele ACPI). Nowsze modele posiadają zablokowany bezpośredni zapis prędkości wentylatorów i aby to obejść, korzystają z tzw. metod ACPI-WMI. Rozszyfrujemy je, analizując pliki z Twojego laptopa.

> [!NOTE]
> **Czy to jest bezpieczne i czy udostępniam prywatne dane?**
> **Tak, to w pełni bezpieczne!** Pliki generowane w poniższych krokach (zrzuty pamięci ACPI) to czysty kod wygenerowany przez producenta sprzętu (Acer). Nie zawierają one żadnych Twoich plików osobistych, haseł, nazw użytkownika czy nawet unikalnych numerów seryjnych urządzenia. Typowo zawierają tylko definicje urządzeń systemowych, portów czy logikę chłodzenia. Możesz je całkowicie bezpiecznie i publicznie wrzucić do Issue na GitHubie.

---

## Krok 1: Pobranie zrzutu tabel ACPI

1. Zainstaluj pakiet narzędzi ACPI dla swojego systemu:
   * **Ubuntu / Debian / Linux Mint:** `sudo apt update && sudo apt install -y acpica-tools`
   * **Arch Linux / Manjaro:** `sudo pacman -S acpica`
   * **Fedora:** `sudo dnf install acpica-tools`

2. Skopiuj poniższy pojedynczy blok komend i wklej go do terminala (w całości). Skrypt automatycznie stworzy folder, pobierze pliki, zdekoduje je i spakuje dla Ciebie:

   ```bash
   mkdir -p ~/acpi_dump && cd ~/acpi_dump && sudo acpidump -b && iasl -d *.dat && zip -r ~/acpi_dump_moj_model.zip ~/acpi_dump && echo "GOTOWE! Plik acpi_dump_moj_model.zip został utworzony w Twoim katalogu domowym."
   ```

3. To wszystko! W Twoim głównym folderze (`/home/twój_użytkownik/`) znajdziesz gotowy plik `acpi_dump_moj_model.zip`.

---

## Krok 2: Przesłanie plików do nas

Mając spakowane pliki z Kroku 1:

1. Przejdź na naszą stronę projektu na serwisie **GitHub** i wejdź w zakładkę **Issues**.
2. Kliknij przycisk **New Issue**.
3. Jako tytuł wpisz np.: `Zrzut ACPI dla modelu [Twój dokładny model, np. ANV15-51]`.
4. Przeciągnij i upuść plik `acpi_dump_moj_model.zip` ze swojego głównego katalogu domowego (`/home/twój_użytkownik/`) do pola tekstowego, aby go załączyć.

Dzięki temu jednemu archiwum `.zip` będziemy w stanie rozpracować metody ACPI przypisane do obrotów wentylatorów na Twoim sprzęcie i zaprojektować poprawkę do programu!

---

<a href="https://www.buymeacoffee.com/Kaspral" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

*Pamiętaj, że gdy piję kawę, praca dzieje się szybciej!* ☕
