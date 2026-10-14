/** Adres trenera — ten sam, na który trafia formularz kontaktowy ze strony. */
const TRAINER_MAIL = 'kontakt@sebastianpalej.com';

/**
 * Wiadomość od podopiecznego na e-mail trenera (FormSubmit — jak formularz na stronie).
 * Zwraca false, gdy wysyłka się nie udała (np. brak internetu); notatka i tak zostaje w aplikacji.
 */
export async function emailTrainer(name: string, replyTo: string | undefined, text: string): Promise<boolean> {
  if (typeof fetch === 'undefined' || location.hostname === 'localhost') return false;
  try {
    const res = await fetch(`https://formsubmit.co/ajax/${TRAINER_MAIL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject: `Notatka od podopiecznego: ${name}`,
        _template: 'box',
        _captcha: 'false',
        ...(replyTo ? { _replyto: replyTo } : {}),
        Podopieczny: name,
        Wiadomość: text,
      }),
    });
    const data = (await res.json().catch(() => null)) as { success?: string | boolean } | null;
    return res.ok && data?.success !== false && data?.success !== 'false';
  } catch {
    return false;
  }
}
