# Voynich — korelacja obraz ↔ tekst

Eksperyment: czy sposób, w jaki strona manuskryptu **wygląda**, wiąże się z tym, jaki
**tekst** (EVA) na niej występuje — *ponad* to, co już tłumaczy przynależność do sekcji.

Pomysł: każda strona → wektor cech wizualnych (z Qwen3-VL) + zbiór jednostek tekstu (z
transliteracji ZL). Potem test asocjacji każdej pary (cecha wizualna × jednostka tekstu)
**wewnątrz sekcji**, z korektą na wielokrotne testowanie i nullem permutacyjnym.

---

## Pipeline (kolejność)

| krok | skrypt | wynik |
|---|---|---|
| 1. obrazy | `download.ts` | `../iiif/<folio>.jpg` + `folio_map.json` (nazwa pliku = folio) |
| 2. anotacja | `annotate.ts` | `out/<folio>.json` = `{folio, section, icode, currier, quire, features, keywords}` |
| 3. podgląd promptów | `probe.ts` | surowy zwrot modelu dla dowolnego promptu |
| 4. reset keywords | `reset-keywords.ts` | usuwa pole `keywords` (do iteracji nad promptem) |
| 5. tekst | `zl.ts` | parser ZL: per-folio `$I/$C/$Q` + EVA, rozbite na typy locusów |
| 6. korelacja | `correlate.ts` | tabela asocjacji + FDR + permutacja |

Źródła danych: `../iiif/` (obrazy Beinecke IIIF), `../ivtff/ZL3b-n.txt` (transliteracja
Zandbergen-Landini), serwer Qwen na `ws://localhost:8787` (model `qwen3-vl-8b`).

---

## Jak uruchamiać `correlate.ts`

```bash
bun run correlate.ts                                  # herbal, cechy strukturalne, słowa
bun run correlate.ts --section=all --perm=500         # wszystkie sekcje
bun run correlate.ts --section=biological --unit=char3 --perm=500
bun run correlate.ts --vf=keywords --unit=char3 --minDF=3 --minVF=3
bun run correlate.ts --loctype=L --unit=char3 --minDF=3   # tylko etykiety
```

### Flagi

| flaga | wartości | domyślnie | znaczenie |
|---|---|---|---|
| `--section` | nazwa \| `all` | `herbal` | która sekcja (lub wszystkie) |
| `--vf` | `features` \| `keywords` \| `both` | `features` | źródło cech wizualnych |
| `--unit` | `word` \| `char2` \| `char3` \| `char4` | `word` | jednostka tekstu |
| `--loctype` | `all` \| `P` \| `L` \| `R` \| `C` | `all` | typ locusu (P=paragraf, L=etykieta, R=promienisty, C=kołowy) |
| `--minDF` | liczba | `5` | token musi być na ≥N foliach |
| `--maxDF` | ułamek | `0.7` | …i na ≤ tym % folii (odsiewa wszechobecne) |
| `--minVF` | liczba | `4` | cecha obecna na ≥N foliach (i nie na wszystkich) |
| `--q` | ułamek | `0.1` | próg FDR uznania za „trafienie" |
| `--top` | liczba | `30` | ile wierszy wypisać |
| `--perm` | liczba | `200` | ile permutacji nullu (0 = pomiń) |

---

## ⭐ Jak czytać wyniki

Nagłówek:
```
######## herbal  (vf=features loctype=all unit=word) ########
folios=121  features=24  tokens=297  pairs=7128
```
- **folios** — ile stron weszło do testu (anotacja ⋈ tekst). Mała liczba = mała moc.
- **features** — ile cech wizualnych przeszło `minVF`.
- **tokens** — ile jednostek tekstu przeszło `minDF/maxDF`. **To jest „rozdzielczość" tekstu.**
  Jak tokens=1, to słowa są zbyt unikalne → użyj `--unit=char3`.
- **pairs** — `features × tokens` = liczba testów. Im więcej, tym ostrzejszy próg FDR.

Tabela (jeden wiersz = jedna para cecha×token), posortowana po `p` rosnąco:

```
vf                     token     a/exp        phi    p          q
has_container          lo$       4/0.5        0.49   2.75e-4    1.000
```

| kolumna | co to | jak patrzeć |
|---|---|---|
| **vf** | cecha wizualna | `palette:green`, `leaf_shape:serrated`, `has_tubes`, `kw:vase` (z keywords) |
| **token** | jednostka tekstu | słowo EVA (`daiin`) albo n-gram (`lo$` = sufiks „lo", `^qo` = prefiks „qo") |
| **a/exp** | obserwowane / oczekiwane współwystąpienia | `a` = na ilu foliach są OBA; `exp` = ile byłoby przy niezależności. `a≫exp` → przyciągają się, `a≪exp` → odpychają |
| **phi (φ)** | siła i znak | korelacja dwóch zmiennych 0/1. +1 razem, −1 osobno, 0 nic. \|φ\|>0.3 to „dużo", ale patrz na `q`! |
| **p** | Fisher exact (dwustronny) | szansa zobaczenia tak skrajnej tablicy *przy braku związku*. Surowe, NIESKORYGOWANE |
| **q** | BH-FDR | **to jest właściwy werdykt.** Oczekiwany % fałszywek wśród trafień ≤ tego q |

### Co jest realnym trafieniem (a co nie)

Para jest warta uwagi **tylko gdy oba**:

1. **`q ≤ 0.1`** (nie samo `p`!). Surowe `p<0.05` przy 7000 testach daje ~350 fałszywek —
   dlatego patrzysz na `q`. Jeśli wszędzie `q=1.000`, **nic nie przeżyło** — koniec tematu.
