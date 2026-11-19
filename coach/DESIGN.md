# Fitowa / coach: system wizualny „tablica treningowa”

Aplikacja dla trenera personalnego i jego podopiecznych: plany siłowe i biegowe, odtwarzacz treningu
seria po serii, kalendarz wizyt, pakiety, zdrowie. Używana głównie na telefonie, często na sali,
jedną ręką, między seriami.

## Kierunek

Fitowa ma wyglądać jak arkusz programowania treningu, tablica na sali i stoper, a nie jak dashboard SaaS.
Wzorem dla całej aplikacji są dwa elementy, które już są „branżowe”: **tabela planu** (tygodnie obok siebie,
czarny pasek nagłówka, zielona linia pod zrobionym tygodniem, kreskowana ramka deloadu) i **odtwarzacz**
(duże liczby, „ostatnio 5 powt.”, przerwa z ±15 s).

- **Czerń i biel.** Czerń (w ciemnym motywie biel) to jedyny kolor akcji.
- **Kolor tylko dla danych:** RPE, typ jednostki, status, stany ok / uwaga / błąd. Nigdy jako ozdoba.
- **Hierarchia przez typografię:** skoki rozmiaru i grubości, a nie barwa, ramki czy wersaliki.
- Redesign to odejmowanie: mniej kart, mniej przycisków, mniej objaśnień.

## Typografia

| rola | krój | token |
|---|---|---|
| tekst, przyciski, etykiety, pola | **Archivo** 400 / 500 / 600 / 700 (Google Fonts, zmienny, z latin-ext) | `--font-body` |
| H1 ekranu, imię w karcie klienta, **liczby treningowe** (ciężar, powtórzenia, czas, tonaż, km, skale 0–10, kwoty w KPI) | **Barlow Condensed** 500 / 600 / 700 | `--font-display` |

- Cyfry w kolumnach, KPI, licznikach, czasach i polach serii: `font-variant-numeric: tabular-nums`
  (reguła zbiorcza w `src/styles/tokens-data.css`; nowe klasy z liczbami dopisz tam albo dodaj klasę `.num`).
- Bez kroju mono dla danych. Liczby to Barlow Condensed albo Archivo z cyframi tabelarycznymi.
- Tytuły i etykiety **zdaniem, nie WERSALIKAMI**. Wersaliki Barlow Condensed tylko tam, gdzie oznaczają
  liczbę albo etap („TYDZIEŃ 3”, „SERIA 2/4”), nigdy jako etykieta nad każdą kartą. Bez rozstrzelenia.
- Najmniejszy tekst to 13 px (`--fs-xs`); 12 px (`--fs-2xs`) tylko dla podpisów w tabelach. Polskie znaki
  (ą ć ę ł ń ó ś ź ż) sprawdzaj w 13 px.
- **Trzy poziomy nagłówków:**
  1. H1 ekranu: Barlow Condensed 600 (`h1`, `.page-head h2`, imię w karcie klienta);
  2. H2 sekcji / karty: Archivo 600 17 px, kolor tekstu (`.card-head h4`, `.toolbar h3`, `.acard h3`);
  3. H3 podsekcji: Archivo 600 13 px, szary (`.form-section`, `.sub-title`, `.notes-head`, `.dash-due-h`, `.nt-title`, `.mydata-sub`).
- Skala pisma (tokeny): `--fs-2xs` 12 · `--fs-xs` 13 · `--fs-body` 15 · `--fs-md` 17 · `--fs-lg` 20 · `--fs-xl` 26 ·
  `--fs-2xl` 34 · liczby „display” `--fs-display` 48 i `--fs-display-lg` 56. `--fs-sm` (14) zostaje tylko
  dla zgodności starszych reguł. 16 px zostaje dosłownie w polach (iOS nie powiększa wtedy ekranu przy fokusie).
  Wysokość linii tekstu 1,45.
- Logo: „Fitowa” (Barlow 700, bez uppercase i bez rozstrzelenia) + szare „/ coach”.

## Kolor akcji i powierzchni (tokeny w `src/styles.css`)

