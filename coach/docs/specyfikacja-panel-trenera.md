# Panel trenera – specyfikacja projektu (przekazanie do Claude Code)

> Autor/właściciel: Sebastian Palej (@sebastianpalej) – trener S&C / Return to Sport, student fizjoterapii, Kraków.
> Język interfejsu i komunikacji: **polski**. Waluta: PLN. Formaty dat: pl-PL, tydzień zaczyna się w poniedziałek.

## 1. Kontekst i cel przeniesienia

Obecny prototyp to **jeden plik `panel-trenera.html`** (~165 kB, vanilla JS, bez frameworka) opublikowany jako artefakt claude.ai z wbudowaną bazą dokumentową (`window.claude.use('db')`). Działa jako panel trenera + „tryb zawodnika” uruchamiany na urządzeniu trenera.

**Główne ograniczenie, które wymusza migrację:** klienci (osoby spoza organizacji) nie mogą się logować ani zapisywać danych – mają tylko podgląd i potrzebują konta Claude. Cel w Claude Code:

1. Samodzielna aplikacja **PWA** z **logowaniem dla trenera i klientów** (każdy klient widzi tylko swoje dane).
2. Zachować 1:1 logikę biznesową i wzory opisane niżej.
3. Docelowo: płatności online (Przelewy24 / Stripe / BLIK), powiadomienia, RODO.

Proponowany stack: **Next.js (App Router) + TypeScript + Supabase (Auth, Postgres, RLS, Storage) + Tailwind**, hosting Vercel. PWA (manifest + service worker), mobile-first.

## 2. Moduły i funkcje (stan obecny)

### Panel trenera (nawigacja: Pulpit · Kalendarz · Klienci · Płatności · Ćwiczenia)
- **Pulpit:** „Dziś w kalendarzu” (z szybkim „Zapisz trening”), statystyki (aktywni klienci, treningi 7 dni, wpłaty w miesiącu, zaległości), Do zapłaty, Sygnały ostrzegawcze, Kończące się pakiety, Bez treningu 10+ dni, Ostatnie treningi.
- **Kalendarz:** widok tydzień/miesiąc, kolor per klient (hash id → hue), wizyty z godziną/czasem/miejscem/notatką, powtarzanie co tydzień (4–24 tyg., `seriesId`), wykrywanie kolizji, statusy: `planned | done | cancel | noshow`, przerywane kafelki dla treningów bez wizyty.
- **Klient – zakładki:** Przegląd · Plan · Treningi · Monitoring · Pomiary i testy · Płatności · Profil.
- **Plany:** tygodnie → jednostki (workouts) → ćwiczenia → **serie rozpisane pojedynczo** (każda seria = osobny wiersz). Duplikuj tydzień, duplikuj plan, ustaw aktywny, usuń plan, usuń trening z planu, przesuń ćwiczenie ↑.
- **Zapis treningu (trener):** wczytanie jednostki z planu, wellness przed, ćwiczenia (serie×powt.@kg, RPE, przerwa, uwagi), czas trwania, sRPE, ból 0–10, notatki, rozliczenie.
- **Monitoring S&C:** ACWR, monotonia, strain, tygodniowe obciążenie sRPE (12 tyg.), ACWR w czasie (linie 0,8/1,3/1,5), wellness, ból, tonaż.
- **Pomiary i testy:** masa, obwody, %BF; bateria testów (1RM, CMJ, SJ, RSI, sprinty, 505, IMTP, hop testy, Y-balance, izometria, ROM…), wynik L/P z automatycznym **LSI**, siła względna (×masa ciała).
- **Profil:** dane zawodnika (data ur., wzrost, sport, pozycja, strona dominująca, staż, dni/tydz., najbliższy start), rozliczenie i stawki, **historia urazów** ze statusem.
- **Płatności:** pakiety, abonament, sesje pojedyncze; oznacz opłacone/cofnij; filtry.
- **Biblioteka ćwiczeń:** nazwa, kategoria, link do wideo (podpowiedzi w planach).

