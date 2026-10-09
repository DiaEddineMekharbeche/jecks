// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The new-order chime, against a stand-in for the browser's audio. What matters is the part
 * a person would otherwise find out in production: a tone says so when the browser is still
 * blocking audio, and never throws into the screen it plays on.
 */

class FakeParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

let started = 0;
let state: 'running' | 'suspended' = 'running';

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  get state() {
    return state;
  }
  resume = vi.fn(async () => {
    if (!blocked) state = 'running';
  });
  createOscillator() {
    return {
      type: 'sine',
      frequency: new FakeParam(),
      connect: (node: unknown) => node,
      start: () => {
        started += 1;
      },
      stop: vi.fn(),
    };
  }
  createGain() {
    return { gain: new FakeParam(), connect: (node: unknown) => node };
  }
}

let blocked = false;

beforeEach(() => {
  vi.resetModules();
  started = 0;
  state = 'running';
  blocked = false;
  vi.stubGlobal('AudioContext', FakeAudioContext);
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('playTone', () => {
  it('plays a note per entry of the tone, and reports that it played', async () => {
    const { playTone } = await import('./alert-sound');

    expect(await playTone('carillon')).toBe(true);
    expect(started).toBe(4);
  });

  it('plays each tone, and each one is different', async () => {
    const { playTone } = await import('./alert-sound');
    const counts: number[] = [];

    for (const id of ['carillon', 'cloche', 'alerte'] as const) {
      started = 0;
      await playTone(id);
      counts.push(started);
    }

    expect(counts.every((count) => count > 0)).toBe(true);
    expect(new Set(counts).size).toBeGreaterThan(1);
  });

  it('says so when the browser is still blocking audio, instead of staying silent', async () => {
    state = 'suspended';
    blocked = true;
    const { playTone } = await import('./alert-sound');

    expect(await playTone('carillon')).toBe(false);
    expect(started).toBe(0);
  });

  it('plays once a click has unlocked it', async () => {
    state = 'suspended';
    const { playTone, unlockAudio } = await import('./alert-sound');

    unlockAudio();
    expect(await playTone('alerte')).toBe(true);
  });

  it('does not throw into the screen when there is no audio at all', async () => {
    vi.stubGlobal('AudioContext', undefined);
    (window as unknown as { AudioContext: unknown }).AudioContext = undefined;
    const { playTone } = await import('./alert-sound');

    await expect(playTone('carillon')).resolves.toBe(false);
  });
});

describe('isToneId', () => {
  it('accepts the three tones and nothing else, so a stale stored value falls back', async () => {
    const { isToneId } = await import('./alert-sound');

    expect(isToneId('cloche')).toBe(true);
    expect(isToneId('sirene')).toBe(false);
    expect(isToneId(null)).toBe(false);
  });
});
