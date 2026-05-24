import { PitchDetector } from 'pitchy';
import { freqToNote } from './exercises.js';

// Reference noise floor (dBFS). Real-world floors vary by mic gain — we
// calibrate the user's actual floor for ~800ms at mic-start and shift the
// reported dB so downstream thresholds (dynamics challenges, dB meter zones)
// are gain-independent.
const NOISE_FLOOR_REF = -60;

// Clarity hysteresis: enter pitched mode at high clarity, exit only when it
// drops well below. Stops the displayed note flickering on/off at marginal
// signal.
const CLARITY_ENTER = 0.72;
const CLARITY_EXIT = 0.55;

// Detection cadence. 40Hz is enough for vocal pitch and stays steady even
// when the renderer is throttled (hidden window, low-spec GPU). Decoupled
// from requestAnimationFrame on purpose.
const TICK_MS = 25;

// Median window size — kills single-frame octave glitches.
const MEDIAN_WINDOW = 5;

export class PitchTracker {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.detector = null;
    this.input = null;
    this.running = false;
    this.buf = null;
    this.timer = null;
    this.medianBuf = [];
    this.locked = false;
    this.noiseFloorDb = NOISE_FLOOR_REF;
    this.calibrationSamples = [];
    this.calibratingUntil = 0;
  }

  async start() {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Some platforms start the context suspended; resume after the user
    // gesture that triggered start() (mic button click counts).
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (_) {}
    }
    this.input = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.input.connect(this.analyser);

    this.detector = PitchDetector.forFloat32Array(this.analyser.fftSize);
    // Looser thresholds so soft ng-sirens and lip trills (which are nasal /
    // buzzy and lower-clarity than a clear sung tone) still register.
    this.detector.minVolumeDecibels = -55;
    this.buf = new Float32Array(this.detector.inputLength);
    this.medianBuf = [];
    this.locked = false;
    this.noiseFloorDb = NOISE_FLOOR_REF;
    this.calibrationSamples = [];
    this.calibratingUntil = performance.now() + 800;
    this.running = true;
    this.timer = setInterval(() => this._tick(), TICK_MS);
  }

  /**
   * Trigger a fresh ambient-noise recalibration. Useful when the user changes
   * environments mid-session (e.g. plugs in a different mic).
   */
  recalibrate(durationMs = 800) {
    this.calibrationSamples = [];
    this.noiseFloorDb = NOISE_FLOOR_REF;
    this.calibratingUntil = performance.now() + durationMs;
  }

  _tick() {
    if (!this.running) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const [pitch, clarity] = this.detector.findPitch(this.buf, this.ctx.sampleRate);

    // RMS → dBFS for the loudness meter.
    let sumSq = 0;
    for (let i = 0; i < this.buf.length; i++) sumSq += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sumSq / this.buf.length);
    const rawDb = 20 * Math.log10(Math.max(rms, 1e-7));

    // Ambient calibration: collect frames during the calibration window,
    // then take the 30th percentile as the floor (robust to brief noises).
    const now = performance.now();
    if (now < this.calibratingUntil) {
      this.calibrationSamples.push(rawDb);
    } else if (this.calibrationSamples.length >= 5 && this.noiseFloorDb === NOISE_FLOOR_REF) {
      const sorted = this.calibrationSamples.slice().sort((a, b) => a - b);
      this.noiseFloorDb = sorted[Math.floor(sorted.length * 0.3)];
      this.calibrationSamples = [];
    }

    // Hysteresis on clarity — avoids on/off flicker at marginal signal.
    const inRange = pitch > 55 && pitch < 1100;
    if (this.locked) {
      if (clarity < CLARITY_EXIT || !inRange) this.locked = false;
    } else if (clarity > CLARITY_ENTER && inRange) {
      this.locked = true;
    }

    let outFreq = null;
    if (this.locked && inRange) {
      this.medianBuf.push(pitch);
      if (this.medianBuf.length > MEDIAN_WINDOW) this.medianBuf.shift();
      const sorted = this.medianBuf.slice().sort((a, b) => a - b);
      outFreq = sorted[Math.floor(sorted.length / 2)];
    } else {
      this.medianBuf.length = 0;
    }

    // Shift the reported dB so a NOISE_FLOOR_REF floor is consistent across
    // mics. A quieter-than-typical mic (low gain) sees higher absolute dB.
    const normalizedDb = rawDb - (this.noiseFloorDb - NOISE_FLOOR_REF);

    const note = outFreq ? freqToNote(outFreq) : null;
    this.onUpdate({
      freq: outFreq,
      clarity,
      note,
      db: normalizedDb,
      rawDb,
      noiseFloor: this.noiseFloorDb,
      calibrating: now < this.calibratingUntil
    });
  }

  stop() {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.stream = null;
  }
}

// Reference tone player — fundamental + soft harmonics (gives it body, so the
// user can pitch-match without sounding like a beep) and a short metronome
// click for scale exercises.
export class TonePlayer {
  constructor() {
    this.ctx = null;
  }
  _ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  // Run `fn` once the context is actually running. Scheduling against a
  // suspended context fails silently — the envelope can elapse before the
  // async resume lands — which is why "Replay" sometimes did nothing.
  _whenRunning(fn) {
    this._ensure();
    if (this.ctx.state === 'running') { fn(); return; }
    this.ctx.resume().then(fn).catch(fn);
  }

  play(freq, durationMs = 1200) {
    if (!freq) return;
    this._whenRunning(() => {
      const t0 = this.ctx.currentTime;
      const dur = durationMs / 1000;

      const master = this.ctx.createGain();
      master.gain.setValueAtTime(0, t0);
      master.gain.linearRampToValueAtTime(0.18, t0 + 0.04);
      master.gain.linearRampToValueAtTime(0.18, t0 + Math.max(0.05, dur - 0.1));
      master.gain.linearRampToValueAtTime(0, t0 + dur);
      master.connect(this.ctx.destination);

      // Fundamental + two soft harmonics. Sounds like a pitch you can mimic,
      // not a sine beep.
      const harmonics = [
        { mult: 1, gain: 1.0 },
        { mult: 2, gain: 0.42 },
        { mult: 3, gain: 0.16 }
      ];
      for (const h of harmonics) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * h.mult;
        g.gain.value = h.gain;
        osc.connect(g).connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
      }
    });
  }

  /**
   * Short metronome click. Used by scale challenges to cue the user when to
   * move to the next note. Very quiet by default so it doesn't drown the mic.
   */
  tick(volume = 0.12) {
    this._whenRunning(() => {
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 1400;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(volume, t0 + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.08);
    });
  }
}
