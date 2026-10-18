/**
 * Ankieta przy zakładaniu konta (wypełnia podopieczny): zdrowie, styl życia, odżywianie,
 * sport i cele. Odpowiedzi trafiają do profilu (`Client.intake`) — trener je widzi.
 */
export type IntakeField = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'yesno' | 'scale';
  options?: string[];
  placeholder?: string;
  hint?: string;
  /** Pole pokazuje się tylko przy odpowiedzi „tak” na podane pytanie. */
  ifYes?: string;
};

export type IntakeSection = { id: string; title: string; intro?: string; fields: IntakeField[] };

export const INTAKE: IntakeSection[] = [
  {
    id: 'health',
    title: 'Zdrowie',
    intro: 'Odpowiedz szczerze — to dla Twojego bezpieczeństwa. Widzi to tylko Twój trener.',
    fields: [
      { key: 'parq_heart', label: 'Czy lekarz stwierdził u Ciebie chorobę serca lub nadciśnienie?', type: 'yesno' },
      { key: 'parq_chest', label: 'Czy odczuwasz ból w klatce piersiowej w spoczynku, w codziennych czynnościach lub przy wysiłku?', type: 'yesno' },
      { key: 'parq_dizzy', label: 'Czy w ostatnich 12 miesiącach miałeś(-aś) zawroty głowy z utratą równowagi albo straciłeś(-aś) przytomność?', type: 'yesno' },
      { key: 'parq_chronic', label: 'Czy masz rozpoznaną inną chorobę przewlekłą (np. cukrzyca, astma, osteoporoza, tarczyca)?', type: 'yesno' },
      { key: 'chronic_what', label: 'Jaka to choroba?', type: 'text', ifYes: 'parq_chronic' },
      { key: 'parq_meds', label: 'Czy przyjmujesz leki na stałe?', type: 'yesno' },
      { key: 'meds_what', label: 'Jakie leki?', type: 'text', ifYes: 'parq_meds' },
      { key: 'parq_joints', label: 'Czy masz problem z kośćmi, stawami lub mięśniami, który może się nasilić przy wysiłku?', type: 'yesno' },
      { key: 'parq_supervised', label: 'Czy lekarz zalecił Ci aktywność tylko pod nadzorem medycznym?', type: 'yesno' },
      { key: 'injuries', label: 'Przebyte urazy, operacje, złamania', type: 'textarea', placeholder: 'np. 2019 skręcenie kostki P, 2022 artroskopia kolana L' },
      { key: 'pain_now', label: 'Czy coś Cię teraz boli? Gdzie i jak mocno (0–10)?', type: 'textarea', placeholder: 'np. dolny odcinek pleców 3/10 po długim siedzeniu' },
      { key: 'pregnancy', label: 'Ciąża lub okres do 6 mies. po porodzie', type: 'select', options: ['nie dotyczy', 'nie', 'tak — ciąża', 'tak — po porodzie'] },
      { key: 'other_health', label: 'Coś jeszcze, o czym trener powinien wiedzieć?', type: 'textarea', placeholder: 'np. alergie, migreny, problemy z ciśnieniem' },
    ],
  },
  {
    id: 'life',
    title: 'Styl życia',
    fields: [
      { key: 'work', label: 'Praca', type: 'select', options: ['głównie siedząca', 'mieszana', 'głównie stojąca / chodzona', 'fizyczna'] },
      { key: 'sleep_h', label: 'Ile średnio śpisz (godz.)?', type: 'number', placeholder: 'np. 7' },
      { key: 'sleep_q', label: 'Jakość snu', type: 'scale', hint: '1 = bardzo zła · 5 = świetna' },
      { key: 'stress', label: 'Poziom stresu na co dzień', type: 'scale', hint: '1 = bardzo niski · 5 = bardzo wysoki' },
      { key: 'steps', label: 'Ile kroków dziennie (jeśli wiesz)?', type: 'number', placeholder: 'np. 6000' },
      { key: 'smoking', label: 'Palenie', type: 'select', options: ['nie palę', 'okazjonalnie', 'codziennie', 'rzuciłem(-am)'] },
      { key: 'alcohol', label: 'Alkohol', type: 'select', options: ['nie piję', 'okazjonalnie', '1–2 razy w tygodniu', 'częściej'] },
    ],
  },
  {
    id: 'food',
    title: 'Odżywianie',
    fields: [
      { key: 'meals', label: 'Ile posiłków dziennie jesz?', type: 'select', options: ['1–2', '3', '4', '5 i więcej', 'różnie'] },
      { key: 'water', label: 'Ile wody pijesz dziennie (litry)?', type: 'number', placeholder: 'np. 1,5' },
      { key: 'diet', label: 'Dieta lub ograniczenia', type: 'text', placeholder: 'np. wegetariańska, bez laktozy, nietolerancje' },
      { key: 'snacking', label: 'Podjadanie / słodycze', type: 'select', options: ['rzadko', 'kilka razy w tygodniu', 'codziennie'] },
      { key: 'supplements', label: 'Suplementy', type: 'text', placeholder: 'np. witamina D, kreatyna, białko' },
      { key: 'food_goal', label: 'Co chcesz zmienić w jedzeniu?', type: 'textarea', placeholder: 'np. regularne posiłki, mniej słodyczy, więcej białka' },
    ],
  },
  {
    id: 'sport',
    title: 'Sport i przeszłość',
    fields: [
      { key: 'activity_now', label: 'Jaka jest Twoja obecna aktywność?', type: 'textarea', placeholder: 'np. 2× siłownia, spacery z psem, rower w weekend' },
      { key: 'activity_freq', label: 'Ile razy w tygodniu ćwiczysz teraz?', type: 'select', options: ['wcale', '1', '2', '3', '4 i więcej'] },
      { key: 'gym_level', label: 'Doświadczenie z treningiem siłowym', type: 'select', options: ['brak', 'początkujący (< 6 mies.)', 'średniozaawansowany (do 2 lat)', 'zaawansowany (2+ lata)'] },
      { key: 'sport_past', label: 'Sporty w przeszłości (co, jak długo, jaki poziom)', type: 'textarea', placeholder: 'np. piłka nożna 8 lat w klubie, pływanie w liceum' },
      { key: 'likes', label: 'Ćwiczenia / aktywności, które lubisz', type: 'text' },
      { key: 'dislikes', label: 'Czego nie lubisz albo czego się obawiasz?', type: 'text' },
    ],
  },
  {
    id: 'goals',
    title: 'Cele',
    fields: [
      { key: 'goal', label: 'Twój główny cel', type: 'select', options: ['redukcja tkanki tłuszczowej', 'budowa mięśni / siły', 'zdrowie i samopoczucie', 'powrót po kontuzji', 'wyniki w sporcie', 'inny'] },
      { key: 'goal_detail', label: 'Opisz cel własnymi słowami', type: 'textarea', placeholder: 'np. −8 kg do wakacji, wejść po schodach bez zadyszki' },
      { key: 'goal_when', label: 'Do kiedy?', type: 'text', placeholder: 'np. czerwiec 2027' },
      { key: 'motivation', label: 'Dlaczego to dla Ciebie ważne?', type: 'textarea' },
      { key: 'days_week', label: 'Ile treningów w tygodniu realnie dasz radę?', type: 'select', options: ['1', '2', '3', '4', '5+'] },
      { key: 'time_pref', label: 'Kiedy najchętniej trenujesz?', type: 'select', options: ['rano', 'w ciągu dnia', 'po południu', 'wieczorem', 'różnie'] },
    ],
  },
];

/** Klucze PAR-Q w ankiecie — „tak” przy którymkolwiek = przed intensywnym treningiem zgoda lekarza. */
export const INTAKE_PARQ = INTAKE[0].fields.filter((f) => f.key.startsWith('parq_')).map((f) => f.key);

export interface Intake {
  answers: Record<string, string>;
  /** Zgoda na przetwarzanie danych o zdrowiu (data ISO). */
  consentAt?: string;
  completedAt?: string;
  updatedAt?: string;
}

export const parqYesCount = (i: Intake | undefined) => INTAKE_PARQ.filter((k) => i?.answers[k] === 'tak').length;

/** Ile pytań (widocznych) ma odpowiedź — do paska postępu. */
export function intakeProgress(i: Intake | undefined): { done: number; total: number } {
  const vis = INTAKE.flatMap((s) => s.fields).filter((f) => !f.ifYes || i?.answers[f.ifYes] === 'tak');
  return { done: vis.filter((f) => (i?.answers[f.key] ?? '').trim() !== '').length, total: vis.length };
}
