# Odczyt zrzutu z Fitatu przez AI — konfiguracja (Supabase + Anthropic)

Po konfiguracji podopieczny w karcie **Jedzenie** dodaje zrzut ekranu z Fitatu (podsumowanie dnia), a aplikacja
sama wpisuje **kalorie, białko, tłuszcze i węglowodany**. Podopieczny sprawdza liczby i dopiero wtedy stuka
„Zapisz jedzenie”. Przy niepewnym odczycie widzi bursztynowe ostrzeżenie.

Bez tej konfiguracji wszystko działa jak dotąd — liczby przepisuje się ręcznie, a przycisk „Odczytaj z zrzutu”
po prostu pokaże komunikat „Odczyt AI nie jest skonfigurowany”.

Jak to działa:

- telefon zmniejsza zrzut (ok. 1200 px, JPEG) i wysyła go do funkcji **`read-screenshot`** w Supabase,
- funkcja sprawdza, czy to zalogowany trener albo podopieczny, liczy limit (**20 odczytów na konto dziennie**),
  przekazuje obraz do Claude (Anthropic, model `claude-haiku-5-5`) i zwraca same liczby,
- **zdjęcie nie jest nigdzie zapisywane przez funkcję** — jest tylko przetwarzane. (Sam zrzut nadal zapisuje się
  przy wpisie jak wcześniej, w koszyku `client-files` — to osobna, istniejąca funkcja aplikacji.)

> Klucz API Anthropic trafia **tylko** do sekretów funkcji w Supabase. Nigdy nie wpisuj go w aplikację,
> do repozytorium ani w wiadomości.

## 1. Utwórz klucz API w Anthropic

1. Wejdź na **https://console.anthropic.com** i załóż konto (albo zaloguj się).
2. **Settings → Billing**: dodaj kartę i doładuj konto (np. 5 USD — wystarczy na tysiące odczytów, patrz niżej).
   Warto od razu ustawić **limit wydatków** (Settings → Limits → spend limit), np. 5 USD miesięcznie.
3. **Settings → API Keys → Create Key** → nazwa np. `fitowa-odczyt` → **Create**.
4. Skopiuj klucz (zaczyna się od `sk-ant-…`). Pokazuje się tylko raz — jeśli go zgubisz, utwórz nowy.

## 2. Uruchom SQL (limit dzienny)

Supabase → **SQL Editor → New query** → wklej cały plik `supabase/hardening.sql` (albo tylko sekcję **30**) → **Run**.
Można uruchamiać wielokrotnie. Tworzy tabelę licznika `ai_usage` i funkcję `ai_quota_take`.

Bez tego kroku funkcja odmówi odczytu z komunikatem „Limit odczytów nie jest skonfigurowany”.

## 3. Dodaj sekret w Supabase

Supabase → **Edge Functions → Secrets** (Manage secrets) → **Add new secret**:

| nazwa | wartość |
|---|---|
| `ANTHROPIC_API_KEY` | klucz skopiowany w kroku 1 (`sk-ant-…`) |

Zapisz. (`SUPABASE_URL` i `SUPABASE_ANON_KEY` funkcja dostaje automatycznie — nic nie dodajesz.)

## 4. Utwórz funkcję Edge „read-screenshot” (przez panel, bez terminala)

Supabase → **Edge Functions → Deploy a new function → Via Editor**:

1. Nazwa funkcji: **`read-screenshot`** (dokładnie tak).
2. W pliku `index.ts` usuń przykładowy kod i wklej całą zawartość pliku
   `supabase/functions/read-screenshot/index.ts`.
3. **Deploy**.
4. Ustawienie **„Verify JWT” / „Enforce JWT verification”** może zostać **włączone** (domyślnie) — aplikacja wysyła
   token zalogowanej osoby. Funkcja i tak sama sprawdza token, więc jeśli kiedyś zobaczysz błędy 401 mimo
   zalogowania (np. po zmianie kluczy projektu), możesz je wyłączyć — bezpieczeństwo się nie zmienia.

(Alternatywa z terminala: `supabase functions deploy read-screenshot` w katalogu `coach`.)

## 5. Test

1. Zaloguj się w aplikacji jako podopieczny (albo trener → klient → „Tryb zawodnika”) na **sebastianpalej.pl**.
2. Karta **Jedzenie** → **Dodaj zrzut z Fitatu** → wybierz zrzut podsumowania dnia.
3. Po kilku sekundach pola się wypełnią i pojawi się ramka „Sprawdź liczby — odczyt automatyczny”.
4. Gdy coś nie działa: Supabase → Edge Functions → `read-screenshot` → **Logs**. Typowe komunikaty:
   - „Odczyt AI nie jest skonfigurowany” — brak sekretu `ANTHROPIC_API_KEY` (krok 3),
   - „Limit odczytów nie jest skonfigurowany” — nie uruchomiono sekcji 30 (krok 2),
   - „Odczyt AI jest źle skonfigurowany (klucz API)” — klucz błędny/usunięty albo brak środków na koncie Anthropic,
   - „Odczyt AI nie jest jeszcze włączony” — funkcja nie jest wdrożona albo ma inną nazwę (krok 4).

Podopieczny może wyłączyć automatyczny odczyt (pole „Odczytuj liczby ze zrzutu automatycznie” pod zrzutem)
i używać przycisku „Odczytaj z zrzutu” tylko wtedy, gdy chce.

## Koszt

Model `claude-haiku-5-5`: 0,10 USD za milion tokenów wejścia i 0,50 USD za milion tokenów wyjścia.
Jeden odczyt to ok. 1–2 tys. tokenów wejścia (zmniejszony zrzut + polecenie) i kilkaset tokenów wyjścia, czyli
**ok. 0,0003 USD — mniej więcej 0,1 grosza za odczyt** (rząd wielkości; sprawdź aktualny cennik na
https://www.anthropic.com/pricing).

Przykład: 20 podopiecznych × 1 odczyt dziennie × 30 dni = 600 odczytów ≈ **0,2 USD miesięcznie**.
Najgorszy przypadek przy limicie (20 odczytów × 20 osób × 30 dni) to ok. 4 USD miesięcznie.
Zużycie widać w console.anthropic.com → **Usage**.

Limit dzienny zmienisz w `index.ts` (stała `DAILY_LIMIT`, maks. 100) i wdrożysz funkcję ponownie.

## Wyłączenie

Wybierz jedno:

- **Najprościej**: Supabase → Edge Functions → Secrets → usuń `ANTHROPIC_API_KEY`. Odczyt przestaje działać
  od razu (komunikat „Odczyt AI nie jest skonfigurowany”), reszta aplikacji bez zmian.
- **Całkowicie**: Edge Functions → `read-screenshot` → **Delete function**, a w console.anthropic.com → API Keys
  usuń (Disable/Delete) klucz `fitowa-odczyt`.

Licznik z sekcji 30 można zostawić — nie przechowuje zdjęć, tylko liczbę odczytów na dzień (stare wpisy po 60 dniach
są usuwane). Usunięcie: `drop function public.ai_quota_take(text, int); drop table public.ai_usage;`.

## RODO

Zrzut (dane o jedzeniu) jest przekazywany do Anthropic jako podmiotu przetwarzającego wyłącznie w celu odczytu
liczb. Dopisz Anthropic do listy odbiorców w klauzuli informacyjnej (patrz raport z wdrożenia / plik
`src/components/Consents.tsx`, sekcja „Odbiorcy”) i — jeśli wymagasz — zaakceptuj warunki przetwarzania danych
(DPA) w console.anthropic.com. API Anthropic domyślnie nie używa przesłanych danych do trenowania modeli.
