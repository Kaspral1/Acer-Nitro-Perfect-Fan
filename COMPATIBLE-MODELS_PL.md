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

Drzewo źródłowe zawiera opcjonalną poprawkę dodającą do sterownika DMI tych
modeli: `acer-nitro-ec/dmi-models.patch`.

- Acer Nitro 5 AN515-51
- Acer Nitro 5 AN515-55
- Acer Nitro 5 AN517-51
- Acer Nitro 5 AN517-54

Modele te nie są w pełni zweryfikowane i nie są włączone w standardowym
instalatorze. Zastosowanie poprawki wymaga ręcznego przebudowania sterownika i
bezpiecznego przetestowania sterowania wentylatorami na konkretnym laptopie.

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

Poniżej znajduje się pełna lista nazw modeli z zestawu profili `nbfc-linux`.
Profile mogą sterować danym laptopem tylko wtedy, gdy pasują do jego dokładnej
wersji sprzętowej i działają poprawnie.

#### ASUS

```text
ASUS VivoBook X505ZA_X505ZA
ASUS Vivobook S15-5506MA
ASUS Vivobook X580VD
ASUSTeK COMPUTER INC. X551CA
Asus F5SR
Asus G53SX
Asus K43SD
Asus K43U
Asus K46C
Asus K501LX
Asus K501UX
Asus M52VA
Asus N550JV
Asus N550JX
Asus N551JB
Asus N56JR
Asus N56VZ
Asus ROG G501JW
Asus ROG G751JL
Asus ROG G751JT
Asus ROG G751JY
Asus ROG G752VS
Asus ROG G752VT
Asus ROG G752VY
Asus ROG G75VX
Asus ROG GL702VM
Asus ROG GL702ZC
Asus TP301UJ
Asus Transformer 3 Pro
Asus Vivobook R540U
Asus Vivobook S15 K3502
Asus Vivobook S400CA
Asus Vivobook TP301UA
Asus X301A1
Asus X540LA
Asus X756UX
Asus Zenbook Flip UX360UAK
Asus Zenbook Pro UX550VD
Asus Zenbook Pro UX550VE
Asus Zenbook UX21E
Asus Zenbook UX301LA
Asus Zenbook UX302LA
Asus Zenbook UX310UA
Asus Zenbook UX310UAK
Asus Zenbook UX31A
Asus Zenbook UX32A
Asus Zenbook UX32LN
Asus Zenbook UX32VD
Asus Zenbook UX330UA
Asus Zenbook UX391U
Asus Zenbook UX410UQ
Asus Zenbook UX430UA
Asus Zenbook UX430UQ
Asus Zenbook UX51VZA
Asus Zenbook UX530U
```

#### Acer

```text
Acer Aspire 1410
Acer Aspire 1810T
Acer Aspire 1810TZ
Acer Aspire 1825PTZ
Acer Aspire 4750G
Acer Aspire 5738G
Acer Aspire 5745G
Acer Aspire 5749
Acer Aspire 5930
Acer Aspire 7551G
Acer Aspire 7735
Acer Aspire 7740G
Acer Aspire 7741G
Acer Aspire A315-57G-74A3
Acer Aspire A515-48M
Acer Aspire A715-41G
Acer Aspire E1-522
Acer Aspire E1-570G
Acer Aspire E1-572G
Acer Aspire E1-772
Acer Aspire E5-471G
Acer Aspire E5-475G
Acer Aspire E5-575G
Acer Aspire E5-731
Acer Aspire ES1-711
Acer Aspire LT-10Q
Acer Aspire One AO531h
Acer Aspire One AO721
Acer Aspire One AO751h
Acer Aspire One AOA110
Acer Aspire One AOA150
Acer Aspire S3
Acer Aspire S7-191
Acer Aspire S7-391
Acer Aspire V13
Acer Aspire V3-371
Acer Aspire V3-571G
Acer Aspire V5-472PG
Acer Aspire V5-551
Acer Aspire V5-572G
Acer Aspire VN7-572G V15 Nitro
Acer Aspire VN7-572G V15 Nitro BE
Acer Aspire VN7-591G V15 Nitro BE
Acer Aspire VN7-593G V15 Nitro BE
Acer Aspire VN7-791G V17 Nitro BE
Acer Aspire VN7-792G V17 Nitro BE
Acer Aspire VN7-793G V17 Nitro BE
Acer Extensa 5220
Acer Extensa 5630Z
Acer LT-10Q
Acer NC-A315-55G-73N7
Acer Nitro AN515-42
Acer Nitro AN515-43
Acer Nitro AN515-45
Acer Nitro AN515-47
Acer Nitro AN715-51
Acer Nitro V15-41
Acer Predator 17 G9-793-782K
Acer Predator G3-572
Acer Predator PH315-52
Acer Predator PH315-53
Acer Predator PH315-54
Acer Swift SF314-54G
Acer Swift SFX14-41G
Acer TravelMate 7730G
Acer TravelMate P253
```

