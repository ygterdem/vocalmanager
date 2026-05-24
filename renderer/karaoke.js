// Karaoke library + chord-pad backing generator.
//
// All tracks below are entirely original compositions — original melodies,
// original lyrics — written for this app. They are NOT transcriptions of any
// published song. Each one is intentionally short, simple, and stylistically
// tuned for low-pitch male intimate-style singing practice.
//
// Song schema:
//   bpm: number
//   chords: [{ chord: 'Am', beat: n, beats: n }]   // chord progression for the pad
//   notes:  [{ note: 'A3', beat: n, beats: n, lyric: 'soft', lineIndex: 0 }]
//     - lyric is optional (wordless tracks omit it)
//     - lineIndex groups notes into displayable lyric lines

import { noteToMidi } from './challenges.js';

export const KARAOKE_LIBRARY = [
  {
    id: 'slow-embrace',
    title: 'Slow Embrace',
    description: 'Original slow ballad. Quiet chest, intimate delivery, sustained vowels on the long notes.',
    style: 'Whisper-quiet, close-mic vibe. Let the long notes float.',
    bpm: 60,
    chords: [
      { chord: 'Am', beat: 0,  beats: 4 },
      { chord: 'F',  beat: 4,  beats: 4 },
      { chord: 'C',  beat: 8,  beats: 4 },
      { chord: 'G',  beat: 12, beats: 4 }
    ],
    lines: [
      'stay with me · one more night',
      'cold outside · soft warm light',
      'breathe it slow · close your eyes',
      'all is still · all is mine'
    ],
    notes: [
      { note: 'A3', beat: 0,   beats: 1,   lyric: 'stay',  lineIndex: 0 },
      { note: 'A3', beat: 1,   beats: 1,   lyric: 'with',  lineIndex: 0 },
      { note: 'C4', beat: 2,   beats: 1,   lyric: 'me',    lineIndex: 0 },
      { note: 'A3', beat: 3,   beats: 1,   lyric: 'one',   lineIndex: 0 },
      { note: 'G3', beat: 4,   beats: 1,   lyric: 'more',  lineIndex: 0 },
      { note: 'A3', beat: 5,   beats: 3,   lyric: 'night', lineIndex: 0 },

      { note: 'F3', beat: 8,   beats: 1,   lyric: 'cold',  lineIndex: 1 },
      { note: 'G3', beat: 9,   beats: 1,   lyric: 'out',   lineIndex: 1 },
      { note: 'A3', beat: 10,  beats: 1,   lyric: 'side',  lineIndex: 1 },
      { note: 'A3', beat: 11,  beats: 1,   lyric: 'soft',  lineIndex: 1 },
      { note: 'G3', beat: 12,  beats: 1,   lyric: 'warm',  lineIndex: 1 },
      { note: 'F3', beat: 13,  beats: 3,   lyric: 'light', lineIndex: 1 },

      { note: 'A3', beat: 16,  beats: 1,   lyric: 'breathe', lineIndex: 2 },
      { note: 'A3', beat: 17,  beats: 1,   lyric: 'it',      lineIndex: 2 },
      { note: 'C4', beat: 18,  beats: 1,   lyric: 'slow',    lineIndex: 2 },
      { note: 'B3', beat: 19,  beats: 1,   lyric: 'close',   lineIndex: 2 },
      { note: 'A3', beat: 20,  beats: 1,   lyric: 'your',    lineIndex: 2 },
      { note: 'G3', beat: 21,  beats: 3,   lyric: 'eyes',    lineIndex: 2 },

      { note: 'F3', beat: 24,  beats: 1,   lyric: 'all',     lineIndex: 3 },
      { note: 'G3', beat: 25,  beats: 1,   lyric: 'is',      lineIndex: 3 },
      { note: 'A3', beat: 26,  beats: 2,   lyric: 'still',   lineIndex: 3 },
      { note: 'C4', beat: 28,  beats: 1,   lyric: 'all',     lineIndex: 3 },
      { note: 'A3', beat: 29,  beats: 1,   lyric: 'is',      lineIndex: 3 },
      { note: 'G3', beat: 30,  beats: 4,   lyric: 'mine',    lineIndex: 3 }
    ]
  },
  {
    id: 'wordless-hum',
    title: 'Wordless Hum',
    description: 'Original syllables-only piece. No lyrics — just "ooh" sustained over a slow chord pad. For pure tone training.',
    style: 'Lips closed on "mmm" or open vowel "ooh". The long sustains are the whole point.',
    bpm: 55,
    chords: [
      { chord: 'Dm',   beat: 0,  beats: 4 },
      { chord: 'Bb',   beat: 4,  beats: 4 },
      { chord: 'F',    beat: 8,  beats: 4 },
      { chord: 'C',    beat: 12, beats: 4 },
      { chord: 'Dm',   beat: 16, beats: 4 },
      { chord: 'Am',   beat: 20, beats: 4 }
    ],
    lines: [
      'mmm — ooh — mmm',
      'ooh — ah — mmm',
      'long sustain · stay quiet'
    ],
    notes: [
      { note: 'D3', beat: 0,   beats: 4,  lyric: 'mmm',  lineIndex: 0 },
      { note: 'F3', beat: 4,   beats: 4,  lyric: 'ooh',  lineIndex: 0 },
      { note: 'D3', beat: 8,   beats: 4,  lyric: 'mmm',  lineIndex: 0 },
      { note: 'A3', beat: 12,  beats: 4,  lyric: 'ooh',  lineIndex: 1 },
      { note: 'F3', beat: 16,  beats: 4,  lyric: 'ah',   lineIndex: 1 },
      { note: 'D3', beat: 20,  beats: 4,  lyric: 'mmm',  lineIndex: 1 }
    ]
  },
  {
    id: 'wayfaring-stranger-trad',
    title: 'Wayfaring Stranger (traditional)',
    description: 'Simple reading of the traditional American folk hymn melody (public domain). Vocalises on each note — sing on the vowel, or edit the JSON to add your own lyrics.',
    style: 'Slow, mournful, minor key. Soft chest voice. Lean into the descending phrases.',
    bpm: 60,
    chords: [
      { chord: 'Am', beat: 0,  beats: 4 },
      { chord: 'F',  beat: 4,  beats: 4 },
      { chord: 'C',  beat: 8,  beats: 4 },
      { chord: 'G',  beat: 12, beats: 4 },
      { chord: 'Am', beat: 16, beats: 4 },
      { chord: 'F',  beat: 20, beats: 4 },
      { chord: 'E',  beat: 24, beats: 4 },
      { chord: 'Am', beat: 28, beats: 4 }
    ],
    lines: [
      'phrase 1 — gentle rise',
      'phrase 2 — settle back',
      'phrase 3 — climb to the peak',
      'phrase 4 — come home'
    ],
    notes: [
      // Phrase 1
      { note: 'A3', beat: 0,  beats: 1, lyric: 'ah',  lineIndex: 0 },
      { note: 'C4', beat: 1,  beats: 1, lyric: 'ah',  lineIndex: 0 },
      { note: 'E4', beat: 2,  beats: 1, lyric: 'ah',  lineIndex: 0 },
      { note: 'E4', beat: 3,  beats: 1, lyric: 'ah',  lineIndex: 0 },
      { note: 'D4', beat: 4,  beats: 1, lyric: 'ooh', lineIndex: 0 },
      { note: 'C4', beat: 5,  beats: 1, lyric: 'ooh', lineIndex: 0 },
      { note: 'A3', beat: 6,  beats: 2, lyric: 'ahh', lineIndex: 0 },
      // Phrase 2
      { note: 'A3', beat: 8,  beats: 1, lyric: 'mmm', lineIndex: 1 },
      { note: 'C4', beat: 9,  beats: 1, lyric: 'mmm', lineIndex: 1 },
      { note: 'E4', beat: 10, beats: 1, lyric: 'ah',  lineIndex: 1 },
      { note: 'D4', beat: 11, beats: 1, lyric: 'ah',  lineIndex: 1 },
      { note: 'C4', beat: 12, beats: 1, lyric: 'ooh', lineIndex: 1 },
      { note: 'A3', beat: 13, beats: 3, lyric: 'ahh', lineIndex: 1 },
      // Phrase 3 — climb to the peak
      { note: 'C4', beat: 16, beats: 1, lyric: 'ah',  lineIndex: 2 },
      { note: 'E4', beat: 17, beats: 1, lyric: 'ah',  lineIndex: 2 },
      { note: 'G4', beat: 18, beats: 1, lyric: 'oh',  lineIndex: 2 },
      { note: 'E4', beat: 19, beats: 1, lyric: 'oh',  lineIndex: 2 },
      { note: 'D4', beat: 20, beats: 1, lyric: 'ahh', lineIndex: 2 },
      { note: 'C4', beat: 21, beats: 1, lyric: 'ahh', lineIndex: 2 },
      { note: 'B3', beat: 22, beats: 2, lyric: 'ooh', lineIndex: 2 },
      // Phrase 4 — descent home
      { note: 'A3', beat: 24, beats: 1, lyric: 'ah',  lineIndex: 3 },
      { note: 'C4', beat: 25, beats: 1, lyric: 'ah',  lineIndex: 3 },
      { note: 'E4', beat: 26, beats: 1, lyric: 'ah',  lineIndex: 3 },
      { note: 'D4', beat: 27, beats: 1, lyric: 'ah',  lineIndex: 3 },
      { note: 'C4', beat: 28, beats: 1, lyric: 'ooh', lineIndex: 3 },
      { note: 'B3', beat: 29, beats: 1, lyric: 'ooh', lineIndex: 3 },
      { note: 'A3', beat: 30, beats: 2, lyric: 'ahh', lineIndex: 3 }
    ]
  },
  {
    id: 'rising-sun-trad',
    title: 'Rising Sun (traditional melody)',
    description: 'Simple reading of the classic minor-key folk melody (public domain). Vocalises only — the well-known lyrical versions are mostly tied to specific copyrighted arrangements, so this is melody-only. Sing on the vowels.',
    style: 'Brooding minor. The signature is the ascending arpeggio on each phrase opener — let those notes ring.',
    bpm: 75,
    chords: [
      { chord: 'Am', beat: 0,  beats: 4 },
      { chord: 'C',  beat: 4,  beats: 4 },
      { chord: 'D',  beat: 8,  beats: 4 },
      { chord: 'F',  beat: 12, beats: 4 },
      { chord: 'Am', beat: 16, beats: 4 },
      { chord: 'E',  beat: 20, beats: 4 }
    ],
    lines: [
      'ascend — the arpeggio rises',
      'rest at the top',
      'descend — come back to home'
    ],
    notes: [
      // ascending arpeggio
      { note: 'A3', beat: 0,  beats: 1, lyric: 'ah',  lineIndex: 0 },
      { note: 'C4', beat: 1,  beats: 1, lyric: 'ah',  lineIndex: 0 },
      { note: 'D4', beat: 2,  beats: 1, lyric: 'ah',  lineIndex: 0 },
      { note: 'F4', beat: 3,  beats: 1, lyric: 'ah',  lineIndex: 0 },
      { note: 'A3', beat: 4,  beats: 1, lyric: 'ooh', lineIndex: 0 },
      { note: 'C4', beat: 5,  beats: 1, lyric: 'ooh', lineIndex: 0 },
      { note: 'E4', beat: 6,  beats: 2, lyric: 'ahh', lineIndex: 0 },
      // rest at the top
      { note: 'A3', beat: 8,  beats: 1, lyric: 'oh',  lineIndex: 1 },
      { note: 'C4', beat: 9,  beats: 1, lyric: 'oh',  lineIndex: 1 },
      { note: 'D4', beat: 10, beats: 1, lyric: 'oh',  lineIndex: 1 },
      { note: 'F4', beat: 11, beats: 1, lyric: 'oh',  lineIndex: 1 },
      { note: 'E4', beat: 12, beats: 1, lyric: 'ah',  lineIndex: 1 },
      { note: 'D4', beat: 13, beats: 1, lyric: 'ah',  lineIndex: 1 },
      { note: 'C4', beat: 14, beats: 2, lyric: 'ahh', lineIndex: 1 },
      // descent home
      { note: 'A3', beat: 16, beats: 1, lyric: 'ah',  lineIndex: 2 },
      { note: 'C4', beat: 17, beats: 1, lyric: 'ah',  lineIndex: 2 },
      { note: 'E4', beat: 18, beats: 1, lyric: 'ahh', lineIndex: 2 },
      { note: 'D4', beat: 19, beats: 1, lyric: 'ahh', lineIndex: 2 },
      { note: 'C4', beat: 20, beats: 1, lyric: 'ooh', lineIndex: 2 },
      { note: 'B3', beat: 21, beats: 1, lyric: 'ooh', lineIndex: 2 },
      { note: 'A3', beat: 22, beats: 2, lyric: 'ahh', lineIndex: 2 }
    ]
  }
];

