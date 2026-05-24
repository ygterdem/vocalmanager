// Challenge engine — verifies you actually sang what the exercise asked for.
// Types:
//   hold   — sustain a single note for `holdMs` within tolerance
//   slide  — pass through a sequence of checkpoint notes (any order doesn't matter)
//   scale  — hit a sequence of notes IN ORDER, each held briefly
//
// All matching is done in "total cents" (midi*100 + cents) so semitone math is
// linear. Each challenge can opt into octave-agnostic matching for lip trills
// where the gesture matters more than the absolute pitch.

import { noteToFreq, freqToNote } from './exercises.js';

export function noteToMidi(noteName) {
  const f = noteToFreq(noteName);
  return f ? freqToNote(f).midi : null;
}

function totalCents(midi, cents) {
  return midi * 100 + cents;
}

export function isMatch(midi, cents, targetMidi, toleranceCents, octaveTolerance = 0) {
  if (midi == null) return false;
  const inTotal = totalCents(midi, cents);
  const targetTotal = targetMidi * 100;
  if (Math.abs(inTotal - targetTotal) <= toleranceCents) return true;
  for (let oct = 1; oct <= octaveTolerance; oct++) {
    if (Math.abs(inTotal - (targetTotal + oct * 1200)) <= toleranceCents) return true;
    if (Math.abs(inTotal - (targetTotal - oct * 1200)) <= toleranceCents) return true;
  }
  return false;
}

export function expandChallenge(c) {
  // Convert note-name fields into midi numbers once, up-front.
  const out = { ...c };
  if (c.target) out.targetMidi = noteToMidi(c.target);
  if (c.from) out.fromMidi = noteToMidi(c.from);
  if (c.to) out.toMidi = noteToMidi(c.to);
  if (c.checkpoints) out.checkpointsMidi = c.checkpoints.map(noteToMidi);
  if (c.sequence) out.sequenceMidi = c.sequence.map(noteToMidi);
  out.toleranceCents = c.toleranceCents ?? 60;
  out.octaveTolerance = c.octaveTolerance ?? 0;
  return out;
}

export class ChallengeRunner {
  constructor(challenge) {
    this.ch = expandChallenge(challenge);
    this.status = 'pending';     // pending → active → passed
    this.startedAt = null;
    this.lastTickAt = null;
    this.timeInTarget = 0;       // for hold
    this.timeOnCurrent = 0;      // for scale
    this.currentIdx = 0;         // for scale
    this.hitCheckpoints = new Set(); // for slide (in correct order)
    this.cpAccums = new Map();   // for slide: per-checkpoint accumulated in-tolerance time
    this.nextCpIndex = 0;        // for slide: which checkpoint we're waiting on
    this.futureAccums = new Map(); // for slide: out-of-order hit debounce
    this.resetCount = 0;
    this.justReset = false;      // one-frame flag for UI
    this.centsSamples = [];      // for hold/dynamics: stability tracking (cents-off while in target)
    this.dbSamples = [];         // for dynamics: loudness samples (dB while in target)
  }

  begin() {
    this.status = 'active';
    this.startedAt = performance.now();
    this.lastTickAt = this.startedAt;
  }

  pause() {
    if (this.status === 'active') this.status = 'paused';
  }

  resume() {
    if (this.status === 'paused') {
      this.status = 'active';
      // Reset the tick clock so the dt for the next frame isn't the entire
      // paused duration.
      this.lastTickAt = performance.now();
    }
  }