2. **`P(null ≥ observed)` małe** (np. <0.05). To linijka na końcu:
   ```
   hits at q<=0.1: 0
   permutation null (500): mean hits=0.0, P(null ≥ observed 0) = 1.000
   ```
   - `hits at q<=0.1` — ile par przeszło FDR.
   - `mean hits` — ile trafień wychodzi średnio, gdy **przetasujemy** przypisanie cech do
     folii (czyli gdy z definicji NIE ma związku). Powinno być ~0.
   - `P(null ≥ observed)` — empiryczne p dla pytania „czy łączna liczba trafień bije
     przypadek". Małe = sygnał; ~1.0 = szum.

**Złota zasada:** wysokie φ przy `q=1.000` to **nie odkrycie**, tylko najładniejszy szum na
górze listy. Zawsze najpierw `q`, potem permutacja.

### Znak φ i interpretacja

- φ > 0: strony z cechą F **częściej** mają token W (np. `has_tubes ↔ "lok"` → strony z
  rurkami częściej używają sekwencji „lok").
- φ < 0: cecha i token **się wykluczają**.
- `a/exp` mówi, czy to „obecność razem" (a>exp) czy „wspólna nieobecność" (a<exp, φ<0).

---

## Słownik danych

**Sekcje** (z `$I` w ZL, ground-truth): `herbal` (129), `recipes` (25), `biological`/balneo
(19), `pharmaceutical` (16), `zodiac` (12), `cosmological` (10), `astronomical` (8),
`text_only` (7).

**Cechy strukturalne** (`--vf=features`) — z `schema.ts`, per-sekcja. Klucze:
- `palette:{green,blue,red_brown,ochre_yellow,white,ink_only}` — pigmenty
- herbal: `leaf_shape:*`, `leaf_arrangement:*`, `leaf_density:*`, `root_shape:*`,
  `flower_present`, `flower_count:*`, `flower_color:*`, `petal_count:*`, `stem:*`, `has_container`
- balneo: `figure_count:*`, `has_pools`, `has_tubes`, `nudity`, `figure_posture:*`
- astro/cosmo/zodiac/pharma/recipes: patrz `schema.ts`
- liczniki są kubełkowane: `0 / 1 / 2_5 / 6_20 / 20plus`

**Cechy z keywords** (`--vf=keywords`) — tagi VL rozbite na słowa, prefiks `kw:`
(np. `kw:serrated`, `kw:vase`). Stoplista wycina wypełniacze/generyki.

**Jednostki tekstu** (`--unit`):
- `word` — całe słowa EVA. Dużo, rzadkie → słaba moc na sztukę.
- `char2/3/4` — n-gramy znakowe z markerami `^`/`$` (granice słowa). `^qo` = prefiks,
  `aiin` w `char4`, `dy$` = sufiks. **`char3` to zalecany default** — łapie morfologię
  Voynicha (qo-, -aiin, gallows) i daje sensowne df.

**Typy locusów** (`--loctype`): `P` paragraf, `L` etykieta (podpis przy obiekcie),
`R` tekst promienisty (diagramy), `C` kołowy. Etykiety są w zodiaku/pharmie/balneo;
herbal ma niemal sam paragraf.

---

## Granice i pułapki (czytaj zanim uwierzysz w wynik)

1. **Moc.** Sekcje poza herbalem są małe (8–25 folii). Przy FDR na tysiącach par wykryjemy
   tylko **silne, czyste** efekty. Słaby-ale-prawdziwy sygnał będzie niewidoczny — brak
   trafień ≠ dowód braku związku.
2. **Page-level rozmywa etykiety.** Worek słów całej strony nie złapie relacji
   *etykieta ↔ konkretny obiekt*. To wymagałoby analizy per-instancja (bbox podpisu vs
   pobliski obiekt) — patrz kanał `regions` w `probe.ts`/`schema.ts`.
3. **Nie polować po reprezentacjach.** Nie odpalaj wszystkich `--unit`/`--vf` i nie bierz
   tej z największą liczbą trafień — to ukryte wielokrotne testowanie. Wybierz **z góry**
   (rekomendacja: `--unit=char3`, `--vf=features`), resztę traktuj jako *robustness check*.
4. **Szum z 8B.** Model myli cechy i bywa wewnętrznie sprzeczny (`legible:false` przy
   pełnych cechach — dlatego NIE odrzucamy po `legible`). To osłabia (rozcieńcza) korelacje.
5. **Confound.** Pracujemy wewnątrz sekcji, żeby wyciąć efekt sekcji/Currier. Jeśli kiedyś
   liczysz **między** sekcjami, „odkryjesz" znaną makro-strukturę, nie nowy sygnał.
6. **Pokrycie.** Zodiak/pharma/cosmo są słabo zanotowane (foldouty, których brakło w
   pobraniu) → mało folii w tych sekcjach. Dokończ `download.ts` + `annotate.ts`, by je dobić.
7. **Negatywny kontrolny.** Numery stron (foliacja w rogach) czasem przeciekają do keywords —
   one z definicji NIE powinny z niczym korelować; dobry test poprawności metody.

---

## Dotychczasowy wynik

Page-level, herbal (121 folii, dobra moc): **nic nie przeżywa FDR**, permutacja `P=1.0`.
Czysty wynik negatywny — wygląd strony nie przewiduje jej tekstu ponad efekt sekcji.
Sekcje etykietowe za małe, by rozstrzygnąć na poziomie strony. Realna szansa na sygnał:
analiza per-etykieta (label ↔ obiekt), nie zbudowana.
