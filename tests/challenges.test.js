import { describe, it, expect } from 'vitest';
import { isMatch, noteToMidi, expandChallenge, ChallengeRunner } from '../renderer/challenges.js';

describe('noteToMidi', () => {
  it('returns 69 for A4', () => {
    expect(noteToMidi('A4')).toBe(69);
  });
  it('returns 60 for C4 (middle C)', () => {
    expect(noteToMidi('C4')).toBe(60);
  });
  it('returns null for garbage', () => {
    expect(noteToMidi('xxx')).toBeNull();
  });
});

describe('isMatch', () => {
  it('matches exact pitch within tolerance', () => {
    expect(isMatch(60, 0, 60, 50)).toBe(true);
    expect(isMatch(60, 30, 60, 50)).toBe(true);
    expect(isMatch(60, -49, 60, 50)).toBe(true);
  });
  it('rejects pitch outside tolerance with no octave wrap', () => {
    expect(isMatch(60, 51, 60, 50)).toBe(false);
    expect(isMatch(61, 0, 60, 50)).toBe(false);
  });
  it('matches at +1 octave when octaveTolerance >= 1', () => {
    expect(isMatch(72, 0, 60, 50, 1)).toBe(true);
    expect(isMatch(72, 0, 60, 50, 0)).toBe(false);
  });
  it('matches at -1 octave when octaveTolerance >= 1', () => {
    expect(isMatch(48, 0, 60, 50, 1)).toBe(true);
  });
  it('handles null midi (no detected pitch)', () => {
    expect(isMatch(null, 0, 60, 50)).toBe(false);
  });
});

describe('expandChallenge', () => {
  it('materializes targetMidi for hold', () => {
    const c = expandChallenge({ type: 'hold', target: 'C4', holdMs: 1000 });
    expect(c.targetMidi).toBe(60);
    expect(c.toleranceCents).toBe(60); // default
    expect(c.octaveTolerance).toBe(0);  // default
  });
  it('materializes from/to/checkpoints midi for slide', () => {
    const c = expandChallenge({
      type: 'slide', from: 'C3', to: 'G3',
      checkpoints: ['C3', 'E3', 'G3'], toleranceCents: 90
    });
    expect(c.fromMidi).toBe(48);
    expect(c.toMidi).toBe(55);
    expect(c.checkpointsMidi).toEqual([48, 52, 55]);
    expect(c.toleranceCents).toBe(90);
  });
  it('materializes sequence midi for scale', () => {
    const c = expandChallenge({ type: 'scale', sequence: ['C3', 'D3', 'E3'] });
    expect(c.sequenceMidi).toEqual([48, 50, 52]);
  });
});

describe('ChallengeRunner — hold', () => {
  it('progresses to passed after enough in-target time', () => {
    const r = new ChallengeRunner({ type: 'hold', target: 'A2', holdMs: 200, toleranceCents: 50 });
    r.begin();
    // Hand-tick with a controlled dt by sleeping briefly — but in tests we
    // can just patch lastTickAt manually to simulate elapsed time.
    r.lastTickAt = performance.now() - 250; // pretend 250ms passed in-target
    r.tick(45, 0, -30); // A2 = midi 45
    expect(r.status).toBe('passed');
  });
  it('does not progress when off pitch', () => {
    const r = new ChallengeRunner({ type: 'hold', target: 'A2', holdMs: 200, toleranceCents: 50 });
    r.begin();
    r.lastTickAt = performance.now() - 250;
    r.tick(50, 0, -30); // way off
    expect(r.status).toBe('active');
  });
});

describe('ChallengeRunner — pause/resume', () => {
  it('pause halts ticking', () => {
    const r = new ChallengeRunner({ type: 'hold', target: 'A2', holdMs: 500, toleranceCents: 50 });
    r.begin();
    r.pause();
    expect(r.status).toBe('paused');
    r.lastTickAt = performance.now() - 1000;
    r.tick(45, 0, -30);
    expect(r.status).toBe('paused'); // no progress while paused
  });
  it('resume re-enables ticking', () => {
    const r = new ChallengeRunner({ type: 'hold', target: 'A2', holdMs: 200, toleranceCents: 50 });
    r.begin();
    r.pause();
    r.resume();
    expect(r.status).toBe('active');
    r.lastTickAt = performance.now() - 250;
    r.tick(45, 0, -30);
    expect(r.status).toBe('passed');
  });
});