### Tryb zawodnika (ciemny motyw, akcent fiolet `#7C6CF6`)
- Ekran startowy: „Cześć, [imię]”, plan i tydzień, licznik serii tygodni, karta „Następny / W trakcie”, **„Jak się dziś czujesz?”** (5×1–5) → gotowość vs norma 28 dni, cel tygodnia (pierścień), kalendarz miesiąca z ✓, **Estymacja** (e1RM + wykres + chipy ćwiczeń), **Dystrybucja** (wysiłek z serii vs RPE treningu, rozkład RPE serii), Ostatnie rekordy, **lista „Twoje treningi”** (start dowolnego treningu, wybór planu).
- **Odtwarzacz treningu:** nagłówki bloków serii, pola kg/powt./RPE, ✓ zaliczenia, + seria / + seria wstępna, **autoregulacja** ciężaru następnej serii, **timer przerwy** (±15 s, wibracja, beep), **metronom tempa** (fazy z zapisu `3-1-X-0`, suwaki, licznik powtórzeń), podsumowanie (sRPE, ból, czas auto, notatka). Stan treningu w toku trzymany w `localStorage` (`panel-run-v1-<clientId>`).
- Brak przycisków usuwania w trybie zawodnika (usuwanie tylko w panelu trenera).

## 3. Model danych (obecne kolekcje → proponowane tabele)

Obecnie dokumenty JSON. Daty jako `YYYY-MM-DD`, miesiące `YYYY-MM`. Liczby często trzymane jako stringi z inputów – w nowej wersji typować.

### `clients/{id}`
```
name, phone, email, goal, level, status ('aktywny'|'pauza'|'zakończony'),
dob, height, sport, position, dominant ('prawa'|'lewa'|''), experience, daysPerWeek, targetDate,
billing ('pakiet'|'pojedyncza'|'abonament'|'brak'), singleRate, subRate, pkgSize, pkgPrice,
startDate, injuries (tekst), notes, createdAt,
payments: [{ id, type:'pakiet'|'abonament'|'pojedyncza', amount, date, dueDate, status:'due'|'paid', paidDate?, sessions? (pakiet), month? (abonament 'YYYY-MM'), desc }],
measurements: [{ id, date, weight, waist, hips, chest, arm, thigh, bf, note }],
tests: [{ id, date, name, value, unit, left?, right?, lsi?, involved?('L'|'P'), note }],
injuryLog: [{ id, name, date, side, status:'aktywny'|'w rehabilitacji'|'wyleczony', returnDate, note }],
checkins: [{ date, sleep, energy, muscle, stress, mood }]   // 1–5, max ~200 ostatnich
```
→ Supabase: `clients`, `payments`, `measurements`, `tests`, `injuries`, `checkins` (osobne tabele, FK `client_id`).

### `plans/{id}`
```
clientId, name, startDate, active (bool, max 1 aktywny na klienta), notes, updatedAt,
weeks: [{ name, workouts: [{ name, exercises: [{
   name, rest ('2:00'|'90'|'2 min'), notes (uwagi + tempo np. '3-1-X-0'),
   groups: [{ type, reps, load, rpe, sets? }],   // jeden wiersz = jedna seria (sets domyślnie 1)
   sets, reps, load, rpe                           // pola podsumowania liczone przy zapisie (kompatybilność)
}]}]}]
```
`type` ∈ `Rozgrzewka | Top set | Robocze | Back-off | Drop set | AMRAP`.
→ Supabase: `plans`, `plan_weeks`, `plan_workouts`, `plan_exercises`, `plan_sets` (z `position`).

### `sessions/{clientId}__{YYYY-MM}` (dokument miesięczny klienta)
```
clientId, month, entries: [{
  id, date, workoutName, charge ('pakiet'|'abonament'|'pojedyncza'|'brak'),
  duration (min), srpe (0–10), pain (0–10), notes,
  wellness: { sleep, energy, muscle, stress, mood }, sleepH, rhr,
  planId, planRef ('weekIdx|workoutIdx'),
  exercises: [{ name, sets, reps, load, rpe, rest, notes,
                setsLog?: [{ load, reps, rpe, warmup, label }] }]   // z trybu zawodnika
}]
```
Bucketowanie miesięczne wynikało z limitu 5000 dokumentów – w Postgresie: tabele `sessions` + `session_exercises` + `session_sets`.

### `appts/{YYYY-MM}`
```
month, items: [{ id, clientId, date, time ('HH:MM'), duration (min), location, note,
                 status:'planned'|'done'|'cancel'|'noshow', sessionId, seriesId }]
```
→ `appointments`.

