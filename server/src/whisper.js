import fs from 'node:fs';

// Voice messages written out as text, by a Whisper container running next to Papote (nothing leaves the
// server). Off when WHISPER_URL isn't set. Works with onerahmet/openai-whisper-asr-webservice.

const HALLUCINATIONS = /amara\.org|sous-titr(es|age)\s+(r[ée]alis|fait|par)|merci d'avoir regard[ée]|abonnez-vous|n'oubliez pas de vous abonner|♪/i;

export function createWhisper({ url, language = 'fr', logger = console, fetchImpl = globalThis.fetch }) {
  const enabled = !!url;
  const base = url?.replace(/\/+$/, '');
  let chain = Promise.resolve();
  let pending = 0;

  async function transcribe(file, mime) {
    const form = new FormData();
    form.append('audio_file', new Blob([fs.readFileSync(file)], { type: mime }), 'vocal');
    const endpoint = `${base}/asr?task=transcribe&language=${encodeURIComponent(language)}&output=json&encode=true`;
    const res = await fetchImpl(endpoint, { method: 'POST', body: form, signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok) throw new Error(`Whisper : réponse ${res.status}`);
    const body = await res.json();
    const text = String(body.text ?? '').trim();
    // On silence or noise Whisper "hears" subtitle credits it learnt from videos: no transcript then.
    if (HALLUCINATIONS.test(text) && text.length < 120) return '';
    return text.slice(0, 4000);
  }

  /** One voice message at a time, so a burst of messages doesn't swamp the machine. */
  function queue(file, mime, done) {
    if (!enabled) return;
    pending++;
    chain = chain
      .then(() => transcribe(file, mime))
      .then((text) => done(text || null), (err) => {
        logger.error?.(err.message);
        done(null);
      })
      .finally(() => pending--);
  }

  async function health() {
    if (!enabled) return null;
    try {
      const res = await fetchImpl(`${base}/docs`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  return { enabled, queue, health, get pending() { return pending; } };
}
