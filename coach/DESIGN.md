# Fitowa / coach — system wizualny „Czarno-biały”

Aplikacja dla trenera personalnego i jego podopiecznych: plany siłowe i biegowe, odtwarzacz treningu
seria po serii, kalendarz wizyt, pakiety, zdrowie. Używana głównie na telefonie, często na sali,
jedną ręką, między seriami.

## Kierunek

**Czerń, biel i odcienie szarości.** Kolor pojawia się wyłącznie jako sygnał — nigdy jako ozdoba.
Hierarchię budują kontrast, grubość pisma i odcień szarości tła, nie barwa.

## Kolor (tokeny w `src/styles.css`)

Domyślne motywy: `biel` (jasny) i `mono` (ciemny) — wybierany automatycznie wg ustawień telefonu,
dopóki użytkownik nie wybierze motywu sam (klucz `fitowa-palette2`).

| rola | token | Biały | Czarny |
|---|---|---|---|
| tło strony | `--color-bg` | `#f3f3f3` | `#000000` |
| karta / panel | `--color-surface` | `#ffffff` | `#141414` |
| pole, wiersz wyróżniony | `--color-surface-2` | `#ececec` | `#222222` |
| tekst | `--color-text` | `#111111` | `#f5f5f5` |
| akcja główna | `--color-accent` | `#111111` | `#f5f5f5` |
| **potwierdzenie / zrobione / OK** | `--color-ok` | `#1a7f37` | `#3ccf6e` |
| **uwaga / zaległe** | `--color-warn` | `#b26a00` | `#ffb340` |
| **błąd / złe dane / ból** | `--color-danger` | `#d1242f` | `#ff5c57` |

Zasady:
- Tylko trzy kolory mają barwę: zielony (potwierdzenie), bursztyn (na co zwrócić uwagę), czerwony
  (błąd, złe dane). Wszystko inne — w tym akcent, wykresy, kolory podopiecznych i miejsc — jest szare.
- Bez emoji w interfejsie — ikony SVG (`Icon` w `components/ui.tsx`) w kolorze tekstu.
- Bez gradientów i cieni dekoracyjnych. Używaj tokenów, nigdy wpisanych hexów.
- Kolorowe motywy (Kobalt, Morski, Grafit, Fiolet, Jasny) zostają do wyboru w ustawieniach.

## Typografia

- **Barlow Condensed** (`--font-display`) — tytuły ekranów (H1) i **liczby treningowe** (ciężar, powtórzenia,
  czas, tonaż, km, skale 0–10). Cyfry: `font-variant-numeric: tabular-nums`.
- **Inter** (`--font-body`) — cała reszta, w tym **wszystkie przyciski** (Inter 600, także `.btn-lg`).
- Tytuły i etykiety **zdaniem, nie WERSALIKAMI**. Bez rozstrzelonych etykiet nad treścią.
  `.eyebrow` = mała półgruba etykieta w kolorze drugorzędnym, bez uppercase.
- Logo: jedno — „Fitowa” (Barlow 700, bez uppercase i bez rozstrzelenia) + szare „/ coach”.
- **Trzy poziomy nagłówków:**
  1. H1 ekranu — Barlow Condensed 600 (`h1`, `.page-head h2`, imię w karcie klienta);
  2. H2 karty — Inter 600 17 px, kolor tekstu (`.card-head h4`, `.toolbar h3`, `.acard h3`);
  3. H3 podsekcji — Inter 600 13 px, szary (`.form-section`, `.sub-title`, `.notes-head`, `.dash-due-h`, `.nt-title`, `.mydata-sub`).
- Skala pisma (tokeny): `--fs-2xs` 12 · `--fs-xs` 13 · `--fs-body` 15 · `--fs-md` 17 · `--fs-lg` 20 · `--fs-xl` 26 ·
  `--fs-2xl` 34 · liczby „display” `--fs-display` 48 i `--fs-display-lg` 56. `--fs-sm` (14) zostaje tylko
  dla zgodności starszych reguł. 16 px zostaje dosłownie w polach (iOS nie powiększa wtedy ekranu przy fokusie).
  Wysokość linii tekstu 1,45. Wartość dosłowną zamieniamy na token, gdy różni się o ≤ 1 px.

## Kształt i przestrzeń