### `library/exercises`
```
items: [{ id, name, cat, video }]
```
Kategorie: Dół ciała, Góra – pchanie, Góra – przyciąganie, Core, Dwubój, Plyometria, Kondycja, Mobilność i rehab. → `exercises` (globalna biblioteka trenera).

## 4. Logika biznesowa i wzory (zachować dokładnie)

### Rozliczenia
- **Pakiet:** pozostało = Σ `sessions` wszystkich płatności typu pakiet − liczba sesji z `charge='pakiet'`. Ostrzeżenie przy ≤2; ujemne = „ponad pakiet”. Wizualizacja: sztanga z talerzami.
- **Sesja pojedyncza:** przy zapisie nowego treningu z `charge='pojedyncza'` i kwotą > 0 tworzy płatność; domyślnie „zapłacone od razu” (`paidDate = data treningu`), inaczej `due` z terminem +7 dni.
- Domyślne `charge` = `client.billing`; fallback: pakiet z saldem > 0 → abonament (jeśli `subRate`) → pojedyncza (jeśli `singleRate`) → brak.
- Zaległa = `status!=='paid' && dueDate < dziś`.

### Kalendarz ↔ treningi
- Zapis treningu z wizyty ustawia wizytę na `done` + `sessionId`.
- Zapis treningu bez wizyty: jeśli klient ma tego dnia wizytę `planned` → oznacz ją `done`.
- Usunięcie treningu powiązanego z wizytą → wizyta wraca do `planned`.
- Kolizja: nakładające się przedziały `[time, time+duration)` tego samego dnia (z pominięciem odwołanych).

### Monitoring
- **Obciążenie sesji (AU)** = sRPE × czas (min).
- **Ostre** = suma AU z 7 dni (dziś−6…dziś). **Przewlekłe** = suma z 28 dni / 4.
- **ACWR** = ostre / przewlekłe; liczony tylko, gdy pierwszy wpis ≥ 21 dni wcześniej i przewlekłe > 0. Strefy: <0,8 niedociążenie · 0,8–1,3 optimum · 1,3–1,5 uwaga · >1,5 wysokie ryzyko.
- **Monotonia** = średnia dzienna AU / odchylenie std. (7 dni, z zerami); **Strain** = ostre × monotonia.
- **Tonaż** = Σ serie × powt. × kg (z `setsLog` bez rozgrzewek, jeśli jest).
- **Wellness** = suma 5 pozycji (5–25). **Gotowość** = średnia 5 pozycji (1–5); **norma** = średnia z 28 dni przed dziś (check-iny + wellness z sesji, bez duplikatu dnia).
- **Sygnały:** ACWR >1,5 (czerwony) / >1,3 (żółty); monotonia >2; wellness ≤12/25 lub spadek >20% vs średnia 4 poprzednich; ból ≥4 (≥6 czerwony); aktywne urazy; LSI <90% (<80% czerwony).
- **LSI** = słabsza/silniejsza × 100 (lub wskazana kończyna operowana / zdrowa); dla testów „niższy = lepszy” odwrotnie.

### Siła i autoregulacja
- **e1RM** (Epley z RIR): `RIR = 10 − RPE`; `e1RM = kg × (1 + (powt + RIR)/30)`; dla powt+RIR = 1 → kg; pomijane gdy powt+RIR > 15. Najlepszy e1RM sesji = max z serii roboczych.
- **Ciężar pod cel:** `kg = e1RM / (1 + (powt + RIR_cel)/30)`, zaokrąglenie do 2,5 kg (RPE domyślne 8, przy braku RPE w obliczeniu docelowym RIR 2).
- **Zapis ciężaru w serii planu:** `100` = kg · `75%` = % e1RM z historii · `-10%`/`+4%` = względem poprzedniej serii · puste = dobór z RPE (jeśli jest historia).
- **Łączenie serii:** kolejne identyczne wiersze (type, reps, load, rpe) łączą się w jeden blok w trybie zawodnika.
- **Semantyka względna:** w bloku Back-off/Robocze wszystkie serie mają ten sam ciężar liczony od ostatniej serii poprzedniego bloku; **Drop set** schodzi kaskadowo seria po serii.
- **Po zaliczeniu serii:** jeśli następna seria nie była ręcznie edytowana → relatywna: przelicz od faktycznego ciężaru; stała (kg/%) → bez zmian; pusta → `loadFor(e1RM z tej serii, powt., RPE_cel)` z podpowiedzią „±X% vs poprzednia seria”.
- **Rekordy:** chronologicznie per ćwiczenie; rekord = e1RM > dotychczasowy max + 0,05.
- **Następny trening:** pierwszy z planu (kolejność tydzień→jednostka), którego `planRef` nie ma w sesjach tego planu; plan = aktywny, w przeciwnym razie najnowszy.
- **Seria tygodni:** kolejne tygodnie (pn–nd) z ≥1 treningiem, licząc od bieżącego (lub poprzedniego, jeśli bieżący pusty).
- **Tempo:** regex `[0-9X]-[0-9X]-[0-9X]-[0-9X]` w uwagach; X = 1 s. Fazy: opuszczanie, pauza w dole, podnoszenie, pauza w górze.
- **Przerwa:** `'2:00'` → 120 s; liczba ≤5 lub z „min” → minuty; inaczej sekundy; domyślnie 120 s.

