# Kompatybilne modele laptopów

## Obsługiwane przez dołączony sterownik `acer-nitro-ec`

Te modele korzystają z mapy EC obsługiwanej przez dołączony sterownik jądra:

- Acer Nitro 5 AN515-44
- Acer Nitro 5 AN515-46
- Acer Nitro 5 AN515-54 — w pełni przetestowany
- Acer Nitro 5 AN515-56
- Acer Nitro 5 AN515-57
- Acer Nitro 5 AN515-58
- Acer Nitro 5 AN517-55

Sterowanie wentylatorami odbywa się przez `acer_nitro_ec` i interfejs hwmon
Linuksa. AN515-54 to jedyny model w pełni przetestowany przez opiekuna projektu.

## Modele eksperymentalne z opcjonalną poprawką sterownika

Repozytorium może dodać do sterownika DMI tych modeli przez
`acer-nitro-ec/dmi-models.patch`:

- Acer Nitro 5 AN515-51
- Acer Nitro 5 AN515-55
- Acer Nitro 5 AN517-51
- Acer Nitro 5 AN517-54

Modele te nie są w pełni zweryfikowane. Poprawkę stosuj tylko wtedy, gdy możesz
bezpiecznie przetestować sterowanie wentylatorami na konkretnym laptopie.

## Modele sterowane przez NBFC

Program może także używać `nbfc-linux` jako backendu sterowania wentylatorami.
W tym trybie kompatybilność zależy od profilu NBFC zainstalowanego w systemie,
a nie od tego repozytorium. Obejmuje to inne modele Acer Nitro, Acer Predator,
Acer Helios, Nitro V oraz laptopy innych firm, jeśli `nbfc-linux` ma działający
profil dla dokładnego modelu.

Listę profili dostępnych w systemie sprawdzisz poleceniem:

```bash
nbfc config -l
```

Użyj profilu dokładnie pasującego do nazwy modelu/DMI laptopa. Dołączonego
profilu `nbfc/Acer Nitro AN515-54.json` nie wolno używać na innym modelu.

Aby użyć profilu NBFC:

```bash
sudo ./nbfc/install-nbfc-config.sh
sudo systemctl enable --now nbfc_service
```

Następnie ustaw `"backend": "nbfc"` w `/etc/nitro-fan/config.json`. Nie uruchamiaj
jednocześnie dwóch programów sterujących tym samym EC.

### Pełna lista profili NBFC

Pełna lista nazw modeli wykrytych poleceniem `nbfc config -l` znajduje się w
[angielskiej wersji tego pliku](COMPATIBLE-MODELS.md). Nazwy laptopów są nazwami
własnymi profili NBFC i pozostają niezmienione w obu wersjach językowych.

## Nieobsługiwane

- Windows i macOS
- Komputery stacjonarne
- Laptopy bez przetestowanej mapy `acer-nitro-ec` albo działającego profilu
  `nbfc-linux`
