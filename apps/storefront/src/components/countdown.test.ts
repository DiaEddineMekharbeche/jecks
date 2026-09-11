import { describe, expect, it } from 'vitest';
import { splitDuration } from './countdown';

/**
 * The countdown's arithmetic and its placeholder.
 *
 * The placeholder is the part that matters beyond the maths: the server and the browser
 * must produce the same string on the first paint, and the only way to guarantee that
 * is for neither of them to consult the clock while rendering. `null` is what the server
 * knows, so `null` has to have a stable answer.
 */
describe('splitDuration', () => {
  it('gives a placeholder before the clock has been read', () => {
    expect(splitDuration(null).map((part) => part.value)).toEqual(['--', '--', '--', '--']);
  });

  it('keeps all four boxes in the placeholder, so nothing moves when the figures land', () => {
    expect(splitDuration(null).map((part) => part.label)).toEqual(['j', 'h', 'm', 's']);
    expect(splitDuration(90_061_000)).toHaveLength(4);
  });

  it('splits a day, an hour, a minute and a second', () => {
    // 1d 1h 1m 1s
    expect(splitDuration(90_061_000).map((part) => part.value)).toEqual(['01', '01', '01', '01']);
  });

  it('pads to two digits, because the boxes must not resize each second', () => {
    expect(splitDuration(9_000).map((part) => part.value)).toEqual(['00', '00', '00', '09']);
  });

  it('does not pad a figure that is already wider', () => {
    // Ten days out: the day box is allowed to be two digits and stay correct.
    expect(splitDuration(10 * 86_400_000)[0]?.value).toBe('10');
  });

  it('reads zero as zero rather than as a placeholder', () => {
    expect(splitDuration(0).map((part) => part.value)).toEqual(['00', '00', '00', '00']);
  });

  it('drops sub-second remainders instead of rounding a second up', () => {
    // 1500ms is one second remaining, not two: a countdown that shows 02 and then
    // vanishes looks broken.
    expect(splitDuration(1_500)[3]?.value).toBe('01');
  });

  it('falls back to the placeholder for a nonsense duration', () => {
    // `new Date('not a date').getTime()` is NaN, and a box reading "NaN" is worse than
    // one reading "--".
    expect(splitDuration(Number.NaN)[0]?.value).toBe('--');
    expect(splitDuration(-1)[0]?.value).toBe('--');
  });
});