## 5. Uprawnienia (docelowe RLS w Supabase)
- Rola `trainer`: pełny dostęp do wszystkich swoich klientów i danych.
- Rola `client`: odczyt swojego profilu, planów, sesji, wyników, płatności; **zapis**: check-iny, sesje z trybu zawodnika (`sessions`/`session_sets` własne), notatki. Brak usuwania.
- Klient nigdy nie widzi danych innych klientów. Dane zdrowotne (urazy, ból, wellness) = dane wrażliwe → RODO: zgoda przy rejestracji, eksport/usunięcie danych.
- Zaproszenie klienta przez trenera (magic link / kod).

## 6. Design
- Panel trenera: jasny/ciemny (prefers-color-scheme), fonty **Barlow Condensed** (nagłówki) + **Barlow**; akcent niebieski `#1D4ED0`; statusy: czerwony `#C4213A`, żółty `#D99E00`, zielony `#1F8049`. Desktop: sidebar; mobile: dolne menu + środkowy FAB „Dodaj wizytę”.
- Tryb zawodnika: zawsze ciemny (`#0E0F14` tło, `#171922` karty), akcent `#7C6CF6`, sugestie ciężaru `#39C6D6`, zielony `#2FCB8A`.
- Mobile-first, safe-area insets, duże pola dotykowe w odtwarzaczu.

## 7. Lekcje z prototypu (ważne przy przepisywaniu)
- **Nie używać `window.confirm()`** – w osadzonych/sandboxowanych widokach jest blokowany i cicho zwraca `false`. Używać własnego dialogu (`ask(msg) → Promise<boolean>`).
- Dane z subskrypcji bazy były zamrożone → zawsze edytować kopię (draft) i zapisywać całość.
- Nie przerysowywać formularza przy zdarzeniach z bazy, gdy użytkownik pisze (utrata fokusu).
- Wyraźne przyciski akcji (Edytuj/Usuń) – klikalne wiersze bez przycisku były nieodkrywalne.
- Usunięcie jednostki z planu wymaga przemapowania `planRef` w zapisanych sesjach (indeksy się przesuwają) – w Postgresie użyć stabilnych ID jednostek zamiast indeksów.

## 8. Plan migracji (kolejność dla Claude Code)
1. Szkielet Next.js + Supabase, schemat SQL (tabele z p. 3), RLS (p. 5), auth trener/klient.
2. Import danych: skrypt czytający eksport JSON z prototypu (kolekcje `clients`, `plans`, `sessions`, `appts`, `library`) i mapujący na tabele; zamiana `planRef` (indeksy) na ID.
3. Przeniesienie logiki z p. 4 do modułu `lib/` (czyste funkcje TS + testy jednostkowe – wzory są deterministyczne, łatwe do pokrycia testami).
4. Panel trenera (widoki z p. 2), potem tryb zawodnika jako aplikacja klienta.
5. PWA, powiadomienia (przypomnienie o check-inie / wizycie), płatności online.

Plik źródłowy prototypu: `panel-trenera.html` – referencja dla UI i logiki (funkcje m.in. `loadStats`, `clientAlerts`, `e1rmRPE`, `loadFor`, `resolveLoad`, `mergeGroups`, `onSetDone`, `nextWorkout`, `streak`, `readinessNorm`, `pkgOf`, `saveSession`, `apptWrite`).