Bazowy `:root` to motyw **Biały**. Domyślnie motyw idzie za ustawieniem telefonu: `biel` (jasny) albo
`mono` (ciemny), dopóki użytkownik nie wybierze motywu sam (klucz `fitowa-palette2`, `src/theme.ts`).
Kolorowe motywy (Kobalt, Morski, Grafit, Fiolet, Jasny) zostają do wyboru w ustawieniach, ale nie są domyślne
i nie projektujemy pod nie.

| rola | token | Biały | Czarny |
|---|---|---|---|
| tło strony | `--color-bg` | `#f3f3f3` | `#000000` |
| karta / panel | `--color-surface` | `#ffffff` | `#141414` |
| pole, wiersz wyróżniony | `--color-surface-2` | `#ececec` | `#222222` |
| tekst | `--color-text` | `#111111` | `#f2f2f2` |
| **akcja główna** | `--color-accent` | `#111111` | `#f2f2f2` |
| potwierdzenie / zrobione / OK | `--color-ok` | `#1a7f37` | `#3ccf6e` |
| uwaga / zaległe | `--color-warn` | `#b26a00` | `#ffb340` |
| błąd / złe dane / ból | `--color-danger` | `#d1242f` | `#ff5c57` |

Szary tekst na kartach `#141414` sprawdzaj osobno (min. 4,5:1). Szary o ledwo wystarczającym kontraście
w ciemnym motywie to jeden ze znaków generowanego interfejsu.

## Kolor danych (tokeny w `src/styles/tokens-data.css`)

Osobna paleta, oddzielona od koloru akcji. Każdy token ma wariant jasny i ciemny (ciemny dla Czarnego
i pozostałych ciemnych motywów). Znaczniki (pasek, kropka, linia) mają min. 3:1 z kartą, warianty `-fg`
do tekstu w kolorze min. 4,5:1.

| grupa | tokeny | wartości |
|---|---|---|
| RPE w 5 krokach (jak strefy tętna) | `--rpe-1` … `--rpe-5`, tekst: `--rpe-N-fg` | ≤6 szary · 7 niebieski · 8 zielony · 9 pomarańczowy · 10 czerwony |
| typ jednostki | `--kind-sila`, `--kind-dwuboj`, `--kind-bieg`, `--kind-rehab`, `--kind-inne` | siła czerń/biel · dwubój (rwanie, podrzut) niebieski · bieg morski · rehab i mobilność śliwkowy · inne szary |
| status | `--st-done`, `--st-next`, `--st-missed`, `--st-moved`, `--st-deload` | zrobione zielony · następny kolor tekstu · zaległe bursztyn · przeniesione i deload szary |

- Pomocnik w TS: `src/lib/dataColors.ts`: `rpeLevel(rpe)` zwraca 1–5 albo `null` („7,5”, „@8”, „7-8” = górna
  wartość; RIR i tekst bez koloru), `sessionKind(trening | ćwiczenia | nazwy)` zwraca rodzaj jednostki.
- W znacznikach: atrybut `data-rpe="1..5"` ustawia `--rpe-c`, `data-kind="sila|dwuboj|bieg|rehab|inne"` ustawia
  `--kind-c`. Gotowe klasy: `.rpe-cue` (pionowy pasek 3 px przed liczbą RPE) i `.kind-bar` (pasek z lewej).
- **Kolor zawsze stoi obok liczby, słowa albo kształtu, nigdy zamiast nich** (daltonizm, odblaski na sali).
  W tabeli planu RPE ma pasek przed liczbą, liczba zostaje w kolorze tekstu.
- Bez legendy, która tłumaczy oczywistość, ale też bez koloru, którego nie da się odczytać bez legendy.
- Kolorów danych nie używamy do tła kart, przycisków ani nagłówków.

## Kształt i przestrzeń

- Promienie (tokeny): `--radius-sm` 4 (małe elementy, segmenty) · `--radius-md` 6 (pola, przyciski) ·
  `--radius-lg` 8 (karty) · `--radius-xl` 12 (arkusze, modale) · `--radius-pill` (chipy, tagi).
  Okrąg = `50%`. Paski postępu 2–4 px mogą zostać dosłowne.
