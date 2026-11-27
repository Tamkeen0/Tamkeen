// Scripted fake browser speech for end-to-end tests.
// - Text-to-speech: records every utterance and finishes it asynchronously.
// - Recognition: plays back a script of what the student "says", one item per listen.
// - Tracks whether the microphone was ever opened while speech was playing.

/**
 * Script items:
 *   { say: 'next' }          recognised speech
 *   { error: 'no-speech' }   recogniser error code (not-allowed, network, …)
 *   { silence: true }        recogniser ends with no result
 *   { hang: true }           nothing happens (exercises timeouts / stopListening)
 *   { parts: ['a', 'b'], gapMs, error?, hang? }
 *                            dictation in parts with pauses; then silence, an error, or (hang) nothing
 */
export function createFakeSpeech({ synthesis = true, recognition = true } = {}) {
  const state = {
    spoken: [], // every utterance chunk, in order
    micOpenedWhileSpeaking: 0,
    listens: 0,
    speaking: 0,
    wordsHeard: 0, // dictation parts delivered so far
    script: [],
  };

  const synth = {
    speak(u) {
      state.speaking++;
      state.spoken.push(u.text);
      setTimeout(() => {
        state.speaking--;
        u.onend?.();
      }, 0);
    },
    cancel() {},
    getVoices: () => [],
  };

  class FakeRecognition {
    constructor() {
      this.onresult = this.onerror = this.onend = null;
    }
    start() {
      state.listens++;
      if (state.speaking > 0) state.micOpenedWhileSpeaking++;
      const item = state.script.shift();
      if (!item) throw new Error('fake speech script exhausted');
      if (item.parts) {
        // Dictation spoken in parts with short pauses: cumulative results, no explicit end.
        const finals = [];
        const emit = (i) => {
          if (i >= item.parts.length) {
            if (item.error) this.onerror?.({ error: item.error });
            return; // otherwise silence: the listener's end-of-speech timer finishes it
          }
          this.onspeechstart?.();
          state.wordsHeard++;
          finals.push(item.parts[i]);
          this.onresult?.({ results: finals.map((t) => Object.assign([{ transcript: t }], { isFinal: true })) });
          setTimeout(() => emit(i + 1), item.gapMs ?? 5);
        };
        setTimeout(() => emit(0), 0);
        return;
      }
      setTimeout(() => {
        if (item.say !== undefined) {
          this.onresult?.({ results: [Object.assign([{ transcript: item.say }], { isFinal: true })] });
          this.onend?.();
        } else if (item.error) {
          this.onerror?.({ error: item.error });
          this.onend?.();
        } else if (item.silence) {
          this.onend?.();
        }
        // hang: do nothing
      }, 0);
    }
    abort() {}
  }

  const env = {
    synthesis: synthesis ? synth : null,
    createUtterance: synthesis ? (text) => ({ text, lang: '', voice: null, onend: null, onerror: null }) : null,
    createRecognition: recognition ? () => new FakeRecognition() : null,
  };

  return {
    env,
    state,
    /** Queue what the student will say next. */
    student(...items) {
      for (const it of items) state.script.push(typeof it === 'string' ? { say: it } : it);
    },
    /** Everything spoken since the last call, as one string. */
    heardSince: (() => {
      let mark = 0;
      return () => {
        const out = state.spoken.slice(mark).join(' ');
        mark = state.spoken.length;
        return out;
      };
    })(),
  };
}

/** In-memory stand-in for the session API (contracts/API.md semantics). */
export function createFakeApi(exam) {
  const session = { id: 's1', exam, answers: {}, status: 'active' };
  const conflict = () => Object.assign(new Error('409 illegal state'), { status: 409 });
  return {
    session,
    putAnswer(questionId, text) {
      if (session.status === 'submitted') throw conflict();
      session.answers[questionId] = text; // verbatim, idempotent overwrite
    },
    submit() {
      if (session.status === 'submitted') throw conflict();
      session.status = 'submitted';
    },
  };
}
