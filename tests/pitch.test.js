import { describe, it, expect } from 'vitest';
import { PitchDetector } from 'pitchy';
import { PitchTracker } from '../renderer/pitch.js';

const RATE = 48000;
const N = 2048; // matches PitchTracker's analyser.fftSize

// Cents between a detected and an expected frequency.
const cents = (got, want) => 1200 * Math.log2(got / want);

// Fill a buffer with a sine at `freq`.
function sine(freq, n = N, rate = RATE) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin((2 * Math.PI * freq * i) / rate);
  return buf;
}

describe('pitchy detector accuracy (synthetic sine, no mic/room)', () => {
  // This is the ground-truth check: on a clean signal the detector should be
  // within a couple cents. Anything worse in the live app is the acoustic path
  // (speaker -> mic -> room comb filtering) or the source, not the algorithm.
  const detector = PitchDetector.forFloat32Array(N);

  for (const f of [110, 165, 220, 330, 440, 660, 880]) {
    it(`reads ${f}Hz within 2 cents`, () => {
      const [pitch, clarity] = detector.findPitch(sine(f), RATE);
      expect(clarity).toBeGreaterThan(0.95);
      expect(Math.abs(cents(pitch, f))).toBeLessThan(2);
    });
  }
});

describe('PitchTracker._analyzeContour', () => {
  // Build a contour ring (raw {t, f} samples spaced like real ticks) that
  // oscillates around a center, the way a sung vibrato note actually looks.
  function vibratoContour(centerHz, extentCents, rateHz, ms, stepMs = 25) {
    const out = [];
    for (let t = 0; t <= ms; t += stepMs) {
      const c = extentCents * Math.sin((2 * Math.PI * rateHz * t) / 1000);
      out.push({ t, f: centerHz * Math.pow(2, c / 1200) });
    }
    return out;
  }

  function analyze(contour) {
    const tracker = new PitchTracker(() => {}); // constructor touches no DOM
    tracker.contour = contour;
    return tracker._analyzeContour(contour[contour.length - 1].t);
  }

  it('centers a vibrato near its true pitch (within a few cents)', () => {
    // The window rarely covers a whole number of vibrato cycles, so the center
    // carries a few cents of residual — inaudible and fine for scoring, which
    // is the whole point of averaging instead of reading the instantaneous f0.
    const res = analyze(vibratoContour(440, 80, 5.5, 600));
    expect(res).not.toBeNull();
    expect(Math.abs(cents(res.freq, 440))).toBeLessThan(6);
  });

  it('measures vibrato extent and rate in the right ballpark', () => {
    const res = analyze(vibratoContour(330, 70, 6, 600));
    expect(res.vibratoExtent).toBeGreaterThan(50);  // true amplitude 70c
    expect(res.vibratoExtent).toBeLessThan(90);
    expect(res.vibratoRate).toBeGreaterThan(4.5);    // true rate 6Hz
    expect(res.vibratoRate).toBeLessThan(7.5);
  });

  it('reports no vibrato for a steady tone', () => {
    const steady = Array.from({ length: 25 }, (_, i) => ({ t: i * 25, f: 220 }));
    const res = analyze(steady);
    expect(Math.abs(cents(res.freq, 220))).toBeLessThan(1);
    expect(res.vibratoExtent).toBeNull();
    expect(res.vibratoRate).toBeNull();
  });

  it('center pitch ignores a brief onset scoop (trimmed)', () => {
    // First ~100ms slides up from a semitone flat, then holds at 262Hz.
    const out = [];
    for (let t = 0; t <= 350; t += 25) {
      const flatBy = t < 100 ? (100 - t) / 100 : 0; // up to 1 semitone flat
      out.push({ t, f: 262 * Math.pow(2, -flatBy / 12) });
    }
    const res = analyze(out);
    expect(Math.abs(cents(res.freq, 262))).toBeLessThan(15);
  });
});