- **Karta czy sekcja:** ramkę i tło karty dostaje tylko to, co jest klikalne albo wymaga uwagi (wiersz wizyty,
  jednostka w edytorze, alert). Zwykła treść to sekcja: nagłówek plus linia podziału (`--color-divider`),
  jak w edytorze planu. Nie każda treść jest kartą i nie każda karta waży tyle samo.
- Bez kolorowej krawędzi u góry lub z lewej karty jako dekoracji (KPI nie mają paska, stan niesie kolor liczby).
- Odstępy (tokeny, nazwy historyczne): `--space-1` 4 · `--space-2` 6 · `--space-3` 8 · `--space-4` 12 ·
  `--space-6` 16 · `--space-5` 20 · `--space-8` 24 · `--space-10` 32. Margines boczny na telefonie 16 px.
- Wysokości kontrolek: `--control-sm` 36 · `--control-h` 44 (= `--tap`, cel dotyku) · `--control-lg` 56
  (przycisk główny ekranu podopiecznego, ankieta tak/nie). `.btn-sm` 32 tylko na komputerze.
- Hierarchia przez odcień powierzchni (bg → surface → surface-2), nie przez cienie. Cień tylko dla
  warstw nad treścią (modal, sheet, toast, pływający przycisk): `--shadow`, `--shadow-lg`. Bez poświaty.
- Cel dotyku min. 44×44 px na telefonie (podopieczny ma spocone ręce).

## Ikony

- Tylko komponent `Icon` z `src/components/ui.tsx`. Bez glifów Unicode jako ikon (▶ ✎ ✓ ⚙ ↻ ✕) i bez emoji.
- Własna konwencja: siatka 24, kreska 2,25, końce i narożniki kwadratowe (`square` / `miter`), odcinki
  pod 90° i 45°; łuki tylko tam, gdzie przedmiot jest okrągły. Rysunek w polu 3–21. Kolor = kolor tekstu.
  Nowe ikony rysuj w tej samej konwencji (nie wklejaj Lucide ani Feather).
- Chevron „›” tylko przy wierszu listy, który prowadzi dalej (jako `Icon name="chevR"`), nigdy doklejony
  do linku tekstowego czy przycisku („Wszystkie”, „Przejrzyj”, a nie „Wszystkie ›”). Powrót: `chevL` + słowo.
- Ikona bez etykiety tylko tam, gdzie znaczenie jest oczywiste (zamknij, usuń, więcej); w innym razie z podpisem.
- ✓ i ▶ jako znak w danych (np. nagłówek „Tydzień 1 ✓” w tabeli planu, eksport do Excela) mogą zostać tekstem.

## Komponenty

- **Jedna czarna akcja na ekran.** Czarne (`.btn-primary`) są tylko akcja główna ekranu i „+”. Reszta to
  przyciski drugorzędne albo tekstowe. Ta sama czynność ma tę samą nazwę w całym przepływie
  („Prowadź trening” wszędzie, nie raz „Prowadź”, raz „Start”, raz „Rozpocznij”).
- Rzadkie akcje w menu „⋯” (wzór: karta planu na telefonie), a nie w rzędzie równorzędnych przycisków.
- Aktywny segment przełącznika (`.seg button.active`) to jasny kafelek na szarym torze (`--seg-on`).
  Zakładki karty klienta = podkreślenie, wygaszanie przy krawędzi (`data-fade-start/end`).
- **Pola formularzy** (`.input`): tło `--field-bg`, ramka 1 px `--field-border`; fokus = ramka 2 px w akcencie.
  Pola zablokowane i tylko do odczytu: bez wypełnienia, ramka przerywana, szary tekst.