  tick(midi, cents, db) {
    if (this.status !== 'active') return;
    const now = performance.now();
    const dt = now - this.lastTickAt;
    this.lastTickAt = now;
    const detected = midi != null;

    if (this.ch.type === 'hold') {
      const inTol = detected && isMatch(midi, cents, this.ch.targetMidi, this.ch.toleranceCents, this.ch.octaveTolerance);
      if (inTol) {
        this.timeInTarget += dt;
        const off = (midi * 100 + cents) - this.ch.targetMidi * 100;
        this.centsSamples.push(off);
      } else this.timeInTarget = Math.max(0, this.timeInTarget - dt * 0.5);
      if (this.timeInTarget >= this.ch.holdMs) this.status = 'passed';
    }

    else if (this.ch.type === 'dynamics') {
      // BOTH pitch in tolerance AND db within window for the duration.
      const inPitch = detected && isMatch(midi, cents, this.ch.targetMidi, this.ch.toleranceCents, this.ch.octaveTolerance);
      const inDb = db != null && db >= this.ch.dbMin && db <= this.ch.dbMax;
      const both = inPitch && inDb;
      if (both) {
        this.timeInTarget += dt;
        const off = (midi * 100 + cents) - this.ch.targetMidi * 100;
        this.centsSamples.push(off);
        this.dbSamples.push(db);
      } else this.timeInTarget = Math.max(0, this.timeInTarget - dt * 0.5);
      // record why we're not progressing (for UI hint)
      this._dynPitchFail = !inPitch;
      this._dynDbFail = !inDb;
      if (this.timeInTarget >= this.ch.holdMs) this.status = 'passed';
    }

    else if (this.ch.type === 'slide') {
      // STRICT ORDER: the user must hit checkpoints in the defined sequence.
      // - Only the next-expected checkpoint accumulates "hit" credit.
      // - Hitting a checkpoint that's LATER in the sequence (skipping ahead)
      //   accumulates in `futureAccums`. If that confirms (60ms), the whole
      //   slide resets so the user has to start over.
      // - Previous (already-hit) checkpoints are ignored (it's fine to dip back
      //   briefly during a slide).
      this.justReset = false;
      if (detected && this.nextCpIndex < this.ch.checkpointsMidi.length) {
        const expectedMidi = this.ch.checkpointsMidi[this.nextCpIndex];
        const tol = this.ch.toleranceCents;
        const oct = this.ch.octaveTolerance;

        if (isMatch(midi, cents, expectedMidi, tol, oct)) {
          // On expected — accumulate forward progress
          const cur = (this.cpAccums.get(expectedMidi) || 0) + dt;
          this.cpAccums.set(expectedMidi, cur);
          if (cur >= 60) {
            this.hitCheckpoints.add(expectedMidi);
            this.nextCpIndex += 1;
            this.futureAccums.clear(); // wipe any stale out-of-order accumulation
          }
        } else {
          // Decay expected so old credit fades
          const cur = this.cpAccums.get(expectedMidi) || 0;
          if (cur > 0) this.cpAccums.set(expectedMidi, Math.max(0, cur - dt * 0.4));

          // Look for an out-of-order hit on a FUTURE checkpoint
          let triggeredReset = false;
          for (let i = this.nextCpIndex + 1; i < this.ch.checkpointsMidi.length; i++) {
            const futureMidi = this.ch.checkpointsMidi[i];
            if (isMatch(midi, cents, futureMidi, tol, oct)) {
              const fc = (this.futureAccums.get(futureMidi) || 0) + dt;
              this.futureAccums.set(futureMidi, fc);
              if (fc >= 60) {
                // Confirmed jump — reset everything.
                this.hitCheckpoints.clear();
                this.cpAccums.clear();
                this.futureAccums.clear();
                this.nextCpIndex = 0;
                this.resetCount += 1;
                this.justReset = true;
                triggeredReset = true;
                break;
              }
            } else {
              const fc = this.futureAccums.get(futureMidi) || 0;
              if (fc > 0) this.futureAccums.set(futureMidi, Math.max(0, fc - dt * 0.5));
            }
          }
          if (triggeredReset) { /* state already wiped */ }
        }
      }
      if (this.nextCpIndex >= this.ch.checkpointsMidi.length) this.status = 'passed';
    }

    else if (this.ch.type === 'scale') {
      const targetMidi = this.ch.sequenceMidi[this.currentIdx];
      const inTol = detected && isMatch(midi, cents, targetMidi, this.ch.toleranceCents, this.ch.octaveTolerance);
      if (inTol) this.timeOnCurrent += dt;
      else this.timeOnCurrent = Math.max(0, this.timeOnCurrent - dt * 0.5);
      if (this.timeOnCurrent >= (this.ch.perNoteMs || 700)) {
        this.currentIdx++;
        this.timeOnCurrent = 0;
        if (this.currentIdx >= this.ch.sequenceMidi.length) this.status = 'passed';
      }
    }
  }

