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

- **Barlow Condensed** (`--font-display`) — tytuły ekranów i **liczby treningowe** (ciężar, powtórzenia,
  czas, tonaż, km). Cyfry: `font-variant-numeric: tabular-nums`.
- **Inter** (`--font-body`) — cała reszta.
- Tytuły i etykiety **zdaniem, nie WERSALIKAMI**. Bez rozstrzelonych etykiet nad treścią.
  `.eyebrow` = mała półgruba etykieta w kolorze drugorzędnym, bez uppercase.
- Skala: 13 / 15 (tekst) / 17 / 20 / 26 / 34 px. Wysokość linii tekstu 1,45.

## Kształt i przestrzeń

- Promienie wg hierarchii: pola i przyciski 8px, karty 14px, arkusze (sheet / modal) 20px, chipy pełne.
- Hierarchia przez odcień powierzchni (bg → surface → surface-2), nie przez cienie. Cień tylko dla
  warstw nad treścią (modal, sheet, toast, pływający przycisk).
- Odstępy z tokenów `--space-*`. Margines boczny na telefonie 16px.
- Cel dotyku min. 44×44px na telefonie (podopieczny ma spocone ręce).

## Ruch

Tylko w odpowiedzi na akcję (otwarcie arkusza, zaliczenie serii ✓, przełączenie). Bez animacji wejścia
każdej karty. Szanuj `prefers-reduced-motion`.

## Zasady pracy (dla każdego, kto zmienia wygląd)

1. **Nie zmieniaj logiki ani danych.** Tylko wygląd: CSS i znaczniki JSX potrzebne do układu.
2. **Nie zmieniaj nazw klas, `aria-label`, tekstów przycisków ani `role`** — używają ich testy
   automatyczne. Nowe klasy dodawaj obok istniejących.
3. Style piszesz w **swoim pliku** w `src/styles/` (ładowany po `styles.css`, więc nadpisuje).
   `src/styles.css` zmienia tylko warstwa fundamentów.
4. Każdy ekran sprawdź na 390px (telefon) i 1366px (komputer), w motywie Biały i Czarny.
   Bez poziomego przewijania strony, bez uciętych tekstów.
