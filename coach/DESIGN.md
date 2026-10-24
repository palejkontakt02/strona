# Fitowa / coach — system wizualny „Kobalt”

Aplikacja dla trenera personalnego i jego podopiecznych: plany siłowe i biegowe, odtwarzacz treningu
seria po serii, kalendarz wizyt, pakiety, zdrowie. Używana głównie na telefonie, często na sali,
jedną ręką, między seriami. Trener i podopieczni są przyzwyczajeni do arkuszy (Excel / Google Sheets)
z kolorowymi paskami tygodni — to jest punkt wyjścia, nie strona SaaS.

## Kierunek

**Tablica na sali + arkusz treningowy.** Granatowe tło (nie czerń), kobaltowy akcent, dane treningowe
podane jak w dobrze zrobionym arkuszu: pasek nagłówka w kolorze, zebra wierszy, duże wąskie cyfry.

Jedna rzecz ma być zapamiętywalna: **tabele i liczby treningu** (plan, serie w odtwarzaczu, historia).
Wszystko wokół — spokojne, równe, bez ozdobników.

## Kolor (tokeny w `src/styles.css`, motyw `kobalt` jest domyślny)

| rola | token | Kobalt |
|---|---|---|
| tło strony | `--color-bg` | `#0e1726` |
| karta / panel | `--color-surface` | `#16223a` |
| pole, wiersz wyróżniony | `--color-surface-2` | `#1f2e4a` |
| tekst | `--color-text` | `#e8eef7` |
| tekst drugorzędny | `--color-neutral-400` | `#9aa8c0` |
| akcent (akcja, aktywne, „następny”) | `--color-accent` | `#5b8cff` |
| zrobione / OK | `--color-ok` | `#3ccf91` |
| uwaga | `--color-warn` | `#f2ab3c` |
| błąd / ból | `--color-danger` | `#f2607a` |
| pasek nagłówka tabeli | `--band` / `--band-fg` | `#24447f` / `#e3ebff` |
| zebra wierszy | `--zebra` | tekst 3,5% |

Zasady: kolor niesie znaczenie (akcent = co teraz zrobić, zielony = zrobione, żółty = zaległe,
czerwony = problem). Żadnych gradientów dekoracyjnych. Używaj tokenów, nigdy wpisanych hexów —
wszystkie motywy (Kobalt, Morski, Grafit, Fiolet, Jasny, Czarno-biały) muszą dalej działać.

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
4. Każdy ekran sprawdź na 390px (telefon) i 1366px (komputer), w motywie Kobalt i Jasny.
   Bez poziomego przewijania strony, bez uciętych tekstów.