  progress() {
    if (this.ch.type === 'hold') return Math.min(1, this.timeInTarget / this.ch.holdMs);
    if (this.ch.type === 'dynamics') return Math.min(1, this.timeInTarget / this.ch.holdMs);
    if (this.ch.type === 'slide') return this.hitCheckpoints.size / this.ch.checkpointsMidi.length;
    if (this.ch.type === 'scale') return (this.currentIdx + this.timeOnCurrent / (this.ch.perNoteMs || 700)) / this.ch.sequenceMidi.length;
    return 0;
  }

  // For UI: what's the "current target" the user is aiming for right now?
  currentTargetMidi() {
    if (this.ch.type === 'hold') return this.ch.targetMidi;
    if (this.ch.type === 'dynamics') return this.ch.targetMidi;
    if (this.ch.type === 'scale') return this.ch.sequenceMidi[Math.min(this.currentIdx, this.ch.sequenceMidi.length - 1)];
    if (this.ch.type === 'slide') {
      const i = Math.min(this.nextCpIndex, this.ch.checkpointsMidi.length - 1);
      return this.ch.checkpointsMidi[i];
    }
  }

  // Human-readable summary of completion within the current step.
  subProgressLabel() {
    if (this.ch.type === 'hold') return `${Math.round(this.timeInTarget)}/${this.ch.holdMs}ms`;
    if (this.ch.type === 'dynamics') return `${Math.round(this.timeInTarget)}/${this.ch.holdMs}ms`;
    if (this.ch.type === 'slide') return `${this.hitCheckpoints.size}/${this.ch.checkpointsMidi.length} checkpoints`;
    if (this.ch.type === 'scale') return `${this.currentIdx}/${this.ch.sequenceMidi.length} notes`;
    return '';
  }

  // Pitch stability score: stddev of cents-off during in-target samples.
  // Lower = steadier. Target: <15 cents (very steady), 15–30 (good), >30 (wobbly).
  // Returns null if not enough samples.
  stabilityScore() {
    if (this.centsSamples.length < 8) return null;
    const n = this.centsSamples.length;
    const mean = this.centsSamples.reduce((a, b) => a + b, 0) / n;
    const variance = this.centsSamples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
    return Math.sqrt(variance);
  }

  // Average loudness over in-target frames (for dynamics challenges).
  avgDb() {
    if (this.dbSamples.length < 5) return null;
    return this.dbSamples.reduce((a, b) => a + b, 0) / this.dbSamples.length;
  }

  // For slide UI: list each checkpoint with hit / current / future / partial / out-of-order status.
  checkpointStatus() {
    if (this.ch.type !== 'slide') return [];
    return this.ch.checkpoints.map((name, i) => {
      const midi = this.ch.checkpointsMidi[i];
      const hit = i < this.nextCpIndex;
      const current = i === this.nextCpIndex;
      const future = i > this.nextCpIndex;
      const fwdAcc = this.cpAccums.get(midi) || 0;
      const futAcc = this.futureAccums.get(midi) || 0;
      const partial = current && fwdAcc > 5;
      const offending = future && futAcc > 5; // building toward a reset
      return { name, hit, current, future, partial, offending, acc: fwdAcc };
    });
  }
}
