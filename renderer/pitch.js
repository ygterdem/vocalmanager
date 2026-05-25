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

const clamp01 = (x) => Math.max(0, Math.min(1, x));

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
    // Live voice monitoring (Freestyle "hear my voice"): mic → gain → reverb
    // mix → stereo panner → speakers. Off by default; chain built lazily.
    this.monitor = { enabled: false, pan: 0, reverb: 0, level: 0.85 };
    this.monitorGain = null;
    // Reference (PC audio) pitch detection, running alongside the mic so the
    // user can pitch-match a track playing on the PC. Off until startReference().
    this.refAnalyser = null;
    this.refDetector = null;
    this.refStream = null;
    this.refInput = null;
    this.refBuf = null;
    this.refMedianBuf = [];
    this.refLocked = false;
  }

  async start() {
    if (this.running) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Some platforms start the context suspended; resume after the user
    // gesture that triggered start() (mic button click counts).
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (_) {}
    }
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    this.detector = PitchDetector.forFloat32Array(this.analyser.fftSize);
    // Looser thresholds so soft ng-sirens and lip trills (which are nasal /
    // buzzy and lower-clarity than a clear sung tone) still register.
    this.detector.minVolumeDecibels = -55;
    this.buf = new Float32Array(this.detector.inputLength);
    // Frequency-domain buffer for timbre/spectral features + the spectrum view.
    this.freqData = new Float32Array(this.analyser.frequencyBinCount);
    this.binHz = this.ctx.sampleRate / this.analyser.fftSize;
    this.medianBuf = [];
    this.locked = false;
    this.noiseFloorDb = NOISE_FLOOR_REF;
    this.calibrationSamples = [];
    this.calibratingUntil = performance.now() + 800;

    await this.useMic();
    this.running = true;
    this.timer = setInterval(() => this._tick(), TICK_MS);
  }

  _attachStream(stream) {
    if (this.input) { try { this.input.disconnect(); } catch (_) {} }
    if (this.stream && this.stream !== stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    this.stream = stream;
    this.input = this.ctx.createMediaStreamSource(stream);
    this.input.connect(this.analyser);
    // Keep live monitoring wired to whatever source is current.
    if (this.monitorGain) { try { this.input.connect(this.monitorGain); } catch (_) {} }
    this.recalibrate(); // new source → different floor
  }

  async useMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    this._attachStream(stream);
    this.sourceMode = 'mic';
  }

  // Capture system/desktop audio (Windows loopback) so the meters/spectrum can
  // analyze whatever is playing on the PC. Requires the main process's
  // setDisplayMediaRequestHandler to grant loopback audio.
  async useSystemAudio() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach((t) => t.stop()); // we only want audio
    if (!stream.getAudioTracks().length) {
      throw new Error('No system-audio track was provided.');
    }
    this._attachStream(stream);
    this.sourceMode = 'system';
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

    // Frequency-domain snapshot (kept for the spectrum view) + timbre features.
    // Compute whenever there's meaningful signal — not only when a single
    // pitch locks — so system audio (polyphonic music) still gets meters.
    this.analyser.getFloatFrequencyData(this.freqData);
    const hasSignal = normalizedDb > (NOISE_FLOOR_REF + 12);
    const timbre = hasSignal ? this._spectralFeatures(outFreq) : null;

    // Reference (PC audio) pitch — independent analyser/detector with its own
    // hysteresis + median so it doesn't interfere with the mic path.
    const refFreq = this._refPitch();

    const note = outFreq ? freqToNote(outFreq) : null;
    this.onUpdate({
      freq: outFreq,
      clarity,
      note,
      refFreq,
      refNote: refFreq ? freqToNote(refFreq) : null,
      db: normalizedDb,
      rawDb,
      noiseFloor: this.noiseFloorDb,
      calibrating: now < this.calibratingUntil,
      color: timbre ? timbre.color : null,     // 0=dark, 1=bright
      weight: timbre ? timbre.weight : null,    // 0=light, 1=heavy
      breath: timbre ? timbre.breath : null,    // 0=clear, 1=breathy
      centroid: timbre ? timbre.centroid : null
    });
  }

  _binDbAt(freq) {
    const i = Math.round(freq / this.binHz);
    if (i < 0 || i >= this.freqData.length) return -120;
    return this.freqData[i];
  }

  // Derive perceptual timbre measures from the magnitude spectrum. These are
  // relative/uncalibrated (mic, distance, and room shift them) — good for live
  // biofeedback, not absolute scoring.
  _spectralFeatures(f0) {
    const data = this.freqData;
    const binHz = this.binHz;
    const loBin = Math.max(1, Math.floor(80 / binHz));
    const hiBin = Math.min(data.length - 1, Math.floor(6000 / binHz));
    const splitHz = 1800;
    let sumMag = 0, sumFMag = 0, logSum = 0, count = 0, lowE = 0, highE = 0;
    for (let i = loBin; i <= hiBin; i++) {
      const db = data[i];
      if (db < -100) continue;
      const mag = Math.pow(10, db / 20);
      const f = i * binHz;
      sumMag += mag;
      sumFMag += f * mag;
      logSum += Math.log(mag + 1e-9);
      count++;
      if (f < splitHz) lowE += mag; else highE += mag;
    }
    if (sumMag <= 0 || count === 0) return null;

    // Wide input windows (cover full mixes + solo voice) with a moderate
    // expansion so artists/voices spread across the compass without pinning to
    // the edges. GAIN is the one knob: 1.0 = clustered, 1.7 = slams the edges.
    const GAIN = 1.4;
    const expand = (v, g) => clamp01(0.5 + (v - 0.5) * g);

    const centroid = sumFMag / sumMag;
    const color = expand((centroid - 400) / (4200 - 400), GAIN);

    // Weight. With a single pitch (a sung note): H1–H2 — heavy/pressed voices
    // have a strong 2nd harmonic; light/breathy voices are H1-dominant.
    // Without one (polyphonic music): spectral tilt — denser upper-harmonic
    // energy reads "heavier".
    let weight;
    if (f0 && f0 > 0) {
      const h1 = this._binDbAt(f0);
      const h2 = this._binDbAt(2 * f0);
      const h1h2 = h1 - h2;                     // dB
      weight = expand((14 - h1h2) / 28, GAIN);  // +14dB→light(0), -14dB→heavy(1)
    } else {
      weight = expand((highE / (lowE + highE)) * 1.4, GAIN);
    }

    // Breathiness via spectral flatness: noisy/airy tone → flatter spectrum.
    const geoMean = Math.exp(logSum / count);
    const arithMean = sumMag / count;
    const breath = clamp01((geoMean / (arithMean + 1e-9)) * 3.2);

    return { color, weight, breath, centroid };
  }

  // ---- Reference (PC audio) pitch -----------------------------------------
  // Capture system/desktop audio on a second analyser so its pitch can be
  // tracked at the same time as the mic. Works best on monophonic material
  // (a solo vocal or melody line); full mixes give a noisier reference.
  async startReference() {
    if (!this.ctx) throw new Error('Tracker not started');
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach((t) => t.stop()); // audio only
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No system-audio track was provided.');
    }
    this.refStream = stream;
    this.refInput = this.ctx.createMediaStreamSource(stream);
    this.refAnalyser = this.ctx.createAnalyser();
    this.refAnalyser.fftSize = 2048;
    this.refInput.connect(this.refAnalyser);
    this.refDetector = PitchDetector.forFloat32Array(this.refAnalyser.fftSize);
    this.refDetector.minVolumeDecibels = -55;
    this.refBuf = new Float32Array(this.refDetector.inputLength);
    this.refMedianBuf = [];
    this.refLocked = false;
  }

  stopReference() {
    if (this.refInput) { try { this.refInput.disconnect(); } catch (_) {} }
    if (this.refStream) this.refStream.getTracks().forEach((t) => t.stop());
    this.refStream = null;
    this.refInput = null;
    this.refAnalyser = null;
    this.refDetector = null;
    this.refBuf = null;
    this.refMedianBuf = [];
    this.refLocked = false;
  }

  hasReference() { return !!this.refAnalyser; }

  _refPitch() {
    if (!this.refAnalyser) return null;
    this.refAnalyser.getFloatTimeDomainData(this.refBuf);
    const [pitch, clarity] = this.refDetector.findPitch(this.refBuf, this.ctx.sampleRate);
    const inRange = pitch > 55 && pitch < 1100;
    if (this.refLocked) {
      if (clarity < CLARITY_EXIT || !inRange) this.refLocked = false;
    } else if (clarity > CLARITY_ENTER && inRange) {
      this.refLocked = true;
    }
    if (!(this.refLocked && inRange)) { this.refMedianBuf.length = 0; return null; }
    this.refMedianBuf.push(pitch);
    if (this.refMedianBuf.length > MEDIAN_WINDOW) this.refMedianBuf.shift();
    const sorted = this.refMedianBuf.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  // ---- Live voice monitoring ----------------------------------------------
  // Route the mic input back to the output so the user can hear themselves,
  // optionally panned to one ear with a touch of algorithmic reverb. Use
  // headphones — monitoring through speakers with an open mic will feed back.

  // Short decaying-noise impulse response → a simple, CPU-cheap reverb tail.
  _makeReverbIR(seconds = 1.8, decay = 2.4) {
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const ir = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return ir;
  }

  _buildMonitorChain() {
    if (this.monitorGain || !this.ctx) return;
    const ctx = this.ctx;
    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = 0;            // silent until enabled
    this.monitorDry = ctx.createGain();         // unprocessed voice (always 1)
    this.monitorWet = ctx.createGain();         // reverb send level
    this.monitorWet.gain.value = 0;
    this.monitorConv = ctx.createConvolver();
    this.monitorConv.buffer = this._makeReverbIR();
    this.monitorPan = ctx.createStereoPanner(); // -1 left … +1 right
    this.monitorPan.pan.value = this.monitor.pan;

    this.monitorGain.connect(this.monitorDry);
    this.monitorGain.connect(this.monitorConv);
    this.monitorConv.connect(this.monitorWet);
    this.monitorDry.connect(this.monitorPan);
    this.monitorWet.connect(this.monitorPan);
    this.monitorPan.connect(ctx.destination);

    if (this.input) { try { this.input.connect(this.monitorGain); } catch (_) {} }
  }

  _applyMonitor() {
    if (!this.monitorGain) return;
    const t = this.ctx.currentTime;
    this.monitorGain.gain.setTargetAtTime(this.monitor.enabled ? this.monitor.level : 0, t, 0.02);
    this.monitorWet.gain.setTargetAtTime(this.monitor.reverb, t, 0.03);
    this.monitorPan.pan.setTargetAtTime(this.monitor.pan, t, 0.02);
  }

  setMonitorEnabled(on) {
    this._buildMonitorChain();
    this.monitor.enabled = !!on;
    if (on && this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this._applyMonitor();
    return this.monitor.enabled;
  }
  setMonitorPan(pan)     { this.monitor.pan = Math.max(-1, Math.min(1, pan)); this._applyMonitor(); }
  setMonitorReverb(amt)  { this.monitor.reverb = Math.max(0, Math.min(1, amt)); this._applyMonitor(); }
  setMonitorLevel(level) { this.monitor.level = Math.max(0, Math.min(1, level)); this._applyMonitor(); }

  stop() {
    this.running = false;
    this.stopReference();
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.stream = null;
    this.monitorGain = null; // nodes died with the context; rebuild on restart
    this.monitor.enabled = false;
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
