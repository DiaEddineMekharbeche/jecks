/**
 * The sound that says "a new order just arrived".
 *
 * Synthesised with the Web Audio API rather than shipped as audio files: nothing to
 * download, nothing to host, nothing a CDN or an ad blocker can lose, and each tone is a
 * few numbers that can be read and changed.
 *
 * Browsers refuse to play audio on a page the user has not touched. The first click or key
 * press anywhere in the admin unlocks it (`unlockAudio`); until then a tone reports that it
 * could not play, so the screen can say why instead of staying silent.
 */

export type ToneId = 'carillon' | 'cloche' | 'alerte';

export const TONES: Array<{ id: ToneId; label: string; hint: string }> = [
  { id: 'carillon', label: 'Carillon', hint: 'Quatre notes montantes, douces' },
  { id: 'cloche', label: 'Cloche', hint: 'Une cloche, deux fois' },
  { id: 'alerte', label: 'Alerte', hint: 'Deux bips nets, difficiles à manquer' },
];

export const DEFAULT_TONE: ToneId = 'carillon';

interface Note {
  /** Hz. */
  frequency: number;
  /** Seconds after the start of the tone. */
  at: number;
  /** Seconds the note rings for. */
  length: number;
  type: OscillatorType;
  /** 0 to 1, before the master volume. */
  gain: number;
}

const MASTER = 0.22;

/** A bell is a note plus partials that are not whole multiples of it, which is what makes it a bell. */
function bell(frequency: number, at: number): Note[] {
  return [
    { frequency, at, length: 1.1, type: 'sine', gain: 1 },
    { frequency: frequency * 2.76, at, length: 0.7, type: 'sine', gain: 0.35 },
    { frequency: frequency * 5.4, at, length: 0.35, type: 'sine', gain: 0.15 },
  ];
}

const SCORES: Record<ToneId, Note[]> = {
  // C5 E5 G5 C6: a rising major arpeggio.
  carillon: [
    { frequency: 523.25, at: 0, length: 0.5, type: 'sine', gain: 0.9 },
    { frequency: 659.25, at: 0.14, length: 0.5, type: 'sine', gain: 0.9 },
    { frequency: 783.99, at: 0.28, length: 0.5, type: 'sine', gain: 0.9 },
    { frequency: 1046.5, at: 0.42, length: 0.9, type: 'sine', gain: 1 },
  ],
  cloche: [...bell(880, 0), ...bell(880, 0.75)],
  alerte: [
    { frequency: 988, at: 0, length: 0.16, type: 'triangle', gain: 1 },
    { frequency: 740, at: 0.2, length: 0.16, type: 'triangle', gain: 1 },
    { frequency: 988, at: 0.5, length: 0.16, type: 'triangle', gain: 1 },
    { frequency: 740, at: 0.7, length: 0.2, type: 'triangle', gain: 1 },
  ],
};

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  const Constructor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Constructor) return null;
  context = new Constructor();
  return context;
}

/** Called on the first click or key press: the only moment a browser lets audio start. */
export function unlockAudio(): void {
  const ctx = audioContext();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

/** True when a tone would actually be heard right now. */
export function audioReady(): boolean {
  return context?.state === 'running';
}

/**
 * Plays a tone. Resolves false when the browser is still blocking audio, so the caller can
 * tell the operator; it never throws, because a sound must not break the screen it is on.
 */
export async function playTone(id: ToneId): Promise<boolean> {
  try {
    const ctx = audioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') await ctx.resume();
    if (ctx.state !== 'running') return false;

    const start = ctx.currentTime + 0.02;
    for (const note of SCORES[id] ?? SCORES[DEFAULT_TONE]) {
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      const from = start + note.at;
      const peak = note.gain * MASTER;

      oscillator.type = note.type;
      oscillator.frequency.setValueAtTime(note.frequency, from);

      // A short ramp up and an exponential fall: a note that starts or stops instantly clicks.
      envelope.gain.setValueAtTime(0.0001, from);
      envelope.gain.exponentialRampToValueAtTime(peak, from + 0.015);
      envelope.gain.exponentialRampToValueAtTime(0.0001, from + note.length);

      oscillator.connect(envelope).connect(ctx.destination);
      oscillator.start(from);
      oscillator.stop(from + note.length + 0.05);
    }
    return true;
  } catch {
    return false;
  }
}

export function isToneId(value: unknown): value is ToneId {
  return TONES.some((tone) => tone.id === value);
}