#### Alienware, Dell, Fujitsu i GPD

```text
Alienware m15 R3
Dell Inspiron 7348
Dell Inspiron 7375
Dell Vostro 3350
Dell XPS M1530
Fujitsu ESPRIMO Mobile V5505
GPD G1617-01
GPD Pocket 4
GPD Win 2 (8100y)
```

#### Gateway, Gigabyte i Colorful

```text
Gateway AOA110
Gateway AOA150
Gateway LT31
Gigabyte AERO 14KV8
Gigabyte Aero15x v8
Gigabyte Aero16
Gigabyte p35w v3
Colorful X15 AT 22
```

#### HP

```text
HP 15 Notebook PC
HP 15-BW00x
HP 245 G7 Notebook PC
HP 620
HP Compaq 15-s103tx
HP Compaq 615
HP Compaq 625
HP Compaq 6530b
HP Compaq 6735s Turion X2 RM-72
HP Compaq 8710p
HP Compaq Presario CQ40 Turion X2 RM-74
HP Compaq nw9440
HP ENVY dv6-7xxx
HP ENVY dv7-7xxx
HP ENVY m6 1206dx
HP ENVY m6 Sleekbook
HP ENVY m6-1254eo
HP ENVY x360 15-w104ne
HP ENVY x360 Convertible 13-ag0xxx
HP ENVY x360 Convertible 15-bq1xx
HP ENVY x360 Convertible 15-cn0xxx
HP EliteBook 2560p
HP EliteBook 2570p
HP EliteBook 2760p
HP EliteBook 745 G5
HP EliteBook 830 G6
HP EliteBook 840 G2
HP EliteBook 8470p
HP EliteBook 850 G3
HP EliteBook 850 G5
HP EliteBook 8560p
HP EliteBook 8560w
HP EliteBook 8760w
HP EliteBook Folio 1040 G1
HP EliteBook Folio 9470m
HP EliteBook Folio 9470m_i5-3427u_bios-F.66
HP Laptop 14-cm0xxx
HP Laptop 14-dk0xxx
HP Laptop 15s-eq2xxx
HP Laptop 15s-eq3xxx
HP Laptop 15s-fq5xxx
HP Laptop 15s-gr0xxx
HP Laptop 17-bs0xx
HP Laptop 17-by1xxx
HP Laptop 17-ca1xxx
HP Notebook 15-ac1xxx
HP Notebook 15-ba010ng
HP OMEN Laptop 15-en0xxx
HP OMEN Notebook PC 15
HP Omen 15-dc00xxxx
HP Omen 16 n0xxx
HP Pavilion 14-v066br
HP Pavilion 17 Notebook PC
HP Pavilion 17-ab240nd
HP Pavilion Gaming Laptop 15-dk0xxx
HP Pavilion Gaming Laptop 15-ec0xxx
HP Pavilion Gaming Laptop 15-ec1xxx
HP Pavilion Gaming Laptop 15-ec2xxx
HP Pavilion HDX18
HP Pavilion dk15
HP Pavilion dv6
HP Pavilion dv6 6190
HP Pavilion x360 Convertible 14-dh1xxx
HP Pavilion x360 Convertible 15-br0xx
HP ProBook 430 G1
HP ProBook 440 G3
HP ProBook 450 G1
HP ProBook 450 G2
HP ProBook 4520s
HP ProBook 4530s
HP ProBook 4535s
HP ProBook 4540s
HP ProBook 4710s
HP ProBook 4720s
HP ProBook 5320m
HP ProBook 5330m
HP ProBook 640 G1
HP ProBook 6455b
HP ProBook 6460b
HP ProBook 6465b
HP ProBook 650 G1
HP ProBook 650 G2
HP ProBook 6550b
HP ProBook 6560b
HP Spectre x360 Convertible 13-ae0xx
HP Spectre x360 Convertible 14-ea0xxx
HP Spectre x360 Convertible 15-ch0xx
HP Spectre x360 Convertible 15-df1015ng
HP Spectre x360 Convertible 15t-df1xx
HP Victus 15-fb0xxx
HP Victus 16-e0175AX
HP Victus 16-e0xxx
HP ZBook 15
HP ZBook 15 G3
HP ZBook 17 G2
HP ZBook Fury 15 G7
HP ZBook Studio G3
HP ZBook Studio x360 G5
```

