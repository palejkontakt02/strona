# Powiadomienia push na telefon — konfiguracja (Supabase)

Po konfiguracji telefon dostaje powiadomienia także przy zamkniętej aplikacji:

- **trener**: nowa wiadomość od podopiecznego, nowa / zmieniona ankieta, raport tygodniowy, trening z bólem od 5/10;
- **podopieczny**: odpowiedź trenera, komentarz trenera do treningu, nowy trening zadany na dzień, nowa wizyta /
  zmiana terminu / odwołanie, a o 7:00 „Masz dziś trening” (jeśli ma wizytę albo trening na dziś).

Bez tej konfiguracji aplikacja działa normalnie — po prostu nie wysyła powiadomień.

> Nigdzie nie jest potrzebny klucz `service_role` ani hasło do bazy. Nie wklejaj ich w aplikację ani w funkcję.

## 1. Włącz rozszerzenia

Supabase → **Database → Extensions** → wyszukaj i włącz:

- **pg_net** — baza wysyła zdarzenia do funkcji (wymagane),
- **pg_cron** — poranne przypomnienia o 7:00 (opcjonalne).

## 2. Uruchom SQL

**SQL Editor → New query** → wklej cały plik `supabase/hardening.sql` (albo tylko sekcje 19 i 20) → **Run**.
Można uruchamiać wielokrotnie. Jeśli pg_cron nie jest włączone, zobaczysz komunikat — przypomnienia poranne
po prostu się nie zaplanują (po włączeniu pg_cron uruchom sekcję 20 jeszcze raz).

Potem w tym samym edytorze odczytaj **wspólny sekret** (baza → funkcja):

```sql
select value from public.push_config where key = 'secret';
```

Skopiuj wynik — przyda się w kroku 4.

Jeśli adres projektu jest inny niż `https://pmsspumbjsapjqkvjscz.supabase.co`, popraw adres funkcji:

```sql
update public.push_config set value = 'https://TWOJ-PROJEKT.supabase.co/functions/v1/send-push' where key = 'url';
```

## 3. Utwórz funkcję Edge „send-push”

**Edge Functions → Deploy a new function → Via Editor**:

1. Nazwa funkcji: **`send-push`** (dokładnie tak).
2. Plik `index.ts` — wklej zawartość `supabase/functions/send-push/index.ts`.
3. Dodaj drugi plik **`webpush.ts`** (przycisk dodania pliku w edytorze) — wklej `supabase/functions/send-push/webpush.ts`.
4. **Deploy**.
5. W ustawieniach funkcji (Details / Settings) **wyłącz „Enforce JWT verification” / „Verify JWT”** — baza
   uwierzytelnia się wspólnym sekretem w nagłówku `x-push-secret`, nie tokenem logowania.

(Alternatywa z terminala: `supabase functions deploy send-push --no-verify-jwt` w katalogu `coach`.)

Funkcja nie ma żadnych zależności (szyfrowanie Web Push i podpis VAPID na wbudowanym WebCrypto) i nie czyta bazy —
dostaje od bazy listę telefonów i treść powiadomienia.

## 4. Ustaw sekrety funkcji

**Edge Functions → Secrets** (Manage secrets) → dodaj:

| nazwa | wartość |
|---|---|
| `VAPID_PUBLIC_KEY` | `BK9HmOcEHVlUor9l9Bdh_fJAZULa-tgxz3Ux-RCbXvZ6jbC3dyQ8b9GFy-kFLrqni_wiFWambuc4d92O7TPlm6I` (ten sam co w `src/data/config.ts`) |
| `VAPID_PRIVATE_KEY` | klucz prywatny pary VAPID — dostajesz go osobno (plik `VAPID_PRIVATE_KEY.txt`); **nigdy nie wpisuj go do repozytorium** |
| `VAPID_SUBJECT` | `mailto:` + Twój e-mail, np. `mailto:kontakt@sebastianpalej.pl` |
| `PUSH_HOOK_SECRET` | sekret odczytany w kroku 2 |

## 5. Włącz powiadomienia na telefonie

- **Trener**: aplikacja → ⚙ **Ustawienia** → „Powiadomienia na tym telefonie” → włącz → zezwól.
- **Podopieczny**: aplikacja → **🎨 Wygląd** → „Powiadomienia na tym telefonie” → włącz → zezwól.
- **iPhone (iOS 16.4+)**: najpierw w Safari **Udostępnij → Do ekranu początkowego**, otwórz aplikację z tej ikony
  i dopiero tam włącz powiadomienia. W zwykłej karcie Safari iOS nie pozwala na powiadomienia.
- Android: Chrome (karta albo aplikacja dodana do ekranu) — działa od razu.

Każdy telefon włącza powiadomienia osobno (można mieć kilka urządzeń).

## 6. Test

W **SQL Editor** (po włączeniu powiadomień na telefonie trenera):

```sql
select public.push_send('trainer', null, 'Test', 'Powiadomienia działają!', '/app/', 'test');
-- wynik wysyłki (kilka sekund później):
select id, status_code, content from net._http_response order by id desc limit 5;
```

`status_code` 200 i `"sent":1` w treści = powiadomienie poszło. 401 = zły `PUSH_HOOK_SECRET` (albo włączone
„Verify JWT”), 500 „VAPID keys not configured” = brak sekretów VAPID.

Poranne przypomnienie na żądanie (wyśle tym, którzy mają dziś wizytę / trening):

```sql
select public.push_daily_reminders();
```

## Wyłączenie

- Poranne przypomnienia: `select cron.unschedule('fitowa-push-daily');`
- Wszystkie powiadomienia: `update public.push_config set value = '' where key = 'url';`
  (włączenie z powrotem: wpisz adres funkcji jak w kroku 2).

## Jak to działa (dla ciekawych)

- Telefon zapisuje swoją subskrypcję w tabeli `push_subscriptions` (funkcja `save_push_subscription`; każdy widzi
  i usuwa tylko swoje urządzenia).
- Wyzwalacze na `clients`, `sessions`, `plans`, `appointments` rozpoznają zdarzenie i przez `pg_net` wywołują funkcję
  `send-push` z listą telefonów odbiorcy. Duże importy (ponad 20–30 wierszy naraz) nie wysyłają powiadomień,
  seria wizyt = jedno powiadomienie, a błąd wysyłki nigdy nie blokuje zapisu danych.
- Wygasłe subskrypcje (telefon cofnął zgodę) funkcja usuwa sama (`push_gone`, sprawdza wspólny sekret).
- Przypomnienie: pg_cron uruchamia `push_daily_tick()` o 5:00 i 6:00 UTC, a funkcja wysyła tylko wtedy, gdy w Polsce
  jest 7:00 (lato / zima).
- Zmiana pary kluczy VAPID: nowy klucz publiczny w `src/data/config.ts` i w sekretach, prywatny w sekretach; każdy
  telefon musi jeszcze raz włączyć przełącznik (aplikacja sama odnowi subskrypcję).
