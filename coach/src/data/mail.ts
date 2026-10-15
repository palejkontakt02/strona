/** Adres trenera — ten sam, na który trafia formularz kontaktowy ze strony. */
const TRAINER_MAIL = 'kontakt@sebastianpalej.com';

/**
 * Wiadomość od podopiecznego na e-mail trenera (FormSubmit — jak formularz na stronie).
 * Zwraca 'failed', gdy wysyłka się nie udała (np. brak internetu), 'skipped' w podglądzie lokalnym.
 */
export async function emailTrainer(name: string, replyTo: string | undefined, text: string): Promise<'sent' | 'failed' | 'skipped'> {
  // podgląd lokalny — bez wysyłki
  if (typeof fetch === 'undefined' || location.hostname === 'localhost' || location.protocol === 'file:') return 'skipped';
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
    return res.ok && data?.success !== false && data?.success !== 'false' ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
