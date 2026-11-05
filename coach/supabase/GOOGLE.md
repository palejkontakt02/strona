# Arkusze Google ↔ plan — konfiguracja (jednorazowo, ok. 10 min)

Po konfiguracji w karcie planu pojawia się przycisk **„Do Arkuszy Google” / „Arkusz Google”**:
utworzenie arkusza z planem, **Pobierz zmiany z arkusza** (arkusz → ten sam plan, z podglądem różnic)
i **Wyślij plan do arkusza** (aplikacja → arkusz).

- Aplikacja ma uprawnienie `drive.file`: widzi **tylko arkusze, które sama utworzyła** — nie resztę Dysku.
- Token logowania Google jest tylko w pamięci karty przeglądarki (ok. 1 godz.), nigdzie nie jest zapisywany.
- Nie potrzeba żadnego sekretu ani serwera. Identyfikator klienta (Client ID) jest jawny z założenia.

## 1. Projekt
<https://console.cloud.google.com/> → wybór projektu u góry → **Nowy projekt** → nazwa np. `Fitowa` → **Utwórz**.

## 2. Włącz Google Sheets API
**Interfejsy API i usługi → Biblioteka** → wyszukaj **Google Sheets API** → **Włącz**.

## 3. Ekran zgody (Google Auth Platform)
**Interfejsy API i usługi → Ekran zgody OAuth** (albo **Google Auth Platform**) → **Rozpocznij**:
- Nazwa aplikacji: `Fitowa`, e-mail pomocy: Twój e-mail.
- Odbiorcy: **Zewnętrzni**.
- Kontakt: Twój e-mail → **Utwórz**.
- **Odbiorcy → Użytkownicy testowi → Dodaj użytkowników** → Twój adres Gmail (konto, którym będziesz się logować do Arkuszy).
- (Dostęp do danych / zakresy — nic nie trzeba dodawać; aplikacja prosi tylko o `drive.file`.)

Status „Testowanie” wystarczy: logują się tylko dodani użytkownicy testowi; przy logowaniu Google pokaże ostrzeżenie
„aplikacja niezweryfikowana” → **Kontynuuj**.

## 4. Identyfikator klienta
**Klienci** (albo **Dane logowania → Utwórz dane logowania → Identyfikator klienta OAuth**):
- Typ aplikacji: **Aplikacja internetowa**, nazwa: `Fitowa`.
- **Autoryzowane źródła JavaScriptu**: `https://sebastianpalej.pl` (bez ukośnika na końcu; jeśli używasz też `www`, dodaj `https://www.sebastianpalej.pl`).
- Identyfikatory URI przekierowania — puste.
- **Utwórz** → skopiuj **Identyfikator klienta** (kończy się na `.apps.googleusercontent.com`).

## 5. Wpisz identyfikator w aplikacji
`src/data/config.ts` → `GOOGLE_CLIENT_ID` (albo przekaż go osobie, która wdraża aplikację) → zbuduj i wdroż.

## Jak tego używać
1. Karta podopiecznego → **Plan** → **Do Arkuszy Google** → **Utwórz arkusz Google** (pierwszy raz Google zapyta o zgodę).
2. **Otwórz arkusz** — zakładka „Plan”: wiersz = ćwiczenie i grupa serii (Serie, Powt., Ciężar, RPE, Przerwa, Uwagi…).
   Nie zmieniaj nagłówków. Nowe ćwiczenie = nowy wiersz z tym samym tygodniem i treningiem.
3. W aplikacji **Arkusz Google → Pobierz zmiany z arkusza** → sprawdź listę zmian → **Zapisz zmiany w planie**.
4. Po zmianach w edytorze planu: **Wyślij plan do arkusza** (nadpisuje zakładkę „Plan”).
