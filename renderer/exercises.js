// Music helpers
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteToFreq(note) {
  // e.g. "A4" -> 440
  const m = /^([A-G])(#|b)?(-?\d+)$/.exec(note);
  if (!m) return null;
  let pc = NOTE_NAMES.indexOf(m[1]);
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  const octave = parseInt(m[3], 10);
  const midi = (octave + 1) * 12 + pc;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function freqToNote(freq) {
  if (!freq || freq <= 0) return null;
  const midi = 69 + 12 * Math.log2(freq / 440);
  const rounded = Math.round(midi);
  const cents = Math.round((midi - rounded) * 100);
  const octave = Math.floor(rounded / 12) - 1;
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  return { name: `${name}${octave}`, midi: rounded, cents };
}

export function semitoneShift(note, semis) {
  const f = noteToFreq(note);
  const shifted = f * Math.pow(2, semis / 12);
  return freqToNote(shifted).name;
}

// Voice-type → semitone offset applied to the base routine (which is tuned
// for low male / baritone). These are deliberately conservative — singers
// fine-tune further via lowestComfortable / highestComfortable.
export const VOICE_TYPE_OFFSET = {
  bass: -3,
  baritone: 0,
  tenor: 5,
  alto: 8,
  mezzo: 11,
  soprano: 13
};

export const VOICE_TYPE_LABEL = {
  bass: 'Bass',
  baritone: 'Baritone',
  tenor: 'Tenor',
  alto: 'Alto',
  mezzo: 'Mezzo-soprano',
  soprano: 'Soprano'
};

function shiftNoteName(name, semis) {
  if (!name || !semis) return name;
  return semitoneShift(name, semis);
}

export function transposeChallenge(c, semis) {
  if (!semis) return c;
  const out = { ...c };
  if (c.target) out.target = shiftNoteName(c.target, semis);
  if (c.from) out.from = shiftNoteName(c.from, semis);
  if (c.to) out.to = shiftNoteName(c.to, semis);
  if (c.checkpoints) out.checkpoints = c.checkpoints.map((n) => shiftNoteName(n, semis));
  if (c.sequence) out.sequence = c.sequence.map((n) => shiftNoteName(n, semis));
  return out;
}

export function transposeRoutine(routine, semis) {
  if (!semis) return routine;
  return routine.map((ex) => ({
    ...ex,
    challenges: ex.challenges.map((c) => transposeChallenge(c, semis))
  }));
}

// ---------------------------------------------------------------------------
// Routine for a low male voice (bass / baritone).
//
// Each exercise is a sequence of *challenges*. A challenge is verified against
// your mic and only counts as complete when you actually hit it.
//
//   hold  { target, toleranceCents?, octaveTolerance?, holdMs }
//   slide { from, to, checkpoints[], toleranceCents?, octaveTolerance? }
//   scale { sequence[], perNoteMs?, toleranceCents? }
//
// Tolerances:
//   - Lip trills / ng-sirens are imprecise gestures → wide tolerance + octave
//     tolerance, so the user can lip-trill in any octave that's comfortable.
//   - Scales train specific pitches → tight tolerance, exact octave.
// ---------------------------------------------------------------------------
export const ROUTINE = [
  {
    name: 'Lip trill warm-up',
    tip: 'Loose lips, "brrrr". This wakes up the voice without strain.',
    challenges: [
      { type: 'hold',  target: 'C3', holdMs: 2500, toleranceCents: 80, octaveTolerance: 1,
        label: 'Lip trill C3', subhint: 'Steady "brrr" on the note. Octave doesn\'t matter.' },
      { type: 'slide', from: 'C3', to: 'G3', checkpoints: ['C3', 'E3', 'G3'], toleranceCents: 90,
        label: 'Slide UP to G3', subhint: 'Smooth siren on "brrr" — pass through E3 in the target octave.' },
      { type: 'slide', from: 'G3', to: 'C3', checkpoints: ['G3', 'F3', 'E3', 'D3', 'C3'], toleranceCents: 90,
        label: 'Slide DOWN to C3', subhint: 'Smooth descent — every step in the target octave.' },
      { type: 'hold',  target: 'G3', holdMs: 2000, toleranceCents: 80, octaveTolerance: 1,
        label: 'Lip trill G3', subhint: 'Park it on G3 for 2 seconds.' }
    ]
  },
  {
    name: 'Ng-sirens (mix builder)',
    tip: 'Closed-mouth "ngggg" like the end of "sing". This is the single best exercise for extending a low male range.',
    challenges: [
      { type: 'hold',  target: 'A2', holdMs: 2000, toleranceCents: 70, octaveTolerance: 1,
        label: 'Hold A2 on "ng"', subhint: 'Thin, whiny sound. No volume.' },
      { type: 'slide', from: 'A2', to: 'A3', checkpoints: ['A2', 'D3', 'A3'], toleranceCents: 90,
        label: 'Octave UP slide', subhint: 'A2 → D3 → A3 in the target octave. Keep the "ng" thin on top.' },
      { type: 'hold',  target: 'A3', holdMs: 2000, toleranceCents: 80, octaveTolerance: 1,
        label: 'Hold A3 on "ng"', subhint: 'Stay thin. Don\'t push.' },
      { type: 'slide', from: 'A3', to: 'A2', checkpoints: ['A3', 'G3', 'F3', 'E3', 'D3', 'C3', 'B2', 'A2'], toleranceCents: 90,
        label: 'Octave DOWN slide', subhint: 'Smooth chromatic descent in the target octave. Skipping ahead resets.' }
    ]
  },
  {
    name: '5-tone "nay" scale — chest',
    tip: 'Bratty "nay" (rhymes with "say"). Stay in chest — this builds the floor of your range.',
    challenges: [
      { type: 'scale', sequence: ['C3', 'D3', 'E3', 'F3', 'G3'], perNoteMs: 700, toleranceCents: 60,
        label: 'Ascending C3 → G3', subhint: 'Each note clean and bratty. Hold ~0.7s on each.' },
      { type: 'scale', sequence: ['G3', 'F3', 'E3', 'D3', 'C3'], perNoteMs: 700, toleranceCents: 60,
        label: 'Descending G3 → C3', subhint: 'Back down the scale.' }
    ]
  },
  {
    name: '5-tone "nay" scale — bridge',
    tip: 'Same pattern, higher. Let the sound get smaller as you go up. DO NOT push chest into the top.',
    challenges: [
      { type: 'scale', sequence: ['G3', 'A3', 'B3', 'C4', 'D4'], perNoteMs: 800, toleranceCents: 60, coachWeight: 'light',
        label: 'Ascending G3 → D4', subhint: 'Drop volume on top. Thinner = higher.' },
      { type: 'scale', sequence: ['D4', 'C4', 'B3', 'A3', 'G3'], perNoteMs: 800, toleranceCents: 60, coachWeight: 'light',
        label: 'Descending D4 → G3', subhint: 'Stay in mix, don\'t crash back into chest.' }
    ]
  },
  {
    name: 'Octave slides on "wee"',
    tip: 'Slide an octave up on "weeee", hold the top, slide back. The "ee" vowel encourages mix voice.',
    challenges: [
      { type: 'slide', from: 'C3', to: 'C4', checkpoints: ['C3', 'G3', 'C4'], toleranceCents: 80,
        label: 'C3 → C4 on "wee"', subhint: 'Smooth glissando, no breaks.' },
      { type: 'hold',  target: 'C4', holdMs: 1500, toleranceCents: 60,
        label: 'Hold C4', subhint: 'Park on C4 for 1.5s — light and forward.' },
      { type: 'slide', from: 'D3', to: 'D4', checkpoints: ['D3', 'A3', 'D4'], toleranceCents: 80,
        label: 'D3 → D4 on "wee"', subhint: 'Up a whole step from the last one.' }
    ]
  },
  {
    name: 'Falsetto / head voice access',
    tip: 'Light "oo" or "wee". Flip cleanly into a thinner, lighter register — falsetto for males. This unlocks the upper notes where intimate singing styles sit.',
    challenges: [
      { type: 'slide', from: 'C4', to: 'A4', checkpoints: ['C4', 'E4', 'G4', 'A4'], toleranceCents: 90, coachWeight: 'light',
        label: 'Flip into head voice', subhint: 'Start in mix, let the voice get THINNER as you go up. Don\'t push.' },
      { type: 'hold',  target: 'A4', holdMs: 2500, toleranceCents: 90, coachWeight: 'light',
        label: 'Sustain A4 in light voice', subhint: 'Falsetto is fine. Soft, breathy is the goal.' },
      { type: 'slide', from: 'A4', to: 'C4', checkpoints: ['A4', 'G4', 'E4', 'C4'], toleranceCents: 90, coachWeight: 'light',
        label: 'Slide back into mix', subhint: 'Don\'t crash back into chest — let it glide.' }
    ]
  },
  {
    name: 'Dynamics control — quiet sustain',
    tip: 'The whole intimate-singing style is about HOLDING a soft note with steady pitch. Pitch alone isn\'t enough — your loudness must stay quiet too.',
    challenges: [
      { type: 'dynamics', target: 'E3', dbMin: -45, dbMax: -25, holdMs: 3000, toleranceCents: 70,
        label: 'Whisper-sing E3 (quiet)', subhint: 'Sing as quietly as you can while still on pitch. Aim for the green dB zone.' },
      { type: 'dynamics', target: 'G3', dbMin: -45, dbMax: -25, holdMs: 3000, toleranceCents: 70,
        label: 'Whisper-sing G3 (quiet)', subhint: 'Same volume, higher pitch. Don\'t let volume creep up.' },
      { type: 'dynamics', target: 'B3', dbMin: -45, dbMax: -25, holdMs: 3000, toleranceCents: 70,
        label: 'Whisper-sing B3 (quiet)', subhint: 'Resist the urge to push. Volume is the test, pitch comes free.' }
    ]
  },
  {
    name: 'Cooldown sirens',
    tip: 'Soft, breathy descending sirens. You\'re putting the voice to bed. Drink water after.',
    challenges: [
      { type: 'slide', from: 'G3', to: 'C3', checkpoints: ['G3', 'F3', 'E3', 'D3', 'C3'], toleranceCents: 100,
        label: 'Soft descent G3 → C3', subhint: 'Half-volume lip trill. Every step in the target octave.' },
      { type: 'hold',  target: 'C3', holdMs: 3000, toleranceCents: 90, octaveTolerance: 1,
        label: 'Cooldown hold C3', subhint: 'Very soft. Three seconds. Done.' }
    ]
  }
];

// Total XP available: 10 per challenge × total challenges
export function totalChallengeCount() {
  return ROUTINE.reduce((n, ex) => n + ex.challenges.length, 0);
}
