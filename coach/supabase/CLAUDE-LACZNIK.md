# Łącznik Fitowej dla Claude

Podopieczny podłącza swojego Claude'a do Fitowej. Claude sam czyta jego plan, treningi, wizyty, pomiary, żywienie, nawyki i płatności. Łącznik tylko czyta dane.

## Jak to działa

- `functions/fitowa-mcp`: serwer MCP (Streamable HTTP). Adres: `https://pmsspumbjsapjqkvjscz.supabase.co/functions/v1/fitowa-mcp`. Wdrożony z `verify_jwt = false`, bo funkcja sama sprawdza token i odpowiada 401 z adresem metadanych OAuth.
- Logowanie: serwer OAuth 2.1 w Supabase Auth (beta, bezpłatny). Claude rejestruje się sam (dynamiczna rejestracja), a podopieczny loguje się kontem Fitowej i potwierdza dostęp na ekranie zgody w aplikacji (`src/auth/OAuthConsent.tsx`).
- Dane są czytane tokenem podopiecznego. Obowiązują te same zasady RLS co w aplikacji: podopieczny widzi tylko swoje dane.
- Sekcja 33 w `hardening.sql`: tokeny zewnętrznych aplikacji (claim `client_id`) niczego nie zapiszą w tabelach ani w plikach, także przez funkcje RPC.

## Jednorazowa konfiguracja w panelu Supabase

1. **Authentication → URL Configuration**: sprawdź **Site URL**. Powinno być `https://sebastianpalej.pl`.
2. **Authentication → OAuth Server**:
   - włącz **OAuth 2.1 server**;
   - ustaw **Authorization Path** na `/oauth/consent`. Razem z Site URL daje to adres `https://sebastianpalej.pl/oauth/consent`, który przekierowuje do `/app/`. Jeśli Site URL kończy się na `/app`, zadziała `/app/oauth/consent`; ta strona też istnieje;
   - włącz **Dynamic client registration**, bo Claude rejestruje się sam.
3. Co jakiś czas sprawdzaj listę zarejestrowanych klientów w tej samej zakładce.

## Co robi podopieczny

1. W Claude: **Ustawienia → Łączniki → Dodaj własny łącznik**.
2. Nazwa: `Fitowa`. Adres: `https://pmsspumbjsapjqkvjscz.supabase.co/functions/v1/fitowa-mcp`.
3. Klika **Połącz**, loguje się kontem Fitowej i klika **Zezwól**.
4. Pyta na przykład: „Jak mi idzie przysiad w ostatnich 2 miesiącach?” albo „Co mam jutro w planie?”.

Odebranie dostępu: usunięcie łącznika w Claude. Trener może też usunąć klienta w panelu OAuth Server.

## Narzędzia łącznika

`moj_profil`, `moj_plan`, `moje_treningi` (od, do, ćwiczenie, limit), `moje_wizyty`, `moje_pomiary`, `moje_zywienie_i_nawyki`, `moje_platnosci`.
