# Fitowa / coach

Aplikacja dla trenera do zarządzania podopiecznymi (podopieczni, plany, postępy, sesje, płatności).
Działa pod adresem https://sebastianpalej.pl/app/.

## Struktura

- `coach/` — kod źródłowy (React + TypeScript + Vite)
- `app/` — zbudowana aplikacja serwowana przez GitHub Pages (nie edytować ręcznie)

## Praca lokalnie

```bash
cd coach
npm install
npm run dev      # serwer deweloperski: http://localhost:5173/app/
npm run build    # buduje do ../app — zbudowane pliki trzeba scommitować
```

## Specyfikacja i logika

Docelowy zakres aplikacji opisuje `docs/specyfikacja-panel-trenera.md` (panel trenera + tryb zawodnika).
Wygląd: styl Fitowa (ciemny motyw, fiolet, Inter); układ i funkcje: panel trenera.

Wzory z prototypu (ACWR, monotonia, e1RM, autoregulacja, pakiety, LSI, kolizje wizyt, sygnały ostrzegawcze)
są w `src/lib/` jako czyste funkcje z testami: `npm test`. Model danych: `src/domain.ts`.

## Dane

Na razie dane są zapisywane w `localStorage` przeglądarki (klucz `fitowa-coach:v1`),
a przy pierwszym uruchomieniu wczytywane są dane przykładowe (`src/data/seed.ts`).
Cała komunikacja z danymi idzie przez interfejs `CoachRepository` (`src/data/repository.ts`),
więc backend (Supabase) podpina się jako kolejna implementacja tego interfejsu.