export function expandKaraoke(song) {
  const beatMs = 60000 / song.bpm;
  const notes = song.notes.map((n, i) => ({
    ...n,
    index: i,
    midi: noteToMidi(n.note),
    startMs: n.beat * beatMs,
    endMs: (n.beat + n.beats) * beatMs
  }));
  const chords = (song.chords || []).map(c => ({
    ...c,
    startMs: c.beat * beatMs,
    endMs: (c.beat + c.beats) * beatMs
  }));
  const totalMs = Math.max(...notes.map(n => n.endMs), ...chords.map(c => c.endMs)) + 1500;
  return { ...song, notes, chords, totalMs };
}

// -------- Chord-pad backing generator --------
// Stacks three sine oscillators per chord (root, third, fifth) with a soft
// attack/release. Low volume so it doesn't drown out the user's voice.
const CHORD_INTERVALS = {
  '':     [0, 4, 7],
  'maj':  [0, 4, 7],
  'm':    [0, 3, 7],
  'min':  [0, 3, 7],
  '7':    [0, 4, 7, 10],
  'maj7': [0, 4, 7, 11],
  'm7':   [0, 3, 7, 10],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7]
};

function parseChord(name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  if (!m) return null;
  const root = m[1];
  const type = m[2] || '';
  const intervals = CHORD_INTERVALS[type] || CHORD_INTERVALS[''];
  return { root, intervals };
}

