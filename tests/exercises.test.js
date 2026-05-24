import { describe, it, expect } from 'vitest';
import {
  noteToFreq,
  freqToNote,
  semitoneShift,
  ROUTINE,
  totalChallengeCount,
  VOICE_TYPE_OFFSET,
  transposeChallenge,
  transposeRoutine
} from '../renderer/exercises.js';

describe('noteToFreq', () => {
  it('returns 440 for A4', () => {
    expect(noteToFreq('A4')).toBeCloseTo(440, 6);
  });
  it('returns 261.625... for C4 (middle C)', () => {
    expect(noteToFreq('C4')).toBeCloseTo(261.6256, 3);
  });
  it('handles sharps and flats', () => {
    expect(noteToFreq('A#4')).toBeCloseTo(noteToFreq('Bb4'), 6);
    expect(noteToFreq('G#3')).toBeCloseTo(noteToFreq('Ab3'), 6);
  });
  it('returns null for malformed input', () => {
    expect(noteToFreq('H4')).toBeNull();
    expect(noteToFreq('hello')).toBeNull();
  });
});

describe('freqToNote', () => {
  it('returns A4 for 440', () => {
    const n = freqToNote(440);
    expect(n.name).toBe('A4');
    expect(n.midi).toBe(69);
    expect(n.cents).toBe(0);
  });
  it('roundtrips with noteToFreq for a range of notes', () => {
    for (const name of ['C2', 'E2', 'A2', 'D3', 'G3', 'C4', 'E4', 'A4', 'C5']) {
      const f = noteToFreq(name);
      const back = freqToNote(f);
      expect(back.name).toBe(name);
      expect(back.cents).toBe(0);
    }
  });
  it('reports positive cents for sharp pitches', () => {
    const f = noteToFreq('A4') * Math.pow(2, 25 / 1200); // +25 cents
    const n = freqToNote(f);
    expect(n.name).toBe('A4');
    expect(n.cents).toBe(25);
  });
  it('returns null for non-positive freq', () => {
    expect(freqToNote(0)).toBeNull();
    expect(freqToNote(-100)).toBeNull();
  });
});

describe('semitoneShift', () => {
  it('shifts up an octave', () => {
    expect(semitoneShift('C3', 12)).toBe('C4');
  });
  it('shifts down a perfect fifth', () => {
    expect(semitoneShift('G3', -7)).toBe('C3');
  });
  it('handles zero', () => {
    expect(semitoneShift('A4', 0)).toBe('A4');
  });
});

describe('ROUTINE shape', () => {
  it('has at least one exercise with at least one challenge', () => {
    expect(ROUTINE.length).toBeGreaterThan(0);
    expect(ROUTINE[0].challenges.length).toBeGreaterThan(0);
  });
  it('every challenge has a recognized type', () => {
    const allowed = new Set(['hold', 'slide', 'scale', 'dynamics']);
    for (const ex of ROUTINE) {
      for (const ch of ex.challenges) {
        expect(allowed.has(ch.type)).toBe(true);
      }
    }
  });
  it('totalChallengeCount matches manual count', () => {
    let n = 0;
    for (const ex of ROUTINE) n += ex.challenges.length;
    expect(totalChallengeCount()).toBe(n);
  });
});

describe('VOICE_TYPE_OFFSET', () => {
  it('has zero offset for baritone (the baseline)', () => {
    expect(VOICE_TYPE_OFFSET.baritone).toBe(0);
  });
  it('soprano is highest', () => {
    expect(VOICE_TYPE_OFFSET.soprano).toBeGreaterThan(VOICE_TYPE_OFFSET.tenor);
    expect(VOICE_TYPE_OFFSET.tenor).toBeGreaterThan(VOICE_TYPE_OFFSET.baritone);
  });
});

describe('transposeChallenge', () => {
  it('returns the same object reference behavior when offset is 0', () => {
    const c = { type: 'hold', target: 'C3' };
    expect(transposeChallenge(c, 0)).toBe(c);
  });
  it('shifts hold target by the given semitones', () => {
    const c = { type: 'hold', target: 'C3', toleranceCents: 50 };
    const t = transposeChallenge(c, 12);
    expect(t.target).toBe('C4');
    expect(t.toleranceCents).toBe(50);
  });
  it('shifts slide from/to and checkpoints', () => {
    const c = { type: 'slide', from: 'C3', to: 'G3', checkpoints: ['C3', 'E3', 'G3'] };
    const t = transposeChallenge(c, 5);
    expect(t.from).toBe('F3');
    expect(t.to).toBe('C4');
    expect(t.checkpoints).toEqual(['F3', 'A3', 'C4']);
  });
  it('shifts scale sequence', () => {
    const c = { type: 'scale', sequence: ['C3', 'D3', 'E3'] };
    const t = transposeChallenge(c, 7);
    expect(t.sequence).toEqual(['G3', 'A3', 'B3']);
  });
});

describe('transposeRoutine', () => {
  it('returns the routine unchanged when offset is 0', () => {
    expect(transposeRoutine(ROUTINE, 0)).toBe(ROUTINE);
  });
  it('preserves exercise count and challenge count per exercise', () => {
    const t = transposeRoutine(ROUTINE, 5);
    expect(t.length).toBe(ROUTINE.length);
    for (let i = 0; i < ROUTINE.length; i++) {
      expect(t[i].challenges.length).toBe(ROUTINE[i].challenges.length);
    }
  });
  it('preserves names and tips (only notes change)', () => {
    const t = transposeRoutine(ROUTINE, 5);
    for (let i = 0; i < ROUTINE.length; i++) {
      expect(t[i].name).toBe(ROUTINE[i].name);
      expect(t[i].tip).toBe(ROUTINE[i].tip);
    }
  });
});
