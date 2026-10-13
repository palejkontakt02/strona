# Fitowa / coach — panel trenera

Aplikacja dla trenera (panel) i jego podopiecznych (tryb zawodnika). Działa pod adresem https://sebastianpalej.pl/app/.
Wygląd: styl Fitowa (ciemny motyw, fiolet, Inter). Zakres i logika: `docs/specyfikacja-panel-trenera.md`.

## Co jest w środku

- **Pulpit** — dzisiejsze wizyty z szybkim „Zapisz trening”, statystyki, do zapłaty, sygnały ostrzegawcze,
  kończące się pakiety, klienci bez treningu 10+ dni, ostatnie treningi.
- **Kalendarz** — tydzień / miesiąc, kolor per klient, wizyty cykliczne (4–24 tyg.), wykrywanie kolizji,
  statusy (zaplanowana / odbyta / odwołana / nieobecność), przerywane kafelki dla treningów bez wizyty.
- **Klienci** — Przegląd · Plan · Treningi · Monitoring · Pomiary i testy · Płatności · Profil.
- **Płatności** — pakiety, abonamenty, sesje pojedyncze, filtry, oznaczanie opłaconych.
- **Ćwiczenia** — biblioteka z kategoriami i linkami do wideo (podpowiedzi w planach i zapisie treningu).
- **Tryb zawodnika** — start z następnym treningiem, check-in samopoczucia i gotowość vs norma, cel tygodnia,
  kalendarz, e1RM, dystrybucja RPE, rekordy; odtwarzacz z autoregulacją ciężaru, timerem przerwy i metronomem tempa.

## Struktura

- `src/domain.ts` — model danych
- `src/lib/` — wzory i logika (czyste funkcje + testy `*.test.ts`)
- `src/data/` — warstwa danych (`Repository`: teraz localStorage, docelowo Supabase), dane przykładowe, operacje
- `src/views/`, `src/modals/`, `src/athlete/` — interfejs
- `../app/` — zbudowana aplikacja serwowana przez GitHub Pages (nie edytować ręcznie)

## Praca lokalnie

```bash
cd coach
npm install
npm run dev      # http://localhost:5173/app/
npm test         # testy logiki
npm run build    # buduje do ../app — zbudowane pliki trzeba scommitować
```

## Dane

Na razie dane są zapisywane w `localStorage` przeglądarki (klucz `panel-trenera:v1`) — tylko na jednym urządzeniu.
Kopia zapasowa / import / wyczyszczenie danych: ikona ustawień w górnym pasku.
Każda zmiana przechodzi przez `Change` (upsert/delete rekordu kolekcji), więc podpięcie Supabase
to nowa implementacja `Repository` (kolekcja = tabela) + logowanie i reguły RLS.