export class ChordPad {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.scheduled = [];
    this.volume = 0.12; // quiet — don't drown out the voice
  }
  _ensure() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    // Slight low-pass to soften the pad
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1600;
    this.master.connect(filter).connect(this.ctx.destination);
  }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }
  scheduleProgression(chords, bpm, startDelayMs = 0) {
    this._ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const t0 = this.ctx.currentTime + startDelayMs / 1000;
    const beatSec = 60 / bpm;
    for (const c of chords) {
      const start = t0 + c.beat * beatSec;
      const dur = c.beats * beatSec;
      const parsed = parseChord(c.chord);
      if (!parsed) continue;
      const rootMidi = noteToMidi(parsed.root + '2');
      if (rootMidi == null) continue;
      for (const iv of parsed.intervals) {
        const freq = 440 * Math.pow(2, (rootMidi + iv - 69) / 12);
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.33, start + 0.4);
        gain.gain.setValueAtTime(0.33, start + dur - 0.35);
        gain.gain.linearRampToValueAtTime(0, start + dur);
        osc.connect(gain).connect(this.master);
        osc.start(start);
        osc.stop(start + dur + 0.05);
        this.scheduled.push(osc);
      }
    }
  }
  stop() {
    if (!this.ctx) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.2);
    const ctx = this.ctx;
    setTimeout(() => { try { ctx.close(); } catch (e) {} }, 300);
    this.ctx = null;
    this.master = null;
    this.scheduled = [];
  }
}