- **Skala 0–10** (sRPE, ból): zawsze jeden rząd, 11 kolumn, przyciski 44 px wysokości, także na telefonie.
- **Ankieta tak / nie**: dwa duże przyciski (56 px) na całą szerokość.
- **Puste stany** (`.empty`, `.review-empty`): bez ramki i tła, tekst + najwyżej jedna akcja.
- **Pigułki statusu** (`.tag`) tylko tam, gdzie status zmienia decyzję.
- **Edytor planu**: tydzień = nagłówek sekcji, jednostka = karta, ćwiczenie = wiersz z linią podziału.
- **Nagłówek karty klienta na telefonie**: awatar 44, imię 26 px, status + cel + dane w jednej linii z wielokropkiem,
  „Prowadź trening” na całą szerokość, pod nim „Tryb zawodnika” i „+ Zadaj trening”.

## Ruch

- Przełączenie ekranu i zakładki: **natychmiast**, bez animacji wejścia (`.fade` to już tylko znacznik
  ekranu, `animation: none`). Bez „fade-up” na każdej sekcji i bez animacji wejścia każdej karty.
- Ruch tylko w odpowiedzi na akcję: zaliczenie serii (zabarwienie wiersza), start przerwy, otwarcie arkusza
  lub modala, rozwinięcie sekcji. Czas 120–200 ms, `ease-out`.
- Najwyżej jeden powściągliwy moment świętowania (rekord życiowy), krótki, bez konfetti.
- Zawsze szanuj `prefers-reduced-motion: reduce` (wtedy `animation: none`).

## Copy

- **Bez „—” w interfejsie:** w przyciskach, tytułach, toastach, aria-label. W zdaniu myślnik zamień na kropkę,
  dwukropek albo przecinek („Ułóż ćwiczenia”, nie „Dalej — ułóż ćwiczenia”).
- **Bez akapitu objaśnienia pod każdym nagłówkiem.** Objaśnienie najwyżej w jednej linii albo pod „?”.
  Jeśli akapit może być zdaniem, zrób z niego zdanie; jeśli etykietę da się usunąć, usuń.
- **Głos trenera**, konkretny i krótki: „Plan skończył się 01.10. Następny w kolejce: …”, a nie uprzejmy asystent.
- Bez powitań „Cześć, {imię}!”. Ekran zaczyna się od rzeczy: „Dziś: B, plyometria i stabilność. 45 min.”
- Przycisk mówi, co się stanie. Toast potwierdza krótko („Wysłane”, „Zapisano”).
- Bez ciągów „A · B · C” tam, gdzie wystarczy jedno słowo, i bez wyliczeń po trzy dla rytmu.

## Czego unikać

- Neonowy albo kwasowy akcent na czarnym tle (limonka, zieleń, cyjan) jako „sportowy” wygląd.
- Rozstrzelone etykiety wersalikami nad każdą sekcją.
- Krój mono do danych i liczb jako dekoracja; Inter, Geist, Space Grotesk, Instrument Serif, Fraunces jako krój tekstu.
- Emoji, gradienty, szkło (backdrop-blur, przezroczyste karty), poświata, cienie dekoracyjne.
- Kolorowa krawędź karty, rzędy jednakowych kafelków statystyk, numerowane kroki 1-2-3.
- Jednakowe karty z jednakowym promieniem na każdą treść („bento”).
- Ten sam fade na każdym ekranie; chevron przy każdym linku.

## Zasady pracy (dla każdego, kto zmienia wygląd)

1. **Nie zmieniaj logiki ani danych.** Tylko wygląd: CSS i znaczniki JSX potrzebne do układu.
2. **Nie zmieniaj nazw klas, `aria-label` ani `role`** bez potrzeby. Nowe klasy dodawaj obok istniejących.
3. Style piszesz w **swoim pliku** w `src/styles/` (ładowany po `styles.css`, więc nadpisuje).
   `src/styles.css` i `src/styles/tokens-data.css` zmienia tylko warstwa fundamentów. Jeden selektor = jedna
   reguła w pliku. Wartości tylko z tokenów (kolor, promień, pismo, wysokość), nigdy wpisane hexy.
4. Każdy ekran sprawdź na 390 px (telefon) i 1366 px (komputer), w motywie Biały i Czarny.
   Bez poziomego przewijania strony, bez uciętych tekstów.