#### Lenovo

```text
Lenovo IdeaPad Y580
Lenovo Ideacenter AIO 700-24AGR
Lenovo Ideapad 3 15IAU7
Lenovo Ideapad 500S-13ISK
Lenovo Ideapad 500S-14ISK
Lenovo Ideapad 510s
Lenovo Ideapad 710S
Lenovo Ideapad U160
Lenovo Ideapad U330p
Lenovo Ideapad U430p
Lenovo ThinkPad 13
Lenovo ThinkPad Edge E520
Lenovo ThinkPad Helix
Lenovo ThinkPad L380 Yoga
Lenovo ThinkPad L390 i7-8565U
Lenovo ThinkPad T14 Gen2
Lenovo ThinkPad T430s
Lenovo ThinkPad T440s
Lenovo ThinkPad T490
Lenovo ThinkPad T540p
Lenovo ThinkPad T580
Lenovo ThinkPad X1 8th gen
Lenovo ThinkPad x121e
Lenovo ThinkPad x220i
Lenovo ThinkPad x230
Lenovo Thinkpad L13
Lenovo Thinkpad L530
Lenovo Thinkpad L540
Lenovo U31-70
Lenovo U41-70
Lenovo V330-IKB(81AX)
Lenovo V580
Lenovo Yoga 11s
Lenovo Yoga 13 2191
Lenovo Yoga 2 13
Lenovo Yoga 3 14
Lenovo Yoga 500-15IBD
Lenovo Yoga 510
Lenovo Yoga 710
Lenovo Yoga 710 KabyLake
Lenovo Yoga Slim7
```

#### Pozostali producenci

```text
MECHREVO Jiaolong Series GK5NR0O
METAPHYUNI MetawillBook 02
MSI Bravo 17 C7VFKP
Medion Akoya P6612
Medion Akoya P6630
Packard Bell AOA110
Packard Bell AOA150
Packard Bell DOA150
Packard Bell DOTMA
Packard Bell DOTMU
Packard Bell DOTVR46
Packard Bell ENBFT
Packard Bell EasyNote TK85
Packard Bell Easynote TJ65
Razer Blade 14 2017
RedmiBook 14 (TM1814)
Sony Corporation VGN-CR392_W
Sony VAIO SVF15N1C5E
Sony Vaio SVE1711
Sony Vaio SVE1713Y1E
Sony Vaio SVF13N190X
Sony Vaio SVF14N1C5E
Sony Vaio SVT1312M1ES
Sony Vaio VPCF12S1E
Toshiba Satellite L740
Toshiba Satellite L745
Vestel Smartboard Series-14XXXX
Wortmann AG TERRA MOBILE 1771
Xiaomi Mi Book (TM1613, TM1703)
```

## Nieobsługiwane

- Windows i macOS
- Komputery stacjonarne
- Laptopy bez przetestowanej mapy `acer-nitro-ec` albo działającego profilu
  `nbfc-linux`
