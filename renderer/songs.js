// Sing-along practice melodies.
//
// These are ORIGINAL practice phrases — simple stepwise/interval patterns
// designed for vocal exercise, not transcriptions of any copyrighted song.
// Each one targets a specific skill (quiet sustain, head-voice transition,
// breath control) relevant to intimate-singing styles.
//
// Note format: { note: 'D4', beat: 0, beats: 2 } — beats are in quarter-notes
// at the song's bpm. A beat of 2 means a half-note duration.

import { noteToMidi } from './challenges.js';
import { freqToNote } from './exercises.js';

const midiToName = (m) => freqToNote(440 * Math.pow(2, (m - 69) / 12)).name;

export const SONG_LIBRARY = [
  {
    id: 'slow-descent',
    title: 'Slow Descent — quiet chest',
    description: 'A slow descending stepwise phrase in low chest voice. Builds the foundation skill of quiet sustained tone.',
    style: 'Sing on "oo" or "ah". Soft, breathy, no vibrato. Stay in your speaking-voice register.',
    bpm: 60,
    notes: [
      { note: 'D4', beat: 0,  beats: 2 },
      { note: 'C4', beat: 2,  beats: 2 },
      { note: 'B3', beat: 4,  beats: 2 },
      { note: 'A3', beat: 6,  beats: 4 },
      { note: 'G3', beat: 10, beats: 2 },
      { note: 'A3', beat: 12, beats: 4 }
    ]
  },
  {
    id: 'long-sustains',
    title: 'Long Sustains — breath control',
    description: 'Long held notes deep in your chest range. Practice holding each note without wavering or running out of breath.',
    style: 'Steady tone. Try to keep the pitch needle dead-flat across the whole note.',
    bpm: 50,
    notes: [
      { note: 'A3', beat: 0,  beats: 4 },
      { note: 'G3', beat: 4,  beats: 4 },
      { note: 'F3', beat: 8,  beats: 4 },
      { note: 'E3', beat: 12, beats: 6 }
    ]
  },
  {
    id: 'bridge-up',
    title: 'Bridge to Head Voice',
    description: 'Ascending phrase that lifts you out of chest into mix/head voice on the top note. The transition is the skill.',
    style: 'Start in chest. Let the sound get THINNER as you climb. The top note (A4) should be light — falsetto is fine.',
    bpm: 70,
    notes: [
      { note: 'C4', beat: 0,  beats: 1 },
      { note: 'E4', beat: 1,  beats: 1 },
      { note: 'G4', beat: 2,  beats: 2 },
      { note: 'A4', beat: 4,  beats: 4 },
      { note: 'G4', beat: 8,  beats: 2 },
      { note: 'E4', beat: 10, beats: 2 },
      { note: 'C4', beat: 12, beats: 4 }
    ]
  }
];

export function expandSong(song, transpose = 0) {
  const beatMs = 60000 / song.bpm;
  const notes = song.notes.map(n => {
    const midi = noteToMidi(n.note) + transpose;
    return {
      ...n,
      midi,
      note: transpose ? midiToName(midi) : n.note, // relabel the chart when shifted
      startMs: n.beat * beatMs,
      endMs: (n.beat + n.beats) * beatMs
    };
  });
  const totalMs = Math.max(...notes.map(n => n.endMs)) + 1500;
  return { ...song, notes, totalMs, transpose };
}