- Promienie (tokeny): `--radius-sm` 6 (małe elementy, segmenty) · `--radius-md` 8 (pola, przyciski) ·
  `--radius-lg` 14 (karty) · `--radius-xl` 20 (arkusze, modale) · `--radius-pill` (chipy, tagi — zamiast `999px`).
  Okrąg = `50%`. Paski postępu 2–4 px mogą zostać dosłowne.
- Odstępy (tokeny, nazwy historyczne): `--space-1` 4 · `--space-2` 6 · `--space-3` 8 · `--space-4` 12 ·
  `--space-6` 16 · `--space-5` 20 · `--space-8` 24 · `--space-10` 32. Margines boczny na telefonie 16px.
- Wysokości kontrolek: `--control-sm` 36 · `--control-h` 44 (= `--tap`, cel dotyku) · `--control-lg` 56
  (przycisk główny ekranu podopiecznego, ankieta tak/nie). `.btn-sm` 32 tylko na komputerze.
- Hierarchia przez odcień powierzchni (bg → surface → surface-2), nie przez cienie. Cień tylko dla
  warstw nad treścią (modal, sheet, toast, pływający przycisk): `--shadow`, `--shadow-lg`.
  **Bez „poświaty”** (`box-shadow 0 0 20px` w kolorze akcentu, `drop-shadow` na wykresach).
- Cel dotyku min. 44×44px na telefonie (podopieczny ma spocone ręce).

## Komponenty — zasady

- **Jedna akcja główna na ekran.** Czarne (akcent) są tylko przyciski główne (`.btn-primary`) i „+”.
  Aktywny segment przełącznika (`.seg button.active`) to **jasny kafelek na szarym torze**
  (`--seg-on`: w jasnych motywach biała powierzchnia, w ciemnych jaśniejsza powierzchnia na ciemnym torze).
  Zakładki karty klienta = podkreślenie, wygaszanie przy krawędzi (`data-fade-start/end`), aktywna przewija się do widoku.
- **Pola formularzy** (`.input`): tło pola (`--field-bg`: jasny = biel, ciemny = ciemniejsze od karty) i ramka 1 px
  (`--field-border`: jasny = `--color-neutral-600`, ciemny = `--color-neutral-700`); fokus = ramka 2 px w akcencie.
  Pola zablokowane i tylko do odczytu: **bez wypełnienia, ramka przerywana**, szary tekst.
- **Skala 0–10** (sRPE, ból): zawsze jeden rząd, 11 kolumn, przyciski 44 px wysokości — także na telefonie.
- **Ankieta tak / nie**: dwa duże przyciski (56 px) wypełniające całą szerokość.
- **Puste stany** (`.empty`, `.review-empty`): bez ramki i tła — tekst + najwyżej jedna akcja.
- **Edytor planu**: tydzień = nagłówek sekcji, jednostka = karta, ćwiczenie = wiersz z linią podziału
  (bez własnej ramki); na telefonie nazwa ćwiczenia w osobnym wierszu na całą szerokość.
- **Nagłówek karty klienta na telefonie**: awatar 44, imię 26 px, status + cel + dane w jednej linii z wielokropkiem,
  „Prowadź trening” na całą szerokość, pod nim „Tryb zawodnika” i „+ Zadaj trening” (muszą być widoczne — używają ich testy).

## Ruch

Tylko w odpowiedzi na akcję (otwarcie arkusza, zaliczenie serii ✓, przełączenie). Bez animacji wejścia
każdej karty. Szanuj `prefers-reduced-motion`.

## Zasady pracy (dla każdego, kto zmienia wygląd)

1. **Nie zmieniaj logiki ani danych.** Tylko wygląd: CSS i znaczniki JSX potrzebne do układu.
2. **Nie zmieniaj nazw klas, `aria-label`, tekstów przycisków ani `role`** — używają ich testy
   automatyczne. Nowe klasy dodawaj obok istniejących.
3. Style piszesz w **swoim pliku** w `src/styles/` (ładowany po `styles.css`, więc nadpisuje).
   `src/styles.css` zmienia tylko warstwa fundamentów. Jeden selektor = jedna reguła w pliku (bez duplikatów
   do „dopisywania” — popraw istniejącą). Wartości tylko z tokenów (kolor, promień, pismo, wysokość).
4. Każdy ekran sprawdź na 390px (telefon) i 1366px (komputer), w motywie Biały i Czarny.
   Bez poziomego przewijania strony, bez uciętych tekstów.
