import { PitchTracker, TonePlayer } from './pitch.js';
import {
  ROUTINE,
  noteToFreq,
  freqToNote,
  totalChallengeCount,
  transposeRoutine,
  VOICE_TYPE_OFFSET,
  VOICE_TYPE_LABEL
} from './exercises.js';
import { ChallengeRunner, noteToMidi } from './challenges.js';
import { SONG_LIBRARY, expandSong } from './songs.js';
import { KARAOKE_LIBRARY, expandKaraoke, ChordPad } from './karaoke.js';

const el = (id) => document.getElementById(id);
const tracker = new PitchTracker(handlePitch);
const tone = new TonePlayer();
let pitchTrace = null; // initialized after DOM ready

class PitchTrace {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.history = [];          // {detectedMidi, detectedCents, targetMidi}
    this.maxHistory = 240;      // ~4s at 60fps
    this.tolerance = 50;
    this._resize();
    new ResizeObserver(() => { this._resize(); this.draw(); }).observe(canvas);
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 140;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = h;
  }

  push(detectedMidi, detectedCents, targetMidi, tolerance, db, dbRange) {
    this.history.push({ detectedMidi, detectedCents: detectedCents || 0, targetMidi, db });
    if (this.history.length > this.maxHistory) this.history.shift();
    if (tolerance) this.tolerance = tolerance;
    this.currentDb = db;
    this.dbRange = dbRange; // {min, max} or null
    this.draw();
  }

  clear() {
    this.history = [];
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    const METER_W = 56;            // reserved on right for the dB meter
    const traceW = W - METER_W;
    ctx.clearRect(0, 0, W, H);

    // background
    ctx.fillStyle = '#161821';
    ctx.fillRect(0, 0, W, H);

    const CENTS_RANGE = 200;       // ±2 semitones shown
    const yC = (c) => H / 2 - (c / CENTS_RANGE) * (H / 2 - 10);

    // tolerance band (green tint around target)
    ctx.fillStyle = 'rgba(110, 231, 183, 0.10)';
    ctx.fillRect(0, yC(this.tolerance), traceW, yC(-this.tolerance) - yC(this.tolerance));

    // semitone grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (const c of [-100, -50, 50, 100, 150, -150]) {
      ctx.beginPath();
      ctx.moveTo(0, yC(c));
      ctx.lineTo(traceW, yC(c));
      ctx.stroke();
    }

    // TARGET line (the "bar at the note")
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, yC(0));
    ctx.lineTo(traceW, yC(0));
    ctx.stroke();

    // trace points + connecting line
    const N = this.history.length;
    let prevX = null, prevY = null, prevOnTarget = null;
    for (let i = 0; i < N; i++) {
      const h = this.history[i];
      if (h.detectedMidi == null || h.targetMidi == null) {
        prevX = null; prevY = null; continue;
      }
      const off = (h.detectedMidi - h.targetMidi) * 100 + h.detectedCents;
      const clamped = Math.max(-CENTS_RANGE, Math.min(CENTS_RANGE, off));
      const x = (i / (this.maxHistory - 1)) * (traceW - 14) + 4;
      const y = yC(clamped);
      const onTarget = Math.abs(off) <= this.tolerance;
      const alpha = 0.25 + 0.75 * (i / Math.max(1, N - 1));
      const color = onTarget ? `rgba(110,231,183,${alpha})` : `rgba(245,158,11,${alpha})`;

      if (prevX != null) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();

      prevX = x; prevY = y; prevOnTarget = onTarget;
    }

    // current dot — big, at the most-recent X
    const last = this.history[N - 1];
    if (last && last.detectedMidi != null && last.targetMidi != null) {
      const off = (last.detectedMidi - last.targetMidi) * 100 + last.detectedCents;
      const clamped = Math.max(-CENTS_RANGE, Math.min(CENTS_RANGE, off));
      const x = ((N - 1) / (this.maxHistory - 1)) * (traceW - 14) + 4;
      const y = yC(clamped);
      const onTarget = Math.abs(off) <= this.tolerance;
      ctx.fillStyle = onTarget ? '#6ee7b7' : '#f59e0b';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // cents label next to dot
      ctx.fillStyle = '#e6e8ef';
      ctx.font = '11px -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'right';
      const sign = off > 0 ? '+' : '';
      ctx.fillText(`${sign}${Math.round(off)}¢`, x - 12, y + 4);
    }

    // axis labels
    ctx.fillStyle = '#8a91a6';
    ctx.font = '10px -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('+1 semitone (sharp)', 6, 14);
    ctx.fillText('-1 semitone (flat)', 6, H - 6);
    ctx.fillStyle = '#60a5fa';
    ctx.fillText('TARGET', 6, yC(0) - 4);

    // ----- dB METER (right side) -----
    const meterX = traceW + 8;
    const meterW = METER_W - 16;
    const meterTop = 8;
    const meterBottom = H - 14;
    const meterH = meterBottom - meterTop;
    // track
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(meterX, meterTop, meterW, meterH);
    ctx.strokeStyle = 'var(--line)';
    ctx.strokeStyle = '#262a3a';
    ctx.lineWidth = 1;
    ctx.strokeRect(meterX, meterTop, meterW, meterH);

    const dbToY = (db) => {
      const clamped = Math.max(-60, Math.min(0, db));
      return meterBottom - ((clamped + 60) / 60) * meterH;
    };

    // target zone (only for dynamics challenges)
    if (this.dbRange) {
      const yTop = dbToY(this.dbRange.max);
      const yBot = dbToY(this.dbRange.min);
      ctx.fillStyle = 'rgba(110,231,183,0.22)';
      ctx.fillRect(meterX, yTop, meterW, yBot - yTop);
      ctx.strokeStyle = 'rgba(110,231,183,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(meterX + 0.5, yTop + 0.5, meterW - 1, yBot - yTop - 1);
    }

    // current dB fill (from bottom up to current level)
    if (this.currentDb != null && this.currentDb > -80) {
      const y = dbToY(this.currentDb);
      const inZone = this.dbRange && this.currentDb >= this.dbRange.min && this.currentDb <= this.dbRange.max;
      const fill = inZone ? '#6ee7b7' : (this.dbRange ? '#f59e0b' : '#60a5fa');
      const grad = ctx.createLinearGradient(0, meterBottom, 0, meterTop);
      grad.addColorStop(0, fill + 'cc');
      grad.addColorStop(1, fill);
      ctx.fillStyle = grad;
      ctx.fillRect(meterX + 1, y, meterW - 2, meterBottom - y);
    }

    // gridlines every 10 dB
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let d = -50; d <= -10; d += 10) {
      const y = dbToY(d);
      ctx.beginPath();
      ctx.moveTo(meterX, y);
      ctx.lineTo(meterX + meterW, y);
      ctx.stroke();
    }

    // labels
    ctx.fillStyle = '#8a91a6';
    ctx.font = '9px -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('LOUD', meterX + meterW / 2, meterTop - 2);
    ctx.fillText('QUIET', meterX + meterW / 2, H - 3);
    if (this.currentDb != null) {
      ctx.fillStyle = '#e6e8ef';
      ctx.font = 'bold 11px -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(`${Math.round(this.currentDb)}dB`, meterX + meterW / 2, dbToY(this.currentDb) - 4);
    }
  }
}

class SongRunner {
  constructor(song, canvas, transpose = 0) {
    this.song = expandSong(song, transpose);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.startTime = null;
    this.lastTickAt = null;
    this.onTargetMs = 0;
    this.totalSingMs = 0;
    this.status = 'pending';
    this.lastDetected = null;
    this._resize();
    this._ro = new ResizeObserver(() => { this._resize(); this.draw(); });
    this._ro.observe(canvas);
    this._loop = this._loop.bind(this);
  }
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.W = this.canvas.clientWidth || 800;
    this.H = this.canvas.clientHeight || 240;
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  begin() {
    this.startTime = performance.now();
    this.lastTickAt = this.startTime;
    this.status = 'active';
    requestAnimationFrame(this._loop);
  }
  _loop() {
    if (this.status !== 'active') return;
    const t = performance.now() - this.startTime;
    if (t >= this.song.totalMs) { this.status = 'done'; this.draw(); return; }
    this.draw();
    requestAnimationFrame(this._loop);
  }
  currentTarget() {
    if (!this.startTime) return null;
    const t = performance.now() - this.startTime;
    return this.song.notes.find(n => t >= n.startMs && t < n.endMs) || null;
  }
  tick(midi, cents, db) {
    if (this.status !== 'active') return;
    const now = performance.now();
    const dt = now - this.lastTickAt;
    this.lastTickAt = now;
    const target = this.currentTarget();
    if (target) {
      this.totalSingMs += dt;
      if (midi != null) {
        const off = Math.abs((midi - target.midi) * 100 + (cents || 0));
        if (off <= 80) this.onTargetMs += dt;
      }
    }
    this.lastDetected = midi != null ? { midi, cents: cents || 0 } : null;
    if (performance.now() - this.startTime >= this.song.totalMs) this.status = 'done';
  }
  score() { return this.totalSingMs > 0 ? this.onTargetMs / this.totalSingMs : 0; }
  destroy() { this.status = 'done'; this._ro.disconnect(); }
  draw() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#161821';
    ctx.fillRect(0, 0, W, H);

    const midis = this.song.notes.map(n => n.midi);
    const minM = Math.min(...midis) - 3;
    const maxM = Math.max(...midis) + 3;
    const yC = (m) => H - 20 - ((m - minM) / (maxM - minM)) * (H - 50);

    const playheadX = W * 0.28;
    const visibleMs = 8000;
    const pxPerMs = (W - playheadX) / visibleMs;
    const t = this.startTime ? performance.now() - this.startTime : 0;

    // grid: horizontal lines at each semitone in range
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let m = minM; m <= maxM; m++) {
      ctx.beginPath(); ctx.moveTo(0, yC(m)); ctx.lineTo(W, yC(m)); ctx.stroke();
    }

    // notes
    for (const n of this.song.notes) {
      const x1 = playheadX + (n.startMs - t) * pxPerMs;
      const x2 = playheadX + (n.endMs - t) * pxPerMs;
      if (x2 < -5 || x1 > W) continue;
      const y = yC(n.midi);
      const active = t >= n.startMs && t < n.endMs;
      const done = t >= n.endMs;
      ctx.fillStyle = done ? 'rgba(110,231,183,0.35)' : (active ? '#6ee7b7' : 'rgba(96,165,250,0.55)');
      const xA = Math.max(0, x1), xB = Math.min(W, x2);
      ctx.fillRect(xA, y - 8, xB - xA, 16);
      ctx.fillStyle = '#06121b';
      ctx.font = 'bold 11px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      if (xB - xA > 24) ctx.fillText(n.note, Math.max(2, x1) + 6, y + 4);
    }

    // playhead
    ctx.strokeStyle = 'rgba(245,158,11,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(playheadX, 6); ctx.lineTo(playheadX, H - 6); ctx.stroke();

    // pitch dot
    if (this.lastDetected) {
      const total = this.lastDetected.midi + this.lastDetected.cents / 100;
      const y = yC(total);
      const target = this.currentTarget();
      const onTarget = target && Math.abs((this.lastDetected.midi - target.midi) * 100 + this.lastDetected.cents) <= 80;
      ctx.fillStyle = onTarget ? '#6ee7b7' : '#f59e0b';
      ctx.beginPath(); ctx.arc(playheadX, y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();
    }

    // score & elapsed
    const acc = this.score();
    ctx.fillStyle = '#e6e8ef';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`Accuracy ${Math.round(acc * 100)}%`, W - 10, 18);
    ctx.fillStyle = '#8a91a6';
    ctx.font = '11px sans-serif';
    const secs = Math.max(0, t / 1000);
    const tot = this.song.totalMs / 1000;
    ctx.fillText(`${secs.toFixed(1)}s / ${tot.toFixed(1)}s`, W - 10, 36);

    // axis range labels
    ctx.fillStyle = '#8a91a6';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(midiNameForChart(maxM), 6, 14);
    ctx.fillText(midiNameForChart(minM), 6, H - 6);
  }
}

function midiNameForChart(midi) {
  return freqToNote(440 * Math.pow(2, (midi - 69) / 12)).name;
}

// Pitch trace for Freestyle mode — like PitchTrace, but the Y axis is the
// absolute pitch (auto-scaled to detected range) rather than cents-from-target.
// There is no target, no score — just a live trail of your voice over the last
// few seconds, with note names labeling each octave's C line.
class FreestyleTrace {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.history = [];
    this.maxHistory = 360;
    this.minM = 48; this.maxM = 72;
    this.breakMidi = null; // optional horizontal marker (head-voice trainer)
    this._resize();
    this._ro = new ResizeObserver(() => { this._resize(); this.draw(); });
    this._ro.observe(canvas);
  }
  setBreakLine(midi) { this.breakMidi = midi; this.draw(); }
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.W = this.canvas.clientWidth || 800;
    this.H = this.canvas.clientHeight || 260;
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  push(midi, cents, db, refMidi = null, refCents = 0) {
    this.history.push({ midi, cents: cents || 0, db, refMidi, refCents: refCents || 0 });
    if (this.history.length > this.maxHistory) this.history.shift();
    // Slowly track detected range so the Y-scale isn't jumpy — fold in both
    // your voice and the PC-audio reference so neither clips off-canvas.
    for (const m of [midi != null ? midi + (cents || 0) / 100 : null,
                     refMidi != null ? refMidi + (refCents || 0) / 100 : null]) {
      if (m == null) continue;
      this.minM = Math.min(this.minM, m - 0.5);
      this.maxM = Math.max(this.maxM, m + 0.5);
    }
    this.draw();
  }
  clear() { this.history = []; this.minM = 48; this.maxM = 72; this.draw(); }
  destroy() { this._ro.disconnect(); }
  draw() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#161821';
    ctx.fillRect(0, 0, W, H);

    let { minM, maxM } = this;
    if (maxM - minM < 14) { const c = (minM + maxM)/2; minM = c - 7; maxM = c + 7; }
    const pad = 1;
    const yM = (m) => (H - 16) - ((m - (minM - pad)) / ((maxM + pad) - (minM - pad))) * (H - 32);

    // octave grid lines + labels
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#8a91a6';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    for (let m = Math.ceil(minM - pad); m <= Math.floor(maxM + pad); m++) {
      if (((m % 12) + 12) % 12 === 0) {
        const y = yM(m);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.fillText(midiNameForChart(m), 6, y - 3);
      }
    }

    // Optional break marker (head-voice trainer): dashed line at the register
    // transition, so chest sits below and head above it.
    if (this.breakMidi != null && this.breakMidi >= minM - pad && this.breakMidi <= maxM + pad) {
      const y = yM(this.breakMidi);
      ctx.save();
      ctx.strokeStyle = 'rgba(167,139,250,0.85)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#a78bfa'; ctx.font = '10px -apple-system, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('break · ' + midiNameForChart(this.breakMidi), W - 6, y - 3);
      ctx.restore();
    }

    // Two traces: the PC-audio reference (amber) drawn behind your voice
    // (green), so you can sing to overlay the green line onto the amber.
    const drawTrace = (mKey, cKey, lineColor, dotColor) => {
      let prevX = null, prevY = null;
      for (let i = 0; i < this.history.length; i++) {
        const h = this.history[i];
        if (h[mKey] == null) { prevX = null; prevY = null; continue; }
        const m = h[mKey] + (h[cKey] || 0) / 100;
        const x = (i / (this.maxHistory - 1)) * (W - 12) + 4;
        const y = yM(m);
        const alpha = 0.25 + 0.75 * (i / Math.max(1, this.history.length - 1));
        const col = lineColor(alpha);
        if (prevX != null) {
          ctx.strokeStyle = col; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(prevX, prevY); ctx.lineTo(x, y); ctx.stroke();
        }
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
        prevX = x; prevY = y;
      }
      const last = this.history[this.history.length - 1];
      if (last && last[mKey] != null) {
        const m = last[mKey] + (last[cKey] || 0) / 100;
        const x = ((this.history.length - 1) / (this.maxHistory - 1)) * (W - 12) + 4;
        const y = yM(m);
        ctx.fillStyle = dotColor;
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();
      }
    };
    drawTrace('refMidi', 'refCents', (a) => `rgba(251,191,36,${a})`, '#fbbf24'); // PC audio
    drawTrace('midi', 'cents', (a) => `rgba(110,231,183,${a})`, '#6ee7b7');       // your voice
  }
}

const state = {
  micEnabled: false,
  sessionActive: false,
  exIdx: 0,
  chIdx: 0,
  runner: null,
  songRunner: null,
  passedCount: 0,
  skippedCount: 0,
  xpEarned: 0,
  todayMaxMidi: null,
  todayMinMidi: null,
  lastDetectedMidi: null,
  countdownActive: false,
  profileLowMidi: null,
  profileHighMidi: null,
  stabilityScores: [],
  recorder: null,
  recordingUrl: null,
  voiceType: 'baritone',
  routine: ROUTINE,
  customRoutines: [],
  activeRoutineId: null,
  earActive: false,
  breathActive: false,
  headVoiceActive: false,
  hvTimer: null,
  hvTrace: null,
  intervalTimers: [],
  builderDraft: null
};

const XP_PER_CHALLENGE = 10;

function setSessionLabel(text) { el('sessionLabel').textContent = text; }

// ---------- IDLE ----------
function renderRoutinePreview() {
  const wrap = el('routinePreview');
  wrap.innerHTML = state.routine.map(
    (ex) => `<div class="step"><strong>${ex.name}</strong> · ${ex.challenges.length} tasks</div>`
  ).join('');
}
const VIEW_TO_TAB = {
  idleCard: 'practice', sessionPanel: 'practice', summaryPanel: 'practice', routineBuilderPanel: 'practice',
  songPicker: 'songs', songPlayer: 'songs',
  karaokePicker: 'karaoke', karaokePlayer: 'karaoke',
  freestylePanel: 'freestyle',
  earPanel: 'ear',
  breathPanel: 'breath',
  headVoicePanel: 'headvoice',
  intervalsPanel: 'intervals',
  dashboardPanel: 'progress'
};

function _showOnly(id) {
  for (const x of ['idleCard', 'sessionPanel', 'summaryPanel', 'songPicker', 'songPlayer', 'karaokePicker', 'karaokePlayer', 'freestylePanel', 'dashboardPanel', 'earPanel', 'breathPanel', 'headVoicePanel', 'intervalsPanel', 'routineBuilderPanel']) {
    const node = el(x);
    if (node) node.style.display = (x === id) ? '' : 'none';
  }
  // Range panel is contextual to the idle view — singing/training views
  // already have their own pitch readouts. Hiding it keeps everything in
  // viewport without forcing a scrollbar.
  const range = el('rangePanel');
  if (range) range.style.display = (id === 'idleCard') ? '' : 'none';
  setActiveTab(VIEW_TO_TAB[id]);
}

function setActiveTab(tab) {
  for (const t of document.querySelectorAll('.tab')) {
    t.classList.toggle('active', t.dataset.tab === tab);
  }
}

// Tab navigation: tear down whatever's active, then open the destination.
function navigateTo(tab) {
  teardownCurrent();
  switch (tab) {
    case 'practice':  showIdle(); break;
    case 'songs':     showSongPicker(); break;
    case 'karaoke':   showKaraokePicker(); break;
    case 'freestyle': enterFreestyle(); break;
    case 'ear':       enterEar(); break;
    case 'breath':    enterBreath(); break;
    case 'headvoice': enterHeadVoice(); break;
    case 'intervals': enterIntervals(); break;
    case 'progress':  showDashboard(); break;
    default:          showIdle();
  }
}

function teardownCurrent() {
  if (state.sessionActive) {
    state.sessionActive = false;
    state.runner = null;
    clearMetronome();
    stopRecording();
    restoreBaseRoutine();
  }
  state.earActive = false;
  state.breathActive = false;
  if (state.headVoiceActive || state.hvTimer || state.hvTrace) stopHeadVoice();
  if (state.intervalTimers) { state.intervalTimers.forEach(clearTimeout); state.intervalTimers = []; }
  if (state.freestyleActive) {
    state.freestyleActive = false;
    state.freestyleRecording = false;
    stopFreestyleRecording();
    tracker.setMonitorEnabled(false);
    stopMatchSource();
    if (state.freestyleTrace) { state.freestyleTrace.destroy(); state.freestyleTrace = null; }
  }
  restoreMicSource();
  if (state.songRunner) { state.songRunner.destroy(); state.songRunner = null; }
  if (state.chordPad) { state.chordPad.stop(); state.chordPad = null; }
  if (state.karaokeAudio) { try { state.karaokeAudio.pause(); state.karaokeAudio.currentTime = 0; } catch (e) {} }
}
function showIdle()         { _showOnly('idleCard'); renderDailyPlan(); }

function dpTodayKey() {
  const d = new Date();
  return `dp-done-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Three short suggested activities for today. Head voice + ear are constant; the
// third rotates by weekday so it doesn't feel repetitive.
function dailyPlanItems() {
  const rotating = [
    { tab: 'songs', icon: '🎵', title: 'Sing a song in your range', sub: 'auto-fit to your voice' },
    { tab: 'breath', icon: '🫁', title: 'Steady a long note', sub: 'build breath support' },
    { tab: 'intervals', icon: '🎯', title: 'Hear the intervals', sub: 'name the distance' }
  ];
  return [
    { tab: 'headvoice', icon: '🪶', title: 'Warm up & head voice', sub: 'sirens + clear tone' },
    { tab: 'ear', icon: '👂', title: 'Train your ear', sub: '8 quick rounds' },
    rotating[new Date().getDay() % rotating.length]
  ];
}

async function renderDailyPlan() {
  const wrap = el('dailyPlan');
  if (!wrap) return;
  const items = dailyPlanItems();
  const key = dpTodayKey();
  let done = [];
  try { done = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) {}
  let streak = 0;
  try { const st = await window.vm.getStats(); streak = st.streak || 0; } catch (_) {}
  const doneCount = items.filter((it) => done.includes(it.tab)).length;
  const allDone = doneCount === items.length;
  wrap.innerHTML = `
    <div class="dp-head">
      <span class="dp-title">Today's plan</span>
      <span class="dp-streak">🔥 ${streak} day${streak === 1 ? '' : 's'} · ${doneCount}/${items.length}</span>
    </div>
    <div class="dp-sub">A few minutes each — gentle and consistent beats long and hard.</div>
    <div class="dp-items">
      ${items.map((it) => `
        <button class="dp-item ${done.includes(it.tab) ? 'done' : ''}" data-tab="${it.tab}">
          <span class="dp-check">${done.includes(it.tab) ? '✓' : ''}</span>
          <span class="dp-item-text"><span class="dp-it-title">${it.icon} ${it.title}</span><br><span class="dp-it-sub">${it.sub}</span></span>
          <span class="dp-arrow">→</span>
        </button>`).join('')}
    </div>
    ${allDone ? '<div class="dp-done-all">✓ Plan complete — nice work. See you tomorrow! 🔥</div>' : ''}
  `;
  for (const btn of wrap.querySelectorAll('.dp-item')) {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (!done.includes(tab)) { done.push(tab); localStorage.setItem(key, JSON.stringify(done)); }
      navigateTo(tab);
    });
  }
}
function showSession()      { _showOnly('sessionPanel'); }
function showSummary()      { _showOnly('summaryPanel'); }
function showSongPicker()   { _showOnly('songPicker'); renderSongList(); }
function showSongPlayer()   { _showOnly('songPlayer'); }
function showKaraokePicker(){ _showOnly('karaokePicker'); renderKaraokeList(); }
function showKaraokePlayer(){ _showOnly('karaokePlayer'); }
function showFreestyle()    { _showOnly('freestylePanel'); }
function showDashboard()    { _showOnly('dashboardPanel'); renderDashboard(); }
function showEarPanel()     { _showOnly('earPanel'); }
function showBreathPanel()  { _showOnly('breathPanel'); }
function showHeadVoicePanel(){ _showOnly('headVoicePanel'); }
function showIntervalsPanel(){ _showOnly('intervalsPanel'); }
function showRoutineBuilder(){ _showOnly('routineBuilderPanel'); renderBuilderRoutineList(); }

// ---------- SESSION ----------
async function startSession() {
  if (!state.micEnabled) {
    const ok = await enableMic();
    if (!ok) return;
  }

  // Spaced focus: each session opens with one extra rep of an exercise that
  // gets selected by simple rotation across recent sessions. Cheap, but it
  // makes sure every area sees attention even if the user always quits
  // halfway through.
  const stats = await window.vm.getStats();
  const focusIdx = ((stats.sessions || []).length) % state.routine.length;
  const baseEx = state.routine[focusIdx];
  const focusEx = {
    name: `Today's focus: ${baseEx.name}`,
    tip: `One extra rep on this area before the full routine — keeps it sharp.`,
    challenges: [baseEx.challenges[0]]
  };
  state.baseRoutine = state.routine;
  state.routine = [focusEx, ...state.routine];

  state.sessionActive = true;
  state.exIdx = 0;
  state.chIdx = 0;
  state.passedCount = 0;
  state.skippedCount = 0;
  state.xpEarned = 0;
  state.todayMaxMidi = null;
  state.todayMinMidi = null;
  state.stabilityScores = [];
  if (state.recordingUrl) { URL.revokeObjectURL(state.recordingUrl); state.recordingUrl = null; }
  startRecording();
  showSession();
  setSessionLabel('Session in progress · recording');
  loadChallenge();
}

function restoreBaseRoutine() {
  if (state.baseRoutine) {
    state.routine = state.baseRoutine;
    state.baseRoutine = null;
  }
}

// ---------- SING-ALONG ----------
function renderSongList() {
  el('songList').innerHTML = SONG_LIBRARY.map(s => `
    <div class="song-card" data-id="${s.id}">
      <div class="song-card-title">${s.title}</div>
      <div class="song-card-desc">${s.description}</div>
      <div class="song-card-style"><strong>Style:</strong> ${s.style}</div>
      <div class="song-card-meta">${s.notes.length} notes · ${s.bpm} bpm · ${(s.notes[s.notes.length-1].beat + s.notes[s.notes.length-1].beats) / s.bpm * 60 | 0}s</div>
    </div>
  `).join('');
  for (const card of el('songList').children) {
    card.addEventListener('click', () => openSong(card.dataset.id));
  }
}

async function openSong(songId) {
  if (!state.micEnabled) {
    const ok = await enableMic();
    if (!ok) return;
  }
  const song = SONG_LIBRARY.find(s => s.id === songId);
  if (!song) return;
  el('spTitle').textContent = song.title;
  el('spStyle').textContent = song.style;
  el('spScore').textContent = 'Ready — press Start';
  el('spStartBtn').style.display = '';
  el('spReplayBtn').style.display = 'none';
  showSongPlayer();

  // Lazily create the runner so the canvas is sized first. Auto-fit the key to
  // the user's comfortable range (snapped to whole octaves) so a low voice can
  // actually sing it.
  state.currentSong = song;
  state.songTranspose = autoFitTranspose(song);
  if (state.songRunner) state.songRunner.destroy();
  if (state.songWatcher) { clearInterval(state.songWatcher); state.songWatcher = null; }
  state.songRunner = new SongRunner(song, el('songCanvas'), state.songTranspose);
  state.songRunner.draw();
  renderSongKey();
}

// Octave shift that best centres a song in the user's comfortable range.
function autoFitTranspose(song) {
  if (state.profileLowMidi == null || state.profileHighMidi == null) return 0;
  const midis = song.notes.map((n) => noteToMidi(n.note));
  const songCenter = (Math.min(...midis) + Math.max(...midis)) / 2;
  const userCenter = (state.profileLowMidi + state.profileHighMidi) / 2;
  return Math.round((userCenter - songCenter) / 12) * 12; // whole octaves keep it natural
}

function renderSongKey() {
  const t = state.songTranspose || 0;
  const a = Math.abs(t);
  let label = t === 0 ? 'original'
    : a % 12 === 0 ? `${t > 0 ? '+' : '−'}${a / 12} octave${a / 12 === 1 ? '' : 's'}`
    : `${t > 0 ? '+' : '−'}${a} semitone${a === 1 ? '' : 's'}`;
  if (state.currentSong) {
    const midis = state.currentSong.notes.map((n) => noteToMidi(n.note) + t);
    label += `  ·  ${midiToName(Math.min(...midis))}–${midiToName(Math.max(...midis))}`;
  }
  el('spKeyReadout').textContent = label;
}

// Re-key the song and reset to "ready" (changing key mid-take just restarts).
function applySongTranspose(t) {
  state.songTranspose = Math.max(-36, Math.min(36, t));
  if (!state.currentSong) return;
  if (state.songWatcher) { clearInterval(state.songWatcher); state.songWatcher = null; }
  if (state.songRunner) state.songRunner.destroy();
  state.songRunner = new SongRunner(state.currentSong, el('songCanvas'), state.songTranspose);
  state.songRunner.draw();
  renderSongKey();
  el('spStartBtn').style.display = '';
  el('spReplayBtn').style.display = 'none';
  el('spScore').textContent = 'Ready — press Start';
}

function startSong() {
  if (!state.songRunner) return;
  el('spStartBtn').style.display = 'none';
  el('spScore').textContent = 'Listening…';
  state.songRunner.begin();
  // Drive a status check loop — the canvas auto-redraws via its own RAF
  if (state.songWatcher) clearInterval(state.songWatcher);
  state.songWatcher = setInterval(() => {
    if (!state.songRunner) { clearInterval(state.songWatcher); state.songWatcher = null; return; }
    if (state.songRunner.status === 'done') {
      clearInterval(state.songWatcher); state.songWatcher = null;
      finishSong();
    }
  }, 200);
}

function finishSong() {
  const sr = state.songRunner;
  if (!sr) return;
  const pct = Math.round(sr.score() * 100);
  const label = pct >= 85 ? 'Excellent' : pct >= 65 ? 'Good' : pct >= 40 ? 'Getting there' : 'Try again';
  el('spScore').textContent = `${pct}% — ${label}`;
  el('spReplayBtn').style.display = '';
  sr.draw();
}

function quitSong() {
  if (state.songWatcher) { clearInterval(state.songWatcher); state.songWatcher = null; }
  if (state.songRunner) { state.songRunner.destroy(); state.songRunner = null; }
  showIdle();
}

// ---------- KARAOKE ----------
// Runtime-only custom songs loaded via the import flow.
const customSongs = [];

function renderKaraokeList() {
  const all = [...customSongs, ...KARAOKE_LIBRARY];
  el('karaokeList').innerHTML = all.map(s => {
    const lastNote = s.notes[s.notes.length - 1];
    const secs = ((lastNote.beat + lastNote.beats) / s.bpm * 60) | 0;
    const isCustom = !!s._custom;
    const backing = s.audioUrl ? 'audio backing' : 'chord pad backing';
    return `<div class="song-card karaoke ${isCustom ? 'custom' : ''}" data-id="${s.id}">
      <div class="song-card-title">${isCustom ? '⭐ ' : '🎤 '}${s.title || s.id}</div>
      <div class="song-card-desc">${s.description || (isCustom ? '(imported)' : '')}</div>
      ${s.style ? `<div class="song-card-style"><strong>Style:</strong> ${s.style}</div>` : ''}
      <div class="song-card-meta">${s.notes.length} notes · ${s.bpm} bpm · ${secs}s · ${backing}</div>
    </div>`;
  }).join('');
  for (const card of el('karaokeList').children) {
    card.addEventListener('click', () => openKaraoke(card.dataset.id));
  }
}

function findKaraokeById(id) {
  return customSongs.find(s => s.id === id) || KARAOKE_LIBRARY.find(s => s.id === id);
}

async function openKaraoke(songId) {
  if (!state.micEnabled) {
    const ok = await enableMic();
    if (!ok) return;
  }
  const song = findKaraokeById(songId);
  if (!song) return;
  el('kpTitle').textContent = song.title || song.id;
  el('kpStyle').textContent = song.style || (song._custom ? '(imported song)' : '');
  el('kpScore').textContent = song.audioUrl ? 'Ready — audio backing will play with the chart' : 'Ready — press Start';
  el('kpStartBtn').style.display = '';
  el('kpReplayBtn').style.display = 'none';
  renderLyrics(song, null);
  showKaraokePlayer();

  if (state.songRunner) state.songRunner.destroy();
  if (state.chordPad) state.chordPad.stop();
  if (state.karaokeAudio) { state.karaokeAudio.pause(); state.karaokeAudio.currentTime = 0; }
  state.songRunner = new SongRunner(expandKaraokeForRunner(song), el('karaokeCanvas'));
  state.songRunner.draw();

  // Set up audio element for imported songs with backing tracks
  if (song.audioUrl) {
    if (!state.karaokeAudio) {
      state.karaokeAudio = new Audio();
      state.karaokeAudio.preload = 'auto';
    }
    state.karaokeAudio.src = song.audioUrl;
    state.karaokeAudio.currentTime = 0;
  } else {
    state.karaokeAudio = null;
  }
}

// SongRunner expects the schema from expandSong; expandKaraoke has the same
// fields plus `lyric` and `chords`. The shapes overlap, so we can pass it
// through, but make sure the totalMs is right.
function expandKaraokeForRunner(song) {
  const k = expandKaraoke(song);
  // SongRunner reads .song.notes and .song.totalMs; both are present.
  // Wrap as a song-like object with id/title for replay button:
  return { ...k, id: song.id };
}

function startKaraoke() {
  const sr = state.songRunner;
  if (!sr) return;
  const song = findKaraokeById(sr.song.id);
  if (!song) return;
  el('kpStartBtn').style.display = 'none';
  el('kpScore').textContent = 'Listening…';

  // Backing: audio file if provided, otherwise generate a chord pad from the
  // chord progression in the chart.
  if (song.audioUrl && state.karaokeAudio) {
    state.karaokeAudio.currentTime = 0;
    state.karaokeAudio.play().catch(e => console.warn('[karaoke audio]', e));
  } else if (song.chords && song.chords.length) {
    state.chordPad = new ChordPad();
    state.chordPad.scheduleProgression(song.chords, song.bpm, 0);
  }
  sr.begin();

  const watcher = setInterval(() => {
    if (!state.songRunner) { clearInterval(watcher); return; }
    const t = performance.now() - state.songRunner.startTime;
    renderLyrics(song, t);
    if (state.songRunner.status === 'done') {
      clearInterval(watcher);
      finishKaraoke();
    }
  }, 80);
}

function finishKaraoke() {
  const sr = state.songRunner;
  if (!sr) return;
  if (state.chordPad) { state.chordPad.stop(); state.chordPad = null; }
  if (state.karaokeAudio) { state.karaokeAudio.pause(); }
  const pct = Math.round(sr.score() * 100);
  const label = pct >= 85 ? 'Excellent' : pct >= 65 ? 'Good' : pct >= 40 ? 'Getting there' : 'Try again';
  el('kpScore').textContent = `${pct}% — ${label}`;
  el('kpReplayBtn').style.display = '';
  sr.draw();
}

function quitKaraoke() {
  if (state.songRunner) { state.songRunner.destroy(); state.songRunner = null; }
  if (state.chordPad) { state.chordPad.stop(); state.chordPad = null; }
  if (state.karaokeAudio) { state.karaokeAudio.pause(); state.karaokeAudio.currentTime = 0; }
  showIdle();
}

// ---------- CUSTOM SONG IMPORT ----------
function showImportStatus(msg, isError) {
  const s = el('importStatus');
  s.textContent = msg;
  s.className = 'import-status' + (isError ? ' err' : ' ok');
  if (!msg) s.className = 'import-status';
}

function validateChart(obj) {
  if (!obj || typeof obj !== 'object') return 'JSON must be an object.';
  if (!obj.bpm || typeof obj.bpm !== 'number') return 'Missing or invalid `bpm` (number).';
  if (!Array.isArray(obj.notes) || obj.notes.length === 0) return 'Missing `notes` array (or empty).';
  for (const n of obj.notes) {
    if (typeof n.note !== 'string') return 'Each note needs a `note` string (e.g. "D4").';
    if (typeof n.beat !== 'number') return 'Each note needs a numeric `beat`.';
    if (typeof n.beats !== 'number') return 'Each note needs a numeric `beats` (duration).';
    if (noteToMidi(n.note) == null) return `Invalid note name: ${n.note}`;
  }
  return null;
}

async function loadCustomSong() {
  const chartFile = el('importChart').files[0];
  const audioFile = el('importAudio').files[0];
  if (!chartFile) { showImportStatus('Pick a chart .json file first.', true); return; }
  try {
    const text = await chartFile.text();
    let chart;
    try { chart = JSON.parse(text); } catch (e) {
      showImportStatus('That file isn\'t valid JSON: ' + e.message, true); return;
    }
    const err = validateChart(chart);
    if (err) { showImportStatus(err, true); return; }

    let audioUrl = null;
    if (audioFile) audioUrl = URL.createObjectURL(audioFile);

    const id = chart.id || ('custom-' + Date.now());
    // Replace if an existing custom song has the same id
    const existing = customSongs.findIndex(s => s.id === id);
    if (existing >= 0) {
      if (customSongs[existing].audioUrl) URL.revokeObjectURL(customSongs[existing].audioUrl);
      customSongs.splice(existing, 1);
    }
    const song = {
      ...chart,
      id,
      title: chart.title || chartFile.name.replace(/\.json$/i, ''),
      description: chart.description || 'Imported chart' + (audioFile ? ` + ${audioFile.name}` : ''),
      style: chart.style || '',
      audioUrl,
      _custom: true
    };
    customSongs.unshift(song);
    renderKaraokeList();
    showImportStatus(`Loaded "${song.title}" — ${chart.notes.length} notes${audioUrl ? ', audio attached' : ', chord pad will be used'}.`, false);
    el('importChart').value = '';
    el('importAudio').value = '';
  } catch (e) {
    showImportStatus('Failed to load: ' + e.message, true);
  }
}

const SCHEMA_HELP = `{
  "id": "my-song",               // optional, unique among your imports
  "title": "My Song",
  "description": "...",          // optional
  "style": "soft and slow",      // optional, shown in the card
  "bpm": 70,                     // required — beats per minute
  "chords": [                    // optional — used when no audio backing
    { "chord": "Am", "beat": 0,  "beats": 4 },
    { "chord": "F",  "beat": 4,  "beats": 4 }
  ],
  "lines": ["line one", "line two"],   // optional — purely for reference
  "notes": [                     // required
    {
      "note": "D4",              // pitch (A0..G#9 with #/b)
      "beat": 0,                 // start beat (quarter-note units)
      "beats": 2,                // duration in beats
      "lyric": "stay",           // optional, displayed under the canvas
      "lineIndex": 0             // optional, groups notes into lyric lines
    }
  ]
}`;

// ---------- FREESTYLE ----------
async function enterFreestyle() {
  if (!state.micEnabled) {
    const ok = await enableMic();
    if (!ok) return;
  }
  showFreestyle();
  if (!state.freestyleTrace) {
    state.freestyleTrace = new FreestyleTrace(el('freestyleCanvas'));
  } else {
    state.freestyleTrace.clear();
  }
  state.freestyleActive = true;
  state.freestyleRecording = true;
  clearCompass();
  updateTimbreMeters(null, null, null);
  el('fsRecBtn').textContent = 'Pause recording';
  el('fsStatus').textContent = '● rec';
  el('fsStatus').style.color = '#f87171';
  el('fsPlayback').innerHTML = '';
  if (state.freestyleRecordingUrl) { URL.revokeObjectURL(state.freestyleRecordingUrl); state.freestyleRecordingUrl = null; }
  startFreestyleRecording();
  loadFreestyleMonitorPrefs();
  applyFreestyleMonitor();
  resetFreestyleMatchUI();
  refreshMatchSources();
}

function exitFreestyle() {
  state.freestyleActive = false;
  state.freestyleRecording = false;
  stopFreestyleRecording();
  tracker.setMonitorEnabled(false);
  stopMatchSource();
  if (state.freestyleTrace) { state.freestyleTrace.destroy(); state.freestyleTrace = null; }
  restoreMicSource();
  showIdle();
}

// "Match to PC audio": track a reference's pitch alongside the mic so you can
// sing to overlay your (green) line onto its (amber) line. The reference is
// either the whole system mix (getDisplayMedia loopback) or one captured app
// (process loopback) chosen in the Match-source dropdown.
async function toggleFreestyleMatch() {
  if (tracker.hasReference()) {
    await stopMatchSource();
    resetFreestyleMatchUI();
    return;
  }
  await startMatchSource();
}

async function startMatchSource() {
  const btn = el('fsMatchBtn');
  const sel = el('fsMatchSource');
  const val = (sel && sel.value) || 'system';
  try {
    btn.textContent = 'Starting…'; btn.disabled = true;
    // Keep the mic as the analyzed voice while the reference is something else.
    if (tracker.sourceMode === 'system') {
      await tracker.useMic();
      el('fsSourceBtn').textContent = '🔊 Listen to PC audio';
      el('fsSourceLabel').textContent = 'Source: microphone';
    }
    let label = 'PC audio';
    if (val.startsWith('pid:')) {
      const res = await window.vm.startAppCapture(val.slice(4));
      if (!res || !res.ok) throw new Error((res && res.reason) || 'app capture failed');
      tracker.startAppReference();
      label = sel.options[sel.selectedIndex].textContent;
    } else {
      await tracker.startReference(); // whole-system loopback
    }
    btn.disabled = false;
    btn.textContent = '🎯 Stop matching';
    el('fsMatch').style.display = '';
    el('fsCompassLegend').style.display = '';
    showToast(`Matching ${label} — sing to line your green trace up with the amber one.`, 'ok');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '🎯 Match to PC audio';
    await stopMatchSource();
    showToast('Could not start matching: ' + (e.message || e), 'error');
  }
}

// Tear down whichever reference is running (app capture or system loopback).
async function stopMatchSource() {
  if (tracker.appRefActive) {
    tracker.stopAppReference();
    try { await window.vm.stopAppCapture(); } catch (_) {}
  }
  tracker.stopReference(); // safe no-op if the system loopback isn't running
}

function resetFreestyleMatchUI() {
  const btn = el('fsMatchBtn');
  if (btn) { btn.textContent = '🎯 Match to PC audio'; btn.disabled = false; }
  const m = el('fsMatch');
  if (m) m.style.display = 'none';
  const lg = el('fsCompassLegend');
  if (lg) lg.style.display = 'none';
  setPcTimbre(null, null); // drop the PC dot
}

// Populate the Match-source dropdown with running audio apps (+ system option).
async function refreshMatchSources() {
  const sel = el('fsMatchSource');
  if (!sel) return;
  const prev = sel.value;
  let res = null;
  try { res = await window.vm.listAudioApps(); } catch (_) { res = null; }
  sel.innerHTML = '<option value="system">System audio (all apps)</option>';
  if (res && res.ok) {
    for (const a of res.apps) {
      const o = document.createElement('option');
      o.value = 'pid:' + a.pid;
      o.textContent = a.title.length > 42 ? a.title.slice(0, 41) + '…' : a.title;
      sel.appendChild(o);
    }
  }
  const stored = localStorage.getItem('fsMatchSource');
  const want = [prev, stored].find((v) => v && [...sel.options].some((o) => o.value === v));
  sel.value = want || 'system';
}

// Fold the mic-vs-PC pitch gap to the nearest octave so singing the same note
// in your own register still reads as a match.
function freestyleMatchFeedback(note, refNote) {
  el('fsRefNote').textContent = refNote ? refNote.name : '—';
  el('fsMatchYou').textContent = note ? note.name : '—';
  const arrow = el('fsMatchArrow');
  if (!note || !refNote) { arrow.textContent = '—'; arrow.className = 'fs-match-arrow'; return; }
  let diff = (note.midi * 100 + note.cents) - (refNote.midi * 100 + refNote.cents);
  diff = ((diff % 1200) + 1800) % 1200 - 600; // nearest-octave, -600..+600 cents
  if (Math.abs(diff) <= 35) { arrow.textContent = '✓ matched'; arrow.className = 'fs-match-arrow ok'; }
  else if (diff < 0) { arrow.textContent = '↑ go higher'; arrow.className = 'fs-match-arrow off'; }
  else { arrow.textContent = '↓ go lower'; arrow.className = 'fs-match-arrow off'; }
}

// Live voice monitoring controls (the "Hear my voice" block). Reverb slider is
// a 0–100 send that maps to a gentle wet level; ear select pans -1/0/+1.
function applyFreestyleMonitor() {
  const on = el('fsMonOn').checked;
  tracker.setMonitorPan(Number(el('fsMonEar').value));
  tracker.setMonitorReverb(Number(el('fsMonReverb').value) / 100 * 0.6);
  tracker.setMonitorLevel(Number(el('fsMonLevel').value) / 100);
  tracker.setMonitorEnabled(on);
  el('fsMonControls').classList.toggle('disabled', !on);
  localStorage.setItem('fsMonitor', JSON.stringify({
    on, ear: el('fsMonEar').value, reverb: el('fsMonReverb').value, level: el('fsMonLevel').value
  }));
}

function loadFreestyleMonitorPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('fsMonitor') || '{}');
    if (typeof p.on === 'boolean') el('fsMonOn').checked = p.on;
    if (p.ear != null) el('fsMonEar').value = String(p.ear);
    if (p.reverb != null) el('fsMonReverb').value = p.reverb;
    if (p.level != null) el('fsMonLevel').value = p.level;
  } catch (_) {}
}

// Other modes need the mic; if Freestyle left the tracker on system audio,
// switch it back.
function restoreMicSource() {
  if (tracker.sourceMode === 'system') {
    tracker.useMic().catch((e) => console.warn('[source] back to mic failed', e));
    const btn = el('fsSourceBtn');
    if (btn) { btn.textContent = '🔊 Listen to PC audio'; btn.disabled = false; }
    const lbl = el('fsSourceLabel');
    if (lbl) lbl.textContent = 'Source: microphone';
  }
}

async function toggleFreestyleSource() {
  const btn = el('fsSourceBtn');
  const lbl = el('fsSourceLabel');
  try {
    if (tracker.sourceMode === 'system') {
      await tracker.useMic();
      btn.textContent = '🔊 Listen to PC audio';
      if (lbl) lbl.textContent = 'Source: microphone';
    } else {
      btn.textContent = 'Switching…';
      btn.disabled = true;
      await tracker.useSystemAudio();
      clearCompass();
      // Monitoring PC audio would just echo it back into your ears — turn it off.
      el('fsMonOn').checked = false;
      applyFreestyleMonitor();
      btn.disabled = false;
      btn.textContent = '🎤 Back to mic';
      if (lbl) lbl.textContent = 'Source: PC audio — play a song; note/pitch is N/A for music, watch Color/Weight/spectrum';
      showToast('Now analyzing your PC audio.', 'ok');
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '🔊 Listen to PC audio';
    showToast('Could not capture PC audio: ' + (e.message || e), 'error');
  }
}

function startFreestyleRecording() {
  if (!tracker.stream) return;
  try {
    const rec = new MediaRecorder(tracker.stream, { mimeType: 'audio/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      state.freestyleRecordingUrl = URL.createObjectURL(blob);
      const wrap = el('fsPlayback');
      if (wrap) {
        wrap.innerHTML = `
          <div class="rec-title">Your take</div>
          <audio controls src="${state.freestyleRecordingUrl}"></audio>
          <a class="rec-download" href="${state.freestyleRecordingUrl}" download="vocalmanager-freestyle.webm">Download</a>
        `;
      }
    };
    rec.start(1000);
    state.freestyleRecorder = rec;
  } catch (e) {
    console.warn('[freestyle recorder] start failed', e);
  }
}

function stopFreestyleRecording() {
  if (state.freestyleRecorder && state.freestyleRecorder.state !== 'inactive') {
    try { state.freestyleRecorder.stop(); } catch (e) {}
  }
  state.freestyleRecorder = null;
}

function toggleFreestyleRecording() {
  if (state.freestyleRecording) {
    stopFreestyleRecording();
    state.freestyleRecording = false;
    el('fsRecBtn').textContent = 'Resume recording';
    el('fsStatus').textContent = '⏸ paused';
    el('fsStatus').style.color = 'var(--muted)';
  } else {
    if (state.freestyleRecordingUrl) {
      URL.revokeObjectURL(state.freestyleRecordingUrl);
      state.freestyleRecordingUrl = null;
      el('fsPlayback').innerHTML = '';
    }
    startFreestyleRecording();
    state.freestyleRecording = true;
    el('fsRecBtn').textContent = 'Pause recording';
    el('fsStatus').textContent = '● rec';
    el('fsStatus').style.color = '#f87171';
  }
}

function clearFreestyleTrace() {
  if (state.freestyleTrace) state.freestyleTrace.clear();
}

function renderLyrics(song, currentMs) {
  const lyricsEl = el('karaokeLyrics');
  if (!lyricsEl) return;
  // Determine the active note (if any)
  let activeNoteIdx = -1;
  if (currentMs != null) {
    const beatMs = 60000 / song.bpm;
    for (let i = 0; i < song.notes.length; i++) {
      const n = song.notes[i];
      const startMs = n.beat * beatMs;
      const endMs = (n.beat + n.beats) * beatMs;
      if (currentMs >= startMs && currentMs < endMs) { activeNoteIdx = i; break; }
    }
  }
  // Group notes by line, render lines as divs with word spans
  const linesMap = new Map();
  song.notes.forEach((n, i) => {
    const li = n.lineIndex ?? 0;
    if (!linesMap.has(li)) linesMap.set(li, []);
    linesMap.get(li).push({ noteIdx: i, lyric: n.lyric || '' });
  });
  const lines = [...linesMap.keys()].sort((a, b) => a - b).map(li => {
    const words = linesMap.get(li).map(w => {
      const cls = w.noteIdx === activeNoteIdx ? 'lyr current'
                  : w.noteIdx < activeNoteIdx ? 'lyr past' : 'lyr';
      return `<span class="${cls}">${w.lyric}</span>`;
    }).join(' ');
    return `<div class="lyr-line">${words}</div>`;
  }).join('');
  lyricsEl.innerHTML = lines || '<div class="lyr-line"><em>(wordless — sustain on the vowel)</em></div>';
}

// ---------- RECORDING ----------
function startRecording() {
  if (!tracker.stream) return;
  try {
    const rec = new MediaRecorder(tracker.stream, { mimeType: 'audio/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      state.recordingUrl = URL.createObjectURL(blob);
      attachRecordingToSummary();
    };
    rec.start(1000);
    state.recorder = rec;
  } catch (e) {
    console.warn('[recorder] could not start', e);
  }
}

function stopRecording() {
  if (state.recorder && state.recorder.state !== 'inactive') {
    try { state.recorder.stop(); } catch (e) { console.warn('[recorder] stop failed', e); }
  }
}

function attachRecordingToSummary() {
  const wrap = el('summaryRecording');
  if (!wrap || !state.recordingUrl) return;
  wrap.innerHTML = `
    <div class="rec-title">Session recording</div>
    <audio controls src="${state.recordingUrl}"></audio>
    <a class="rec-download" href="${state.recordingUrl}" download="vocalmanager-session.webm">Download</a>
  `;
}

function loadChallenge() {
  const ex = state.routine[state.exIdx];
  const ch = ex.challenges[state.chIdx];
  el('exName').textContent = ex.name;
  el('exTip').textContent = ex.tip;
  el('exStepText').textContent = `Exercise ${state.exIdx + 1} / ${state.routine.length}`;

  // Dots: one per challenge in this exercise
  const dots = el('exDots');
  dots.innerHTML = '';
  for (let i = 0; i < ex.challenges.length; i++) {
    const d = document.createElement('div');
    d.className = 'dot';
    if (i < state.chIdx) d.classList.add('done');
    else if (i === state.chIdx) d.classList.add('active');
    dots.appendChild(d);
  }

  el('challengeLabel').textContent = `Task ${state.chIdx + 1} of ${ex.challenges.length}: ${ch.label}`;
  el('challengeHint').textContent = ch.subhint || '';

  // Target display
  const targetNoteName = ch.target || ch.from || (ch.sequence && ch.sequence[0]);
  el('targetNote').textContent = formatTargetDisplay(ch);

  el('youNote').textContent = '—';
  el('centsLine').textContent = 'cents: —';
  el('progressFill').style.width = '0%';
  el('progressText').textContent = '0%';
  el('matchIndicator').textContent = 'Get ready…';
  el('matchIndicator').className = 'match-indicator';
  el('weightCoach').textContent = '';
  el('weightCoach').className = 'weight-coach';
  el('passOverlay').classList.remove('show');
  renderCheckpointRow(ch);
  if (pitchTrace) pitchTrace.clear();

  // Play reference, then countdown, then start runner
  playReferenceFor(ch);
  clearMetronome();
  state.countdownActive = true;
  let count = 3;
  el('matchIndicator').textContent = `Starting in ${count}…`;
  const cd = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(cd);
      state.countdownActive = false;
      state.runner = new ChallengeRunner(ch);
      state.runner.begin();
      el('matchIndicator').textContent = 'Sing!';
      if (ch.type === 'scale') startMetronome(ch);
    } else {
      el('matchIndicator').textContent = `Starting in ${count}…`;
    }
  }, 800);
}

function startMetronome(ch) {
  clearMetronome();
  const perNoteMs = (ch && ch.perNoteMs) || 700;
  const seq = ch && ch.type === 'scale' ? ch.sequence : null;
  // Beep the pitch of the note the user is currently trying to find, and keep
  // beeping *that* note every beat until the runner advances (i.e. they've
  // held it long enough). The runner's currentIdx is the live target, so we
  // read it fresh each beat instead of marching a fixed-tempo counter through
  // the whole scale. Falls back to a plain tick if the note can't be resolved.
  const beepMs = Math.min(220, Math.max(120, perNoteMs * 0.35));
  const beat = () => {
    const idx = (state.runner && typeof state.runner.currentIdx === 'number')
      ? state.runner.currentIdx : 0;
    const f = seq && idx < seq.length ? noteToFreq(seq[idx]) : null;
    if (f) tone.play(f, beepMs, 0.12);
    else tone.tick();
  };
  // First beat on "Sing!", then a beep every perNoteMs.
  beat();
  state.metronomeTimer = setInterval(beat, perNoteMs);
}

function clearMetronome() {
  if (state.metronomeTimer) {
    clearInterval(state.metronomeTimer);
    state.metronomeTimer = null;
  }
}

function renderCheckpointRow(ch) {
  const row = el('checkpointRow');
  if (ch.type === 'slide') {
    row.innerHTML = ch.checkpoints.map(name =>
      `<div class="cp-chip" data-cp="${name}"><span class="cp-mark"></span>${name}</div>`
    ).join('');
  } else if (ch.type === 'scale') {
    row.innerHTML = ch.sequence.map(name =>
      `<div class="cp-chip" data-cp="${name}"><span class="cp-mark"></span>${name}</div>`
    ).join('');
  } else {
    row.innerHTML = '';
  }
}

function updateCheckpointRow() {
  if (!state.runner) return;
  const r = state.runner;
  if (r.ch.type === 'slide') {
    const statuses = r.checkpointStatus();
    const chips = el('checkpointRow').children;
    for (let i = 0; i < chips.length; i++) {
      const s = statuses[i];
      const chip = chips[i];
      chip.classList.toggle('hit', s.hit);
      chip.classList.toggle('current', s.current);
      chip.classList.toggle('future', s.future);
      chip.classList.toggle('partial', s.partial);
      chip.classList.toggle('offending', s.offending);
      const mark = chip.querySelector('.cp-mark');
      if (s.hit) mark.textContent = '✓';
      else if (s.offending) mark.textContent = '!';
      else mark.textContent = '';
    }
  } else if (r.ch.type === 'scale') {
    const chips = el('checkpointRow').children;
    for (let i = 0; i < chips.length; i++) {
      const chip = chips[i];
      const done = i < r.currentIdx;
      const active = i === r.currentIdx;
      chip.classList.toggle('hit', done);
      chip.classList.toggle('partial', active);
      const mark = chip.querySelector('.cp-mark');
      mark.textContent = done ? '✓' : '';
    }
  }
}

function formatTargetDisplay(ch) {
  if (ch.type === 'hold')  return ch.target;
  if (ch.type === 'slide') return `${ch.from} → ${ch.to}`;
  if (ch.type === 'scale') return ch.sequence.join(' ');
  return '—';
}

function playReferenceFor(ch) {
  let note = ch.target || ch.from || (ch.sequence && ch.sequence[0]);
  if (!note) return;
  const f = noteToFreq(note);
  if (f) tone.play(f, 1200);
}

function onPass() {
  clearMetronome();
  state.passedCount++;
  state.xpEarned += XP_PER_CHALLENGE;
  el('xpValue').textContent = state.xpEarned;

  // Stability score on the pass overlay (for hold + dynamics)
  const stab = state.runner && state.runner.stabilityScore();
  const avgDb = state.runner && state.runner.avgDb();
  const overlay = el('passOverlay');
  let detail = '';
  if (stab != null) {
    const label = stab < 15 ? 'rock-steady' : stab < 30 ? 'good' : 'wobbly';
    detail += `<div class="pass-detail">stability ${Math.round(stab)}¢ <em>(${label})</em></div>`;
    state.stabilityScores.push(stab);
  }
  if (avgDb != null) {
    detail += `<div class="pass-detail">avg ${Math.round(avgDb)} dB</div>`;
  }
  let detailEl = overlay.querySelector('.pass-extras');
  if (!detailEl) {
    detailEl = document.createElement('div');
    detailEl.className = 'pass-extras';
    overlay.appendChild(detailEl);
  }
  detailEl.innerHTML = detail;

  overlay.classList.add('show');
  setTimeout(advance, 1400);
}

function skipChallenge() {
  if (!state.sessionActive) return;
  state.skippedCount++;
  // Mark current dot skipped
  const dots = el('exDots').children;
  if (dots[state.chIdx]) {
    dots[state.chIdx].classList.remove('active');
    dots[state.chIdx].classList.add('skipped');
  }
  advance();
}

function togglePause() {
  if (!state.sessionActive || !state.runner) return;
  const card = el('challengeCard');
  const btn = el('pauseBtn');
  if (state.runner.status === 'active') {
    state.runner.pause();
    clearMetronome();
    card.classList.add('paused');
    btn.textContent = 'Resume';
    el('matchIndicator').textContent = '⏸ Paused — press P or click Resume';
    el('matchIndicator').className = 'match-indicator';
  } else if (state.runner.status === 'paused') {
    state.runner.resume();
    if (state.runner.ch.type === 'scale') startMetronome(state.runner.ch);
    card.classList.remove('paused');
    btn.textContent = 'Pause';
    el('matchIndicator').textContent = 'Sing!';
  }
}

function quitSession() {
  if (!state.sessionActive) return;
  if (!confirm('Quit this session?')) return;
  state.sessionActive = false;
  state.runner = null;
  clearMetronome();
  stopRecording();
  restoreBaseRoutine();
  showIdle();
  setSessionLabel('Session aborted');
}

function restartChallenge() {
  if (!state.sessionActive) return;
  state.runner = null;
  loadChallenge();
}

function advance() {
  el('passOverlay').classList.remove('show');
  const ex = state.routine[state.exIdx];
  if (state.chIdx < ex.challenges.length - 1) {
    state.chIdx++;
  } else if (state.exIdx < state.routine.length - 1) {
    state.exIdx++;
    state.chIdx = 0;
  } else {
    return endSession();
  }
  loadChallenge();
}

function endSession() {
  state.sessionActive = false;
  state.runner = null;
  clearMetronome();
  stopRecording();
  // Count from the routine actually practiced (may include the focus
  // exercise or be a custom routine), not the built-in default.
  const total = state.routine.reduce((n, ex) => n + ex.challenges.length, 0);
  el('sumPassed').textContent = `${state.passedCount} / ${total}`;
  el('sumXp').textContent = state.xpEarned;
  el('sumTop').textContent = state.todayMaxMidi != null ? midiToName(state.todayMaxMidi) : '—';
  restoreBaseRoutine();
  // Average stability across all in-target hold/dynamics samples this session
  let avgStability = null;
  if (state.stabilityScores.length) {
    avgStability = state.stabilityScores.reduce((a, b) => a + b, 0) / state.stabilityScores.length;
  }
  const stabEl = el('sumStability');
  if (stabEl) {
    if (avgStability != null) {
      const lbl = avgStability < 15 ? 'rock-steady' : avgStability < 30 ? 'good' : 'wobbly';
      stabEl.textContent = `${Math.round(avgStability)}¢ (${lbl})`;
    } else {
      stabEl.textContent = '—';
    }
  }
  const ratio = state.passedCount / total;
  const stars = ratio >= 0.9 ? '★★★' : ratio >= 0.6 ? '★★☆' : ratio >= 0.3 ? '★☆☆' : '☆☆☆';
  el('summaryStars').textContent = stars;
  setSessionLabel(`Session complete — ${state.passedCount}/${total} tasks, +${state.xpEarned} XP`);
  showSummary();

  // Persist XP & streak
  window.vm.recordSession({
    passed: state.passedCount,
    total,
    xp: state.xpEarned,
    topMidi: state.todayMaxMidi,
    avgStability: avgStability != null ? Math.round(avgStability) : null
  }).then((result) => {
    refreshHeaderStats();
    const newly = (result && result._newAchievements) || [];
    showAchievementUnlocks(newly);
  });
}

function showAchievementUnlocks(list) {
  const wrap = el('summaryAchievements');
  if (!wrap) return;
  if (!list || !list.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = '<div class="ach-head">★ Achievement unlocked ★</div>' +
    list.map((a) =>
      `<div class="ach-card">
        <div class="ach-trophy">🏆</div>
        <div class="ach-text">
          <div class="ach-label">${a.label}</div>
          <div class="ach-desc">${a.desc || ''}</div>
        </div>
      </div>`
    ).join('');
  // Also pop a toast so the user sees it even if the summary scrolls off
  for (const a of list) showToast(`Achievement: ${a.label}`, 'ok');
}

// ---------- PITCH HANDLER ----------
function midiToName(midi) {
  return freqToNote(440 * Math.pow(2, (midi - 69) / 12)).name;
}

function handlePitch({ freq, clarity, note, db, color, weight, breath, centroid, refNote, refColor, refWeight }) {
  // Always update the mic-debug line so the user can tell whether the mic
  // is picking up anything at all, even if pitchy filtered the frame out.
  const dbg = el('micDebug');
  if (dbg) {
    const dbStr = db != null ? `${db.toFixed(0)} dB` : '— dB';
    dbg.textContent = note
      ? `mic: ${note.name} (${freq.toFixed(0)} Hz)  clarity ${(clarity || 0).toFixed(2)}  ${dbStr}`
      : `mic: no clear pitch  clarity ${(clarity || 0).toFixed(2)}  ${dbStr}`;
  }
  // Ear training: dedicated handler, no visual target
  if (state.earActive) {
    handleEarPitch(note);
    return;
  }
  // Breath / sustain trainer
  if (state.breathActive) {
    handleBreathPitch(note, db);
    return;
  }
  // Head voice / register trainer
  if (state.headVoiceActive) {
    handleHeadVoicePitch(note, db, breath, weight);
    return;
  }
  // Freestyle: visualize pitch + timbre meters + live spectrum, no targets.
  // When "Match to PC audio" is on, also trace the PC pitch and show how close
  // you are to it.
  if (state.freestyleActive) {
    if (state.freestyleTrace) state.freestyleTrace.push(
      note ? note.midi : null, note ? note.cents : 0, db,
      refNote ? refNote.midi : null, refNote ? refNote.cents : 0
    );
    el('fsCurrent').textContent = note ? note.name : '—';
    el('fsCents').textContent = note ? (note.cents >= 0 ? '+' : '') + note.cents : '—';
    el('fsDb').textContent = db != null ? `${Math.round(db)} dB` : '— dB';
    if (tracker.hasReference()) freestyleMatchFeedback(note, refNote);
    // Plot the PC's timbre as a second compass dot (set before the mic update,
    // which triggers the single redraw).
    setPcTimbre(tracker.hasReference() ? refColor : null, tracker.hasReference() ? refWeight : null);
    // Brightness (compass X) auto-calibrated to your own voice so the dot uses
    // the full range — your neutral sits mid, brightening crosses right. Falls
    // back to the absolute color if no centroid this frame.
    const youColor = centroid != null ? calibrateBrightness(centroid) : color;
    updateTimbreMeters(youColor, weight, breath);
    updateVoiceAnalysis(note, weight, breath, centroid); // after updateTimbreMeters so smC is current
    drawSpectrum();
    return;
  }
  // Sing-along + karaoke delegate to the song runner
  if (state.songRunner) {
    state.songRunner.tick(note ? note.midi : null, note ? note.cents : 0, db);
    return;
  }
  if (!note) {
    el('youNote').textContent = '—';
    el('centsLine').textContent = 'cents: —';
    if (state.runner && state.runner.status === 'active') {
      state.runner.tick(null, 0, db);
      if (pitchTrace) pitchTrace.push(null, 0, state.runner.currentTargetMidi(), state.runner.ch.toleranceCents, db, currentDbRange());
      tickUI();
      updateWeightCoach(null);
    }
    return;
  }
  el('youNote').textContent = note.name;
  el('centsLine').textContent = `cents: ${note.cents >= 0 ? '+' : ''}${note.cents}  ·  ${freq.toFixed(1)} Hz`;
  state.lastDetectedMidi = note.midi;

  // Today's top & bottom within sensible vocal range
  if (note.midi >= 36 && note.midi <= 84) {
    let changed = false;
    if (state.todayMaxMidi == null || note.midi > state.todayMaxMidi) {
      state.todayMaxMidi = note.midi;
      el('rangeTodayHigh').textContent = midiToName(state.todayMaxMidi);
      changed = true;
    }
    if (state.todayMinMidi == null || note.midi < state.todayMinMidi) {
      state.todayMinMidi = note.midi;
      el('rangeTodayLow').textContent = midiToName(state.todayMinMidi);
      changed = true;
    }
    if (changed) renderRangeBar();
  }

  if (state.runner && state.runner.status === 'active') {
    state.runner.tick(note.midi, note.cents, db);
    if (state.runner.justReset) flashReset();
    if (pitchTrace) pitchTrace.push(note.midi, note.cents, state.runner.currentTargetMidi(), state.runner.ch.toleranceCents, db, currentDbRange());
    tickUI(note);
    updateWeightCoach(weight);
    if (state.runner.status === 'passed') onPass();
  }
}

// Advisory timbre cue shown during exercises tagged with coachWeight.
// Advisory only — it never blocks the pass, because spectral weight is
// uncalibrated and shouldn't make a pitch exercise unpassable.
function updateWeightCoach(weight) {
  const elc = el('weightCoach');
  if (!elc) return;
  const ch = state.runner && state.runner.ch;
  if (!ch || !ch.coachWeight) { elc.textContent = ''; elc.className = 'weight-coach'; return; }
  const wantLight = ch.coachWeight === 'light';
  if (weight == null) {
    elc.textContent = wantLight ? 'Aim for a light, thin tone' : 'Aim for full chest weight';
    elc.className = 'weight-coach';
    return;
  }
  const ok = wantLight ? weight < 0.45 : weight > 0.55;
  elc.textContent = wantLight
    ? (ok ? '✓ Light and thin — good' : '↓ Lighten up — let the tone get thinner')
    : (ok ? '✓ Full chest weight — good' : '↑ More weight — fuller chest tone');
  elc.className = 'weight-coach ' + (ok ? 'ok' : 'off');
}

function updateTimbreMeters(color, weight, breath) {
  const b = el('fsBreath');
  if (b) b.style.width = (breath != null ? Math.round(breath * 100) : 0) + '%';
  updateCompass(color, weight);
}

let _compassCtx = null;
const DENS_N = 28;                 // density grid resolution
let densGrid = null;
let smC = null, smW = null;        // smoothed live position (your mic)
let homeC = null, homeW = null;    // slow "home" (characteristic) position
let pcC = null, pcW = null;        // smoothed PC-audio position (match mode)
let briMin = null, briMax = null;  // observed spectral-centroid range (Hz) for brightness auto-cal
let briPeak = null;                // brightest centroid reached this session (Hz)

function clearCompass() {
  densGrid = new Float32Array(DENS_N * DENS_N);
  smC = smW = homeC = homeW = pcC = pcW = null;
  briMin = briMax = briPeak = null;
  resetVoiceAnalysis();
  drawCompass();
}

// Map your spectral centroid (Hz) to 0..1 brightness relative to YOUR own
// observed range, so the compass dot uses the full width regardless of voice
// type. Your neutral lands near the middle; brightening crosses right. The
// fixed 400–4200 Hz absolute scale pins low voices to the left edge, which is
// why a bass "can't pass the middle" — this removes that ceiling.
function calibrateBrightness(hz) {
  if (hz == null) return null;
  if (briMin == null) {
    // Seed a window around the first reading so the dot starts mid, not pinned.
    briMin = hz - 350; briMax = hz + 350;
  } else {
    briMin = Math.min(briMin, hz);
    briMax = Math.max(briMax, hz);
    // Relax the bounds inward very slowly so stale extremes fade over ~a minute
    // and the scale tracks your current voice (without snapping the dot back).
    const mid = (briMin + briMax) / 2;
    briMin += (mid - briMin) * 0.0008;
    briMax += (mid - briMax) * 0.0008;
  }
  if (briPeak == null || hz > briPeak) briPeak = hz; // session-best brightness
  const span = Math.max(500, briMax - briMin); // floor avoids hyper-sensitivity
  return Math.max(0, Math.min(1, (hz - briMin) / span));
}

// ---------- VOICE ANALYSIS (Freestyle) ----------
// Standard voice-type ranges (MIDI). Voice type is really tessitura + timbre;
// from observed range alone this is a ballpark, labelled "(est.)".
const VOICE_TYPES = [
  { name: 'Bass',          lo: 40, hi: 64 }, // E2–E4
  { name: 'Bass-baritone', lo: 43, hi: 67 }, // G2–G4
  { name: 'Baritone',      lo: 45, hi: 69 }, // A2–A4
  { name: 'Tenor',         lo: 48, hi: 72 }, // C3–C5
  { name: 'Countertenor',  lo: 53, hi: 77 }, // F3–F5
  { name: 'Mezzo-soprano', lo: 57, hi: 81 }, // A3–A5
  { name: 'Soprano',       lo: 60, hi: 84 }  // C4–C6
];
// Estimate from range + tessitura (where the voice sits). Tessitura is weighted
// heavily — it's the real basis for voice type — so a stray low/high note
// doesn't flip the result.
function estimateVoiceType(minMidi, maxMidi, center) {
  const c = center != null ? center : (minMidi + maxMidi) / 2;
  let best = null, bestScore = -Infinity;
  for (const v of VOICE_TYPES) {
    const overlap = Math.min(maxMidi, v.hi) - Math.max(minMidi, v.lo);
    const centerDist = Math.abs(c - (v.lo + v.hi) / 2);
    const score = overlap - centerDist * 0.8;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return best && best.name;
}

// Count time spent on each semitone instead of latching all-time min/max, so a
// single glitchy frame (rumble, mic bump, octave-halving at the detector floor)
// can't define your range. A note only counts once held for MIN_FRAMES.
const MIN_FRAMES = 6; // ~150ms at the 40Hz tick
let vlHist = null;    // Int32Array(128): frames spent on each MIDI note
let vlW = null, vlB = null; // slow-smoothed weight / breath for steady descriptors

function resetVoiceAnalysis() {
  vlHist = new Int32Array(128);
  vlW = vlB = null;
}

function updateVoiceAnalysis(note, weight, breath, centroid) {
  if (!vlHist) vlHist = new Int32Array(128);
  if (note && note.midi != null && note.midi >= 0 && note.midi < 128) vlHist[note.midi]++;
  if (weight != null) vlW = vlW == null ? weight : vlW + (weight - vlW) * 0.05;
  if (breath != null) vlB = vlB == null ? breath : vlB + (breath - vlB) * 0.05;

  // Robust range = lowest/highest note held long enough; tessitura = the note
  // below which half your sung time falls (the median).
  let rMin = null, rMax = null, total = 0;
  for (let m = 0; m < 128; m++) {
    const cnt = vlHist[m];
    if (cnt >= MIN_FRAMES) { if (rMin == null) rMin = m; rMax = m; }
    total += cnt;
  }
  let tess = null;
  if (total > 0) {
    let acc = 0;
    for (let m = 0; m < 128; m++) { acc += vlHist[m]; if (acc >= total / 2) { tess = m; break; } }
  }
  // Union with the saved comfortable range (a reliable, deliberate measurement).
  let lo = rMin, hi = rMax;
  if (state.profileLowMidi != null) lo = lo == null ? state.profileLowMidi : Math.min(lo, state.profileLowMidi);
  if (state.profileHighMidi != null) hi = hi == null ? state.profileHighMidi : Math.max(hi, state.profileHighMidi);

  const colorWord = smC == null ? null : smC < 0.35 ? 'Warm' : smC <= 0.65 ? 'Balanced' : 'Bright';
  const weightWord = vlW == null ? null : vlW < 0.4 ? 'Light' : vlW <= 0.6 ? 'Balanced' : 'Full';
  const textureWord = vlB == null ? null : vlB < 0.4 ? 'Clear' : vlB <= 0.6 ? 'Some air' : 'Breathy';
  const haveRange = lo != null && hi != null;
  const wideEnough = haveRange && hi - lo >= 5;
  const type = wideEnough ? estimateVoiceType(lo, hi, tess) : null;

  el('fsAnType').textContent = type ? type + ' (est.)' : haveRange ? 'sing wider to estimate' : '—';
  el('fsAnRange').textContent = haveRange
    ? `${midiToName(lo)}–${midiToName(hi)}${wideEnough ? ' · ' + ((hi - lo) / 12).toFixed(1) + ' oct' : ''}`
    : '—';
  el('fsAnTess').textContent = tess != null ? midiToName(tess) : '—';
  el('fsAnColor').textContent = colorWord ? `${colorWord} · ${Math.round(smC * 100)}% vs your neutral` : '—';
  el('fsAnWeight').textContent = weightWord || '—';
  el('fsAnTexture').textContent = textureWord || '—';
  el('fsAnBright').textContent = (centroid != null ? Math.round(centroid / 10) * 10 + ' Hz' : '—')
    + (briPeak != null ? ` · peak ${Math.round(briPeak)} Hz` : '');

  if (type && colorWord && weightWord && textureWord) {
    el('fsAnSummary').textContent =
      `${weightWord}, ${colorWord.toLowerCase()} ${type.toLowerCase()} — ${textureWord.toLowerCase()} tone.`;
  }
}

// Smoothed PC-audio timbre target; null hides the PC dot. Doesn't redraw —
// the following mic update (updateCompass) does the single redraw.
function setPcTimbre(color, weight) {
  if (color == null || weight == null) { pcC = pcW = null; return; }
  if (pcC == null) { pcC = color; pcW = weight; }
  else { pcC += (color - pcC) * 0.30; pcW += (weight - pcW) * 0.30; }
}

function updateCompass(color, weight) {
  if (!densGrid) densGrid = new Float32Array(DENS_N * DENS_N);
  // Decay the heat-cloud so it reflects a moving ~few-second window.
  for (let i = 0; i < densGrid.length; i++) densGrid[i] *= 0.99;
  if (color != null && weight != null) {
    if (smC == null) { smC = color; smW = weight; homeC = color; homeW = weight; }
    else {
      smC += (color - smC) * 0.30;   // fast smoothing for the live dot
      smW += (weight - smW) * 0.30;
      homeC += (color - homeC) * 0.02; // slow average = characteristic timbre
      homeW += (weight - homeW) * 0.02;
    }
    const gx = Math.max(0, Math.min(DENS_N - 1, Math.floor(smC * DENS_N)));
    const gy = Math.max(0, Math.min(DENS_N - 1, Math.floor((1 - smW) * DENS_N)));
    const k = gy * DENS_N + gx;
    densGrid[k] = Math.min(50, densGrid[k] + 1);
  }
  drawCompass();
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r * 255, g * 255, b * 255];
}

// Cached colour-wheel background: hue rotates by angle around the centre,
// saturation/lightness grow with radius — vivid edges, neutral-dark centre
// (no muddy brown like the old bilinear RGB blend).
let _compassBg = null, _compassBgPx = 0;
function compassBg(px) {
  if (_compassBg && _compassBgPx === px) return _compassBg;
  const off = document.createElement('canvas');
  off.width = px; off.height = px;
  const c = off.getContext('2d');
  const img = c.createImageData(px, px);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const nx = (x / (px - 1) - 0.5) * 2;
      const ny = (y / (px - 1) - 0.5) * 2;
      const ang = Math.atan2(ny, nx) * 180 / Math.PI;
      const hue = ((ang + 360) % 360) / 360;
      const rad = Math.min(1, Math.hypot(nx, ny));
      const [r, g, b] = hslToRgb(hue, 0.32 + 0.55 * rad, 0.30 + 0.16 * rad);
      const i = (y * px + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 205;
    }
  }
  c.putImageData(img, 0, 0);
  _compassBg = off; _compassBgPx = px;
  return off;
}

function drawCompass() {
  const canvas = el('fsCompass');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const S = canvas.clientWidth || 150;
  if (canvas.width !== Math.round(S * dpr)) { canvas.width = S * dpr; canvas.height = S * dpr; _compassCtx = null; }
  if (!_compassCtx) _compassCtx = canvas.getContext('2d');
  const ctx = _compassCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#12141c';
  ctx.fillRect(0, 0, S, S);

  const pad = 16;
  const x0 = pad, x1 = S - pad, y0 = pad, y1 = S - pad;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const bw = x1 - x0, bh = y1 - y0;
  const mapX = (c) => x0 + c * bw;          // dark(0) → left, bright(1) → right
  const mapY = (w) => y1 - w * bh;          // light(0) → bottom, heavy(1) → top

  // rounded clip for the plot area
  ctx.save();
  ctx.beginPath();
  const r = 8;
  ctx.moveTo(x0 + r, y0);
  ctx.arcTo(x1, y0, x1, y1, r); ctx.arcTo(x1, y1, x0, y1, r);
  ctx.arcTo(x0, y1, x0, y0, r); ctx.arcTo(x0, y0, x1, y0, r);
  ctx.closePath();
  ctx.clip();

  ctx.drawImage(compassBg(canvas.width), x0, y0, bw, bh);

  // density heat-cloud — brighter where the timbre spends time
  if (densGrid) {
    const cw = bw / DENS_N, ch = bh / DENS_N;
    for (let gy = 0; gy < DENS_N; gy++) {
      for (let gx = 0; gx < DENS_N; gx++) {
        const v = densGrid[gy * DENS_N + gx];
        if (v < 0.4) continue;
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, v / 12)})`;
        ctx.fillRect(x0 + gx * cw, y0 + gy * ch, cw + 0.5, ch + 0.5);
      }
    }
  }
  ctx.restore();

  // axes
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, y0); ctx.lineTo(cx, y1);
  ctx.moveTo(x0, cy); ctx.lineTo(x1, cy);
  ctx.stroke();

  // corner (quadrant) labels
  ctx.font = '8px -apple-system, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.textAlign = 'left';  ctx.fillText('full', x0 + 4, y0 + 11);
  ctx.textAlign = 'right'; ctx.fillText('belty', x1 - 4, y0 + 11);
  ctx.textAlign = 'left';  ctx.fillText('mellow', x0 + 4, y1 - 5);
  ctx.textAlign = 'right'; ctx.fillText('airy', x1 - 4, y1 - 5);

  // edge labels (in the dark margin)
  ctx.fillStyle = '#c8cce0';
  ctx.font = '9px -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('heavy', cx, y0 - 5);
  ctx.fillText('light', cx, y1 + 12);
  ctx.save(); ctx.translate(x0 - 5, cy); ctx.rotate(-Math.PI / 2); ctx.fillText('dark', 0, 0); ctx.restore();
  ctx.save(); ctx.translate(x1 + 5, cy); ctx.rotate(Math.PI / 2); ctx.fillText('bright', 0, 0); ctx.restore();

  // "home" marker — slow average = your characteristic timbre (ring + crosshair).
  // Gold normally; neutral white while matching so it doesn't read as the amber
  // PC dot.
  if (homeC != null) {
    const hx = mapX(homeC), hy = mapY(homeW);
    ctx.strokeStyle = pcC != null ? 'rgba(255,255,255,0.85)' : '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hx - 12, hy); ctx.lineTo(hx + 12, hy);
    ctx.moveTo(hx, hy - 12); ctx.lineTo(hx, hy + 12);
    ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
  }

  // PC-audio live dot (amber, matching the PC pitch trace) — drawn under your
  // dot so yours stays on top when they overlap.
  if (pcC != null) {
    const x = mapX(pcC), y = mapY(pcW);
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
  }

  // Your live position — green when matching (to pair with your green pitch
  // trace), white otherwise; dark ring so it pops on any colour.
  if (smC != null) {
    const x = mapX(smC), y = mapY(smW);
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = pcC != null ? '#6ee7b7' : '#fff'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
  }
}

let _fsSpecCtx = null;
function drawSpectrum() {
  const canvas = el('fsSpectrum');
  if (!canvas || !tracker.freqData) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600, H = canvas.clientHeight || 70;
  if (canvas.width !== Math.round(W * dpr)) { canvas.width = W * dpr; canvas.height = H * dpr; _fsSpecCtx = null; }
  if (!_fsSpecCtx) { _fsSpecCtx = canvas.getContext('2d'); }
  const ctx = _fsSpecCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#161821';
  ctx.fillRect(0, 0, W, H);
  const data = tracker.freqData;
  const binHz = tracker.binHz || 23;
  const maxBin = Math.min(data.length - 1, Math.floor(4000 / binHz));
  for (let i = 1; i <= maxBin; i++) {
    const norm = Math.max(0, Math.min(1, (data[i] + 90) / 90)); // -90dB→0, 0dB→1
    if (norm <= 0.01) continue;
    const x = (i / maxBin) * W;
    const h = norm * (H - 4);
    ctx.fillStyle = `hsl(${160 + (i / maxBin) * 130}, 65%, ${38 + norm * 32}%)`;
    ctx.fillRect(x, H - h, Math.max(1, W / maxBin), h);
  }
}

function currentDbRange() {
  // Only dynamics challenges define a target dB window; other types pass null
  // and the meter just shows the level without a target zone.
  if (!state.runner) return null;
  const ch = state.runner.ch;
  if (ch.type === 'dynamics') return { min: ch.dbMin, max: ch.dbMax };
  return null;
}

function flashReset() {
  const card = el('challengeCard');
  card.classList.remove('reset-flash');
  // restart animation
  void card.offsetWidth;
  card.classList.add('reset-flash');
  const mi = el('matchIndicator');
  mi.textContent = `↻ Out of order — restart the slide from the top`;
  mi.className = 'match-indicator off';
}

function tickUI(note) {
  if (!state.runner) return;
  const r = state.runner;
  const p = Math.round(r.progress() * 100);
  el('progressFill').style.width = p + '%';
  el('progressText').textContent = `${p}%  ${r.subProgressLabel()}`;
  updateCheckpointRow();

  // Match indicator vs current target
  const curTargetMidi = r.currentTargetMidi();
  el('targetNote').textContent = midiToName(curTargetMidi) + suffixForChallenge(r.ch);

  if (note) {
    const totalCents = note.midi * 100 + note.cents;
    const targetTotal = curTargetMidi * 100;
    const tol = r.ch.toleranceCents;
    let matchedOctave = null;
    if (Math.abs(totalCents - targetTotal) <= tol) {
      matchedOctave = 0;
    } else if (r.ch.octaveTolerance) {
      for (let o = 1; o <= r.ch.octaveTolerance; o++) {
        if (Math.abs(totalCents - (targetTotal + o * 1200)) <= tol) { matchedOctave = o; break; }
        if (Math.abs(totalCents - (targetTotal - o * 1200)) <= tol) { matchedOctave = -o; break; }
      }
    }
    const onTarget = matchedOctave !== null;
    el('youNote').classList.toggle('on-target', onTarget);
    const mi = el('matchIndicator');
    if (onTarget) {
      if (matchedOctave === 0) {
        mi.textContent = '✓ On target — keep going';
      } else {
        const label = matchedOctave > 0
          ? `${matchedOctave === 1 ? 'an octave' : matchedOctave + ' octaves'} above`
          : `${matchedOctave === -1 ? 'an octave' : (-matchedOctave) + ' octaves'} below`;
        mi.textContent = `✓ Matched ${label} — fine for this exercise`;
      }
      mi.className = 'match-indicator on';
    } else {
      mi.textContent = `Aim for ${midiToName(curTargetMidi)}`;
      mi.className = 'match-indicator off';
    }
  }
}

function suffixForChallenge(ch) {
  if (ch.type === 'hold') return '';
  if (ch.type === 'slide') return '  (slide)';
  if (ch.type === 'scale') return '  (next)';
  return '';
}

// ---------- MIC ----------
async function enableMic() {
  if (state.micEnabled) return true;
  const btn = el('micBtn');
  btn.textContent = 'Requesting mic…';
  btn.disabled = true;
  try {
    await tracker.start();
    state.micEnabled = true;
    btn.textContent = 'Mic on';
    setSessionLabel('Mic ready.');
    return true;
  } catch (e) {
    console.error('[enableMic]', e);
    btn.textContent = 'Enable microphone';
    btn.disabled = false;
    showToast(
      `Mic blocked: ${e.name || 'Error'} — ${e.message}. Check Windows Settings → Privacy → Microphone.`,
      'error'
    );
    return false;
  }
}

function showToast(msg, kind) {
  if (typeof window.__vmToast === 'function') window.__vmToast(msg, kind);
  else console.warn('[toast]', kind, msg);
}

// Persistent bottom-right update reminder. One toast that evolves from
// "available — downloading…" into "ready — Restart". Deduped by phase+version so
// the 10-min re-checks don't stack duplicates; reappears if the user dismissed
// it and a newer phase/version arrives.
let _updateNotice = { el: null, key: null };
function showUpdateNotice(version, ready) {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const key = (ready ? 'ready:' : 'avail:') + (version || '');
  if (_updateNotice.el && stack.contains(_updateNotice.el) && _updateNotice.key === key) return;
  if (_updateNotice.el) _updateNotice.el.remove();
  const vtxt = version ? 'v' + version : '';
  const t = document.createElement('div');
  t.className = 'toast toast-ok';
  t.innerHTML = ready
    ? `<span class="toast-msg">✨ Update ${vtxt} ready to install.</span>
       <button class="toast-action">Restart now</button>
       <button class="toast-dismiss" aria-label="dismiss">×</button>`
    : `<span class="toast-msg">⬇️ Update ${vtxt} available — downloading…</span>
       <button class="toast-dismiss" aria-label="dismiss">×</button>`;
  if (ready) t.querySelector('.toast-action').addEventListener('click', () => window.vm.installUpdate());
  t.querySelector('.toast-dismiss').addEventListener('click', () => {
    t.remove();
    if (_updateNotice.el === t) _updateNotice = { el: null, key: null };
  });
  stack.appendChild(t);
  _updateNotice = { el: t, key };
}

// ---------- RANGE PROFILE ----------
async function loadProfile() {
  const s = await window.vm.getSettings();
  applyVoiceType((s.voiceProfile && s.voiceProfile.voiceType) || 'baritone');
  el('rangeLow').textContent = s.voiceProfile.lowestComfortable || '—';
  el('rangeHigh').textContent = s.voiceProfile.highestComfortable || '—';
  state.profileLowMidi = s.voiceProfile.lowestComfortable ? noteToMidi(s.voiceProfile.lowestComfortable) : null;
  state.profileHighMidi = s.voiceProfile.highestComfortable ? noteToMidi(s.voiceProfile.highestComfortable) : null;
  renderRangeBar();
  renderRangeHistory();
  refreshHeaderStats();
}

// One horizontal bar showing the user's vocal range: filled from lowestComfortable
// to highestComfortable, with markers labeling each end and today's session top.
// Scale: covers at least C2..C5 but auto-extends if the user's range goes wider.
function renderRangeBar() {
  const container = el('history');
  const lo = state.profileLowMidi;
  const hi = state.profileHighMidi;
  const todayHigh = state.todayMaxMidi;
  const todayLow = state.todayMinMidi;

  if (lo == null && hi == null) {
    container.innerHTML = `<div class="hist-empty">
      Sing a low sustained note and click <strong>Mark as low</strong>, then a high one and <strong>Mark as high</strong>.
      Your range will appear here.
    </div>`;
    return;
  }

  // Scale: floor C2, ceiling C5 — but expand if marks fall outside.
  const candidates = [36, 72];
  if (lo != null) candidates.push(lo - 4);
  if (hi != null) candidates.push(hi + 4);
  if (todayHigh != null) candidates.push(todayHigh + 2);
  if (todayLow != null) candidates.push(todayLow - 2);
  const minM = Math.min(...candidates);
  const maxM = Math.max(...candidates);
  const span = maxM - minM;

  const pct = (m) => ((m - minM) / span) * 100;

  // Octave-anchor tick marks (every C)
  const ticks = [];
  for (let m = minM; m <= maxM; m++) {
    if (((m % 12) + 12) % 12 === 0) {
      ticks.push({ midi: m, name: midiToName(m), pct: pct(m) });
    }
  }

  const fillHtml = (lo != null && hi != null)
    ? `<div class="rb-fill" style="left:${pct(lo)}%;width:${pct(hi) - pct(lo)}%"></div>`
    : (lo != null
        ? `<div class="rb-fill partial" style="left:${pct(lo)}%;width:6px"></div>`
        : `<div class="rb-fill partial" style="left:${pct(hi)}%;width:6px"></div>`);

  const semitones = (lo != null && hi != null) ? (hi - lo) : null;
  const rangeText = semitones != null
    ? `${midiToName(lo)} – ${midiToName(hi)}  ·  ${semitones} semitones (${(semitones/12).toFixed(2)} octaves)`
    : (lo != null ? `Lowest: ${midiToName(lo)} (no high yet)` : `Highest: ${midiToName(hi)} (no low yet)`);

  container.innerHTML = `
    <div class="rb-wrap">
      <div class="rb-track">
        ${ticks.map(t => `<div class="rb-tick" style="left:${t.pct}%"><span>${t.name}</span></div>`).join('')}
        ${fillHtml}
        ${lo != null ? `<div class="rb-mark low" style="left:${pct(lo)}%"><span class="lbl">LOW</span><span class="nt">${midiToName(lo)}</span></div>` : ''}
        ${hi != null ? `<div class="rb-mark high" style="left:${pct(hi)}%"><span class="lbl">HIGH</span><span class="nt">${midiToName(hi)}</span></div>` : ''}
        ${todayLow != null ? `<div class="rb-mark today" style="left:${pct(todayLow)}%"><span class="nt">${midiToName(todayLow)}</span><span class="lbl">TODAY LO</span></div>` : ''}
        ${todayHigh != null ? `<div class="rb-mark today" style="left:${pct(todayHigh)}%"><span class="nt">${midiToName(todayHigh)}</span><span class="lbl">TODAY HI</span></div>` : ''}
      </div>
      <div class="rb-meta">${rangeText}</div>
    </div>
  `;
}

async function renderRangeHistory() {
  const canvas = el('rangeHistoryCanvas');
  if (!canvas) return;
  const log = await window.vm.rangeHistory();
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600;
  const H = canvas.clientHeight || 140;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (!log || log.length < 2) {
    ctx.fillStyle = '#8a91a6';
    ctx.font = '12px -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Mark a low and a high a few times — the trend will show up here.', W / 2, H / 2);
    return;
  }

  // Window: last 60 days
  const now = Date.now();
  const windowMs = 60 * 86400000;
  const tMin = Math.min(now - windowMs, log[0].at);
  const tMax = now;

  const lowPts = log.filter(e => e.kind === 'low' && e.at >= tMin);
  const highPts = log.filter(e => e.kind === 'high' && e.at >= tMin);

  // Y range: extend a bit beyond the min/max midi seen, with a sensible floor
  const midis = log.map(e => e.midi).filter(m => m != null);
  let mMin = Math.min(36, ...midis) - 2;
  let mMax = Math.max(72, ...midis) + 2;
  if (mMax - mMin < 12) { const c = (mMin + mMax) / 2; mMin = c - 6; mMax = c + 6; }

  const padL = 36, padR = 8, padT = 10, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xT = (t) => padL + ((t - tMin) / (tMax - tMin)) * plotW;
  const yM = (m) => padT + (1 - (m - mMin) / (mMax - mMin)) * plotH;

  // Grid: each octave (C notes)
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#8a91a6';
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textAlign = 'right';
  for (let m = Math.ceil(mMin); m <= Math.floor(mMax); m++) {
    if (((m % 12) + 12) % 12 === 0) {
      const y = yM(m);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(midiToName(m), padL - 4, y + 3);
    }
  }

  // X axis: tick every ~10 days
  ctx.textAlign = 'center';
  const spanDays = (tMax - tMin) / 86400000;
  const tickEvery = spanDays > 30 ? 14 : spanDays > 7 ? 7 : 1;
  for (let d = 0; d * 86400000 <= tMax - tMin; d += tickEvery) {
    const t = tMax - d * 86400000;
    const x = xT(t);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
    const dt = new Date(t);
    const label = d === 0 ? 'today' : `${dt.getMonth() + 1}/${dt.getDate()}`;
    ctx.fillStyle = '#8a91a6';
    ctx.fillText(label, x, H - 6);
  }

  // Draw a series
  const drawSeries = (pts, color) => {
    if (pts.length === 0) return;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = xT(p.at), y = yM(p.midi);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    for (const p of pts) {
      const x = xT(p.at), y = yM(p.midi);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  drawSeries(lowPts, '#60a5fa');
  drawSeries(highPts, '#f59e0b');
}

function applyVoiceType(voiceType) {
  const vt = VOICE_TYPE_OFFSET[voiceType] != null ? voiceType : 'baritone';
  state.voiceType = vt;
  rebuildRoutine();
}

// Resolve the active routine (built-in default or a saved custom routine),
// transposed to the user's voice type, into state.routine.
function rebuildRoutine() {
  const offset = VOICE_TYPE_OFFSET[state.voiceType] || 0;
  const base = transposeRoutine(ROUTINE, offset);
  let routine = base;
  if (state.activeRoutineId) {
    const custom = (state.customRoutines || []).find((r) => r.id === state.activeRoutineId);
    if (custom && custom.exerciseIndices && custom.exerciseIndices.length) {
      const picked = custom.exerciseIndices.map((i) => base[i]).filter(Boolean);
      if (picked.length) routine = picked;
    }
  }
  state.routine = routine;
  renderRoutinePreview();
}

async function loadRoutines() {
  const { customRoutines, activeRoutineId } = await window.vm.getRoutines();
  state.customRoutines = customRoutines || [];
  state.activeRoutineId = activeRoutineId ?? null;
  rebuildRoutine();
  renderRoutineSelect();
}

function renderRoutineSelect() {
  const sel = el('routineSelect');
  if (!sel) return;
  const opts = ['<option value="">Built-in (full routine)</option>'];
  for (const r of (state.customRoutines || [])) {
    const sel_ = r.id === state.activeRoutineId ? ' selected' : '';
    opts.push(`<option value="${r.id}"${sel_}>${escapeHtml(r.name)}</option>`);
  }
  sel.innerHTML = opts.join('');
  sel.value = state.activeRoutineId || '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- DASHBOARD ----------
async function renderDashboard() {
  const stats = await window.vm.getStats();
  const sessions = stats.sessions || [];
  el('dashStreak').textContent = stats.streak || 0;
  el('dashTotalXp').textContent = stats.totalXp || 0;
  el('dashSessions').textContent = sessions.length;
  const stabs = sessions.map((s) => s.avgStability).filter((v) => v != null);
  el('dashBestStab').textContent = stabs.length ? `${Math.round(Math.min(...stabs))}¢` : '—';
  renderBaselineVsNow(sessions);
  renderHeatmap(sessions);
  drawBars(el('xpTrendCanvas'), sessions.slice(-30).map((s) => s.xp || 0), '#6ee7b7', 'No sessions yet');
  drawLine(el('stabTrendCanvas'), sessions.slice(-30).map((s) => s.avgStability), '#60a5fa', 'Practice hold/dynamics challenges to track stability');
}

// "Then vs now": aggregate the first week of practice against the last 7 days
// for the metrics that actually move — highest note, best steadiness, volume.
function renderBaselineVsNow(sessions) {
  const wrap = el('baseline');
  if (!wrap) return;
  const DAY = 86400000;
  const now = Date.now();
  const withAt = (sessions || []).filter((s) => s.at);
  if (withAt.length < 2) {
    wrap.innerHTML = '<div class="bl-empty">Your then-vs-now comparison appears once you\'ve logged a few sessions across about a week.</div>';
    return;
  }
  const firstAt = Math.min(...withAt.map((s) => s.at));
  if (now - firstAt < 5 * DAY) {
    wrap.innerHTML = '<div class="bl-empty">Comes alive once you have about a week of history — you\'re on your way. 💪</div>';
    return;
  }
  const thenB = withAt.filter((s) => s.at <= firstAt + 7 * DAY);
  const nowB = withAt.filter((s) => s.at >= now - 7 * DAY);
  const maxMidi = (arr) => { const v = arr.map((s) => s.topMidi).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
  const bestStab = (arr) => { const v = arr.map((s) => s.avgStability).filter((x) => x != null); return v.length ? Math.min(...v) : null; };

  const cell = (m, t, n, d, cls) =>
    `<div class="bl-metric">${m}</div><div class="bl-val">${t}</div><div class="bl-val">${n}</div><div class="bl-delta ${cls}">${d}</div>`;

  const tHi = maxMidi(thenB), nHi = maxMidi(nowB);
  let hiD = '—', hiCls = 'flat';
  if (tHi != null && nHi != null) { const d = nHi - tHi; hiD = d > 0 ? `+${d} st` : d < 0 ? `${d} st` : '='; hiCls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat'; }

  const tSt = bestStab(thenB), nSt = bestStab(nowB);
  let stD = '—', stCls = 'flat';
  if (tSt != null && nSt != null) { const d = Math.round(nSt - tSt); stD = d < 0 ? `${d}¢` : d > 0 ? `+${d}¢` : '='; stCls = d < 0 ? 'up' : d > 0 ? 'down' : 'flat'; } // lower cents = steadier = better

  const cD = nowB.length - thenB.length;
  const cCls = cD > 0 ? 'up' : cD < 0 ? 'down' : 'flat';

  wrap.innerHTML =
    `<div class="bl-head">Metric</div><div class="bl-head bl-val">Then</div><div class="bl-head bl-val">Now</div><div class="bl-head bl-delta">Δ</div>` +
    cell('Highest note', tHi != null ? midiToName(tHi) : '—', nHi != null ? midiToName(nHi) : '—', hiD, hiCls) +
    cell('Best steadiness', tSt != null ? `${Math.round(tSt)}¢` : '—', nSt != null ? `${Math.round(nSt)}¢` : '—', stD, stCls) +
    cell('Sessions / week', String(thenB.length), String(nowB.length), cD > 0 ? `+${cD}` : cD < 0 ? `${cD}` : '=', cCls);
}

function renderHeatmap(sessions) {
  const wrap = el('heatmap');
  if (!wrap) return;
  const xpByDate = {};
  for (const s of sessions) xpByDate[s.date] = (xpByDate[s.date] || 0) + (s.xp || 0);
  const maxXp = Math.max(1, ...Object.values(xpByDate));
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const WEEKS = 13;
  // Start on the Sunday that begins the earliest visible week.
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay() - (WEEKS - 1) * 7);

  const levelFor = (xp) => {
    if (!xp) return 0;
    const r = xp / maxXp;
    return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Build weeks (columns). Each week's month is taken from its midweek day
  // (Wednesday) so a month label sits over the column where that month
  // actually dominates, not where a stray Sunday spills over.
  const weeks = [];
  const cur = new Date(start);
  for (let w = 0; w < WEEKS; w++) {
    const cells = [];
    const wed = new Date(cur); wed.setDate(wed.getDate() + 3);
    for (let d = 0; d < 7; d++) {
      const future = cur > today;
      const key = ymd(cur);
      const xp = xpByDate[key] || 0;
      cells.push({ future, key, xp, lvl: levelFor(xp) });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push({ cells, month: wed.getMonth() });
  }

  // Group consecutive same-month weeks into separate blocks, each its own
  // 7-row grid, laid out with a gap between months so they read as clusters.
  let blocksHtml = '';
  for (let i = 0; i < WEEKS; ) {
    const m = weeks[i].month;
    let j = i;
    while (j + 1 < WEEKS && weeks[j + 1].month === m) j++;
    const span = j - i + 1;
    const label = span >= 2 ? MONTHS[m] : '';
    let cellsHtml = '';
    for (let k = i; k <= j; k++) {
      for (const c of weeks[k].cells) {
        cellsHtml += c.future
          ? '<div class="cal-cell empty"></div>'
          : `<div class="cal-cell ${c.lvl ? 'l' + c.lvl : ''}" title="${c.key}: ${c.xp} XP"></div>`;
      }
    }
    blocksHtml += `<div class="cal-month-block">
      <div class="cal-month">${label}</div>
      <div class="cal-grid" style="grid-template-columns:repeat(${span},12px)">${cellsHtml}</div>
    </div>`;
    i = j + 1;
  }

  const weekdays = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  const wdHtml = weekdays.map((d) => `<div class="cal-weekday">${d}</div>`).join('');

  wrap.innerHTML = `
    <div class="cal">
      <div class="cal-weekdays">${wdHtml}</div>
      <div class="cal-months-row">${blocksHtml}</div>
    </div>
    <div class="cal-legend">Less
      <div class="cal-cell"></div><div class="cal-cell l1"></div><div class="cal-cell l2"></div><div class="cal-cell l3"></div><div class="cal-cell l4"></div>
      More
    </div>`;
}

function _setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600, H = canvas.clientHeight || 110;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  return { ctx, W, H };
}

function _emptyCanvas(ctx, W, H, msg) {
  ctx.fillStyle = '#8a91a6'; ctx.font = '12px -apple-system, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(msg, W / 2, H / 2);
}

function drawBars(canvas, values, color, emptyMsg) {
  if (!canvas) return;
  const { ctx, W, H } = _setupCanvas(canvas);
  if (!values.length) { _emptyCanvas(ctx, W, H, emptyMsg || 'No data'); return; }
  const pad = 8, bottom = H - 14;
  const max = Math.max(1, ...values);
  const bw = (W - pad * 2) / values.length;
  ctx.fillStyle = color;
  values.forEach((v, i) => {
    const h = (v / max) * (bottom - 8);
    ctx.fillRect(pad + i * bw + 1, bottom - h, Math.max(1, bw - 2), h);
  });
  ctx.fillStyle = '#8a91a6'; ctx.font = '10px sans-serif';
  ctx.textAlign = 'left'; ctx.fillText('0', 2, bottom + 11);
  ctx.textAlign = 'right'; ctx.fillText(`max ${max}`, W - 2, 11);
}

function drawLine(canvas, values, color, emptyMsg) {
  if (!canvas) return;
  const { ctx, W, H } = _setupCanvas(canvas);
  const pts = [];
  values.forEach((v, i) => { if (v != null) pts.push({ v, i }); });
  if (pts.length < 2) { _emptyCanvas(ctx, W, H, emptyMsg || 'Not enough data'); return; }
  const pad = 8, top = 12, bottom = H - 16;
  const vals = pts.map((p) => p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = Math.max(1, max - min);
  const n = values.length;
  const xAt = (i) => pad + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad * 2));
  const yAt = (v) => top + ((v - min) / range) * (bottom - top); // lower = better = higher
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, k) => { const x = xAt(p.i), y = yAt(p.v); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
  ctx.stroke();
  for (const p of pts) { ctx.beginPath(); ctx.arc(xAt(p.i), yAt(p.v), 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#8a91a6'; ctx.font = '10px sans-serif';
  ctx.textAlign = 'left'; ctx.fillText(`${Math.round(min)}¢ best`, 2, top - 2);
  ctx.textAlign = 'right'; ctx.fillText(`${Math.round(max)}¢`, W - 2, bottom + 13);
}

// ---------- EAR TRAINING ----------
const EAR_TOTAL = 8;
const EAR_TOLERANCE = 45;   // cents
const EAR_HOLD_MS = 700;
const EAR_NOTE_MS = 1400;       // reference tone duration ("listen note time")
const EAR_LISTEN_PAD_MS = 350;  // extra deaf window after the tone, so it can't
                                // leak from headphones into the mic and auto-pass

async function enterEar() {
  if (!state.micEnabled) {
    const ok = await enableMic();
    if (!ok) return;
  }
  showEarPanel();
  loadEarRange();
  state.earActive = false; // not started until Start pressed
  el('earRound').textContent = `Round 0 / ${EAR_TOTAL}`;
  el('earPrompt').textContent = 'Press Start to begin';
  el('earYou').textContent = '—';
  el('earFeedback').textContent = '';
  el('earFeedback').className = 'ear-feedback';
  el('earProgressFill').style.width = '0%';
  el('earSummary').innerHTML = '';
  el('earStartBtn').style.display = '';
  el('earStartBtn').textContent = 'Start';
  el('earReplayBtn').style.display = 'none';
  el('earSkipBtn').style.display = 'none';
}

function exitEar() {
  state.earActive = false;
  showIdle();
}

function startEar() {
  state.earActive = true;
  state.earRound = 0;
  state.earScore = 0;
  state.earResults = [];
  el('earStartBtn').style.display = 'none';
  el('earReplayBtn').style.display = '';
  el('earSkipBtn').style.display = '';
  el('earSummary').innerHTML = '';
  nextEarRound();
}

function earTargetRange() {
  let lo = Number(el('earRangeLow').value);
  let hi = Number(el('earRangeHigh').value);
  if (hi < lo) { const t = lo; lo = hi; hi = t; }
  if (hi - lo < 2) hi = Math.min(84, lo + 2);
  return { lo, hi };
}

function loadEarRange() {
  // Persisted slider values, falling back to the comfortable range, then a
  // sensible default.
  let lo = parseInt(localStorage.getItem('earRangeLow'), 10);
  let hi = parseInt(localStorage.getItem('earRangeHigh'), 10);
  if (!Number.isFinite(lo)) lo = state.profileLowMidi != null ? state.profileLowMidi + 2 : 48;
  if (!Number.isFinite(hi)) hi = state.profileHighMidi != null ? state.profileHighMidi - 2 : 67;
  lo = Math.max(36, Math.min(84, lo));
  hi = Math.max(36, Math.min(84, hi));
  if (hi - lo < 2) { lo = 48; hi = 67; }
  el('earRangeLow').value = lo;
  el('earRangeHigh').value = hi;
  updateEarRangeLabels();
}

function updateEarRangeLabels() {
  let lo = Number(el('earRangeLow').value);
  let hi = Number(el('earRangeHigh').value);
  // Keep the two thumbs from crossing.
  if (lo > hi) {
    if (document.activeElement === el('earRangeLow')) { hi = lo; el('earRangeHigh').value = hi; }
    else { lo = hi; el('earRangeLow').value = lo; }
  }
  el('earRangeLowLabel').textContent = midiToName(lo);
  el('earRangeHighLabel').textContent = midiToName(hi);
  const span = hi - lo;
  el('earRangeHint').textContent =
    `Notes drawn at random from ${midiToName(lo)}–${midiToName(hi)} (${span} semitone${span === 1 ? '' : 's'}).`;
  localStorage.setItem('earRangeLow', String(lo));
  localStorage.setItem('earRangeHigh', String(hi));
}

function nextEarRound() {
  if (state.earRound >= EAR_TOTAL) return finishEar();
  state.earRound++;
  const { lo, hi } = earTargetRange();
  state.earTargetMidi = lo + Math.floor(Math.random() * (hi - lo + 1));
  state.earHoldMs = 0;
  state.earLastTick = null;
  state.earCentsSamples = [];
  state.earListenUntil = performance.now() + EAR_NOTE_MS + EAR_LISTEN_PAD_MS;
  state.earPhase = 'await';
  el('earRound').textContent = `Round ${state.earRound} / ${EAR_TOTAL}`;
  el('earPrompt').textContent = 'Sing the note you hear';
  el('earYou').textContent = '—';
  el('earYou').classList.remove('on-target');
  el('earFeedback').textContent = 'Listen…';
  el('earFeedback').className = 'ear-feedback';
  el('earProgressFill').style.width = '0%';
  playEarTarget();
}

function playEarTarget() {
  const f = noteToFreq(midiToName(state.earTargetMidi));
  if (f) tone.play(f, EAR_NOTE_MS);
  // Don't score any singing until the reference tone has fully finished (plus a
  // pad). Otherwise the tone bleeding from the headphones into the mic reads as
  // a perfectly on-target note and fills the hold bar before the user sings.
  state.earHoldMs = 0;
  state.earLastTick = null;
  state.earListenUntil = performance.now() + EAR_NOTE_MS + EAR_LISTEN_PAD_MS;
}

function handleEarPitch(note) {
  const yEl = el('earYou');
  if (!note) {
    // Silence / no clear pitch: reset the hold bar. A momentary blip (e.g. the
    // reference tone leaking through the headphones) shouldn't bank progress —
    // only continuous singing should fill the bar.
    yEl.textContent = '—';
    yEl.classList.remove('on-target');
    if (state.earPhase === 'await') {
      state.earHoldMs = 0;
      state.earLastTick = null;
      el('earProgressFill').style.width = '0%';
    }
    return;
  }
  yEl.textContent = note.name;
  if (state.earPhase !== 'await') return;
  const now = performance.now();
  // Stay "deaf" while the reference note is still playing (and briefly after).
  // This window is longer than the tone, so a round can only complete after the
  // user actually sings — not from the tone leaking into the mic.
  if (now < state.earListenUntil) {
    state.earHoldMs = 0;
    state.earLastTick = null;
    el('earProgressFill').style.width = '0%';
    el('earFeedback').textContent = 'Listen…';
    el('earFeedback').className = 'ear-feedback';
    return;
  }
  const dt = state.earLastTick ? now - state.earLastTick : 0;
  state.earLastTick = now;
  const diff = (note.midi * 100 + note.cents) - state.earTargetMidi * 100;
  const fb = el('earFeedback');
  if (Math.abs(diff) <= EAR_TOLERANCE) {
    yEl.classList.add('on-target');
    state.earHoldMs += dt;
    state.earCentsSamples.push(diff);
    fb.textContent = 'Hold it…'; fb.className = 'ear-feedback ok';
    el('earProgressFill').style.width = Math.min(100, (state.earHoldMs / EAR_HOLD_MS) * 100) + '%';
    if (state.earHoldMs >= EAR_HOLD_MS) earRoundPassed();
  } else {
    yEl.classList.remove('on-target');
    state.earHoldMs = Math.max(0, state.earHoldMs - dt * 0.5);
    fb.textContent = diff < 0 ? '↑ go higher' : '↓ go lower';
    fb.className = 'ear-feedback off';
  }
}

function earRoundPassed() {
  state.earPhase = 'between';
  const samples = state.earCentsSamples;
  const avgOff = samples.length ? samples.reduce((a, b) => a + Math.abs(b), 0) / samples.length : EAR_TOLERANCE;
  const acc = Math.max(0, 1 - avgOff / 100);
  state.earScore += acc;
  state.earResults.push({ target: state.earTargetMidi, avgOff, acc });
  el('earFeedback').textContent = `✓ It was ${midiToName(state.earTargetMidi)} — ${Math.round(avgOff)}¢ off`;
  el('earFeedback').className = 'ear-feedback ok';
  el('earProgressFill').style.width = '100%';
  setTimeout(() => { if (state.earActive) nextEarRound(); }, 1300);
}

function skipEarRound() {
  if (!state.earActive || state.earPhase !== 'await') return;
  state.earResults.push({ target: state.earTargetMidi, avgOff: 100, acc: 0 });
  el('earFeedback').textContent = `Skipped — it was ${midiToName(state.earTargetMidi)}`;
  el('earFeedback').className = 'ear-feedback off';
  state.earPhase = 'between';
  setTimeout(() => { if (state.earActive) nextEarRound(); }, 900);
}

function finishEar() {
  state.earActive = false;
  const pct = Math.round((state.earScore / EAR_TOTAL) * 100);
  const label = pct >= 85 ? 'Excellent ear' : pct >= 65 ? 'Good ear' : pct >= 40 ? 'Getting there' : 'Keep training';
  el('earPrompt').textContent = 'Done!';
  el('earYou').textContent = '—';
  el('earFeedback').textContent = '';
  el('earProgressFill').style.width = '0%';
  el('earReplayBtn').style.display = 'none';
  el('earSkipBtn').style.display = 'none';
  el('earStartBtn').style.display = '';
  el('earStartBtn').textContent = 'Train again';
  el('earSummary').innerHTML = `<div class="ear-score">${pct}% — ${label}</div>`;
}

// ---------- BREATH / SUSTAIN TRAINER ----------
const BREATH_TOLERANCE = 70;   // cents — sustains wander a bit
const BREATH_LOST_MS = 700;    // grace before we end the hold
const BREATH_LOCK_MS = 250;    // confirm a pitch before locking onto it

async function enterBreath() {
  if (!state.micEnabled) {
    const ok = await enableMic();
    if (!ok) return;
  }
  showBreathPanel();
  state.breathActive = false;
  el('breathPrompt').textContent = 'Press Start, then sing a note and hold';
  el('breathTimer').textContent = '0.0s';
  el('breathTimer').classList.remove('holding');
  el('breathNote').textContent = '—';
  el('breathFeedback').textContent = '';
  el('breathFeedback').className = 'breath-feedback';
  el('breathPitchBar').style.width = '0%';
  el('breathDbBar').style.width = '0%';
  el('breathStartBtn').style.display = '';
  el('breathStartBtn').textContent = 'Start';
  el('breathStopBtn').style.display = 'none';
  renderBreathBest();
}

function renderBreathBest() {
  const best = parseFloat(localStorage.getItem('breathBest'));
  el('breathResult').innerHTML = Number.isFinite(best)
    ? `<div class="br-best">Personal best: ${best.toFixed(1)}s</div>`
    : '';
}

function exitBreath() {
  state.breathActive = false;
  showIdle();
}

function startBreath() {
  state.breathActive = true;
  state.breathPhase = 'lock';     // lock → holding → done
  state.breathTargetMidi = null;
  state.breathLockMs = 0;
  state.breathHeldMs = 0;
  state.breathLostMs = 0;
  state.breathLastTick = null;
  state.breathCentsSamples = [];
  state.breathDbSamples = [];
  el('breathStartBtn').style.display = 'none';
  el('breathStopBtn').style.display = '';
  el('breathResult').innerHTML = '';
  el('breathPrompt').textContent = 'Sing a comfortable note…';
  el('breathTimer').textContent = '0.0s';
  el('breathFeedback').textContent = '';
}

function handleBreathPitch(note, db) {
  if (!state.breathActive) return;
  const now = performance.now();
  const dt = state.breathLastTick ? now - state.breathLastTick : 0;
  state.breathLastTick = now;
  el('breathNote').textContent = note ? note.name : '—';

  if (state.breathPhase === 'lock') {
    // Wait for a stable pitch, then lock onto it as the target.
    if (note) {
      state.breathLockMs += dt;
      if (state.breathLockMs >= BREATH_LOCK_MS) {
        state.breathTargetMidi = note.midi;
        state.breathPhase = 'holding';
        state.breathHeldMs = 0;
        state.breathLostMs = 0;
        el('breathPrompt').textContent = `Hold ${note.name} — steady and even`;
        el('breathTimer').classList.add('holding');
      }
    } else {
      state.breathLockMs = Math.max(0, state.breathLockMs - dt);
    }
    return;
  }

  if (state.breathPhase !== 'holding') return;

  const onPitch = note && Math.abs((note.midi * 100 + note.cents) - state.breathTargetMidi * 100) <= BREATH_TOLERANCE;
  if (onPitch) {
    state.breathHeldMs += dt;
    state.breathLostMs = 0;
    state.breathCentsSamples.push((note.midi * 100 + note.cents) - state.breathTargetMidi * 100);
    if (db != null) state.breathDbSamples.push(db);
    el('breathFeedback').textContent = 'Steady…';
    el('breathFeedback').className = 'breath-feedback ok';
  } else {
    state.breathLostMs += dt;
    el('breathFeedback').textContent = note ? 'Off pitch — bring it back' : 'Keep the tone going';
    el('breathFeedback').className = 'breath-feedback off';
    if (state.breathLostMs >= BREATH_LOST_MS) { finishBreath(); return; }
  }
  el('breathTimer').textContent = (state.breathHeldMs / 1000).toFixed(1) + 's';
  // Live steadiness bars (last ~2s window), higher = steadier/more even
  el('breathPitchBar').style.width = steadinessPct(state.breathCentsSamples.slice(-80), 50) + '%';
  el('breathDbBar').style.width = steadinessPct(state.breathDbSamples.slice(-80), 6) + '%';
}

// Map a sample window's standard deviation to a 0–100 "steadiness" score.
// `fullScaleStd` is the stddev that maps to 0%.
function steadinessPct(samples, fullScaleStd) {
  if (samples.length < 4) return 0;
  const n = samples.length;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  const std = Math.sqrt(variance);
  return Math.max(0, Math.min(100, 100 * (1 - std / fullScaleStd)));
}

function stdDev(samples) {
  if (!samples.length) return null;
  const n = samples.length;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  return Math.sqrt(variance);
}

function finishBreath() {
  if (!state.breathActive) return;
  state.breathActive = false;
  state.breathPhase = 'done';
  const secs = state.breathHeldMs / 1000;
  el('breathTimer').classList.remove('holding');
  el('breathStartBtn').style.display = '';
  el('breathStartBtn').textContent = 'Try again';
  el('breathStopBtn').style.display = 'none';
  el('breathPrompt').textContent = 'Done!';
  el('breathFeedback').textContent = '';

  const pitchStd = stdDev(state.breathCentsSamples);
  const dbStd = stdDev(state.breathDbSamples);
  const pitchLbl = pitchStd == null ? '—' : pitchStd < 15 ? 'rock-steady' : pitchStd < 30 ? 'good' : 'wobbly';
  const dbLbl = dbStd == null ? '—' : dbStd < 2 ? 'very even' : dbStd < 4 ? 'even' : 'uneven';

  const best = parseFloat(localStorage.getItem('breathBest'));
  const isBest = !Number.isFinite(best) || secs > best;
  if (isBest && secs > 0) localStorage.setItem('breathBest', secs.toFixed(1));
  const bestVal = isBest ? secs : best;

  el('breathResult').innerHTML = `
    <div class="br-headline">${secs.toFixed(1)}s held</div>
    <div class="br-detail">Pitch: ${pitchStd == null ? '—' : Math.round(pitchStd) + '¢'} (${pitchLbl}) · Loudness: ${dbLbl}</div>
    <div class="br-best">${isBest && secs > 0 ? '🎉 New personal best!' : 'Personal best: ' + (Number.isFinite(bestVal) ? bestVal.toFixed(1) + 's' : '—')}</div>
  `;
}

// ---------- HEAD VOICE / REGISTER TRAINER ----------
// Guided practice to develop head voice and smooth the chest↔head break. These
// are process drills (sirens, trills, light onsets), not pitch-target scoring —
// the value is live biofeedback (trace + tone) plus a tracked top note.
const HV_XP = 12;
const HV_MIN_FRAMES = 5; // a note must be held ~125ms before it counts as "reached"
const HV_STEPS = [
  { kind: 'glide', secs: 30, title: 'Find your break',
    text: 'On an "oooo", slide slowly from a low comfortable note UP as high as you can, then back down. Notice where the voice flips from strong (chest) to light (head) — that jump in the trace is your break. Just explore it.' },
  { kind: 'glide', secs: 30, title: 'Sirens',
    text: 'Glide smoothly UP THROUGH the break and back down on "ng" (end of "sing"). Keep it quiet and aim for one smooth line in the trace — no sudden step. Repeat gently.' },
  { kind: 'glide', secs: 30, title: 'Lip trills / straw',
    text: 'Lip-bubble (or hum through a thin straw) while sliding high and back. This connects the registers without strain — let the buzz carry you up higher than feels easy on a plain vowel.' },
  { kind: 'tone',  secs: 30, title: 'Clear head voice',
    text: 'Up high in head voice, sing light "gee gee gee". Aim for a CLEAR tone, not airy — watch the Tone readout and try to keep it on "Clear". Stay gentle; clarity comes from clean onset, not force.' },
  { kind: 'glide', secs: 30, title: 'Connect the gears',
    text: 'Pick a note near your break and alternate chest → head → chest on it. Each time, try to make the flip a little smaller and smoother.' }
];

let hvHist = null, hvTopMidi = null, hvToneSamples = null, hvStepIdx = 0;
let hvRegister = null;       // 'chest' | 'head' (from timbre weight, with hysteresis)
let hvBreakSamples = [];     // pitches where chest→head flipped while ascending
let hvBreakMidi = null;      // current break estimate (median of flips)

async function enterHeadVoice() {
  if (!state.micEnabled) {
    const ok = await enableMic();
    if (!ok) return;
  }
  showHeadVoicePanel();
  stopHeadVoice();
  el('hvStep').textContent = `${HV_STEPS.length} short exercises`;
  el('hvTitle').textContent = 'Press Start';
  el('hvInstruction').textContent = 'Five short exercises to build your head voice. Headphones recommended. Keep it gentle — stop if you feel any throat tension.';
  el('hvNote').textContent = '—';
  el('hvTop').textContent = '—';
  el('hvToneWrap').style.visibility = 'hidden';
  el('hvTimer').textContent = '';
  el('hvFeedback').textContent = '';
  el('hvFeedback').className = 'hv-feedback';
  el('hvStartBtn').style.display = '';
  el('hvStartBtn').textContent = 'Start';
  el('hvNextBtn').style.display = 'none';
  el('hvStopBtn').style.display = 'none';
  el('hvGuideBtn').style.display = 'none';
  const best = parseInt(localStorage.getItem('hvBestMidi'), 10);
  const brk = parseInt(localStorage.getItem('hvBreakMidi'), 10);
  const bits = [];
  if (Number.isFinite(best)) bits.push(`Your highest note so far: <strong>${midiToName(best)}</strong>`);
  if (Number.isFinite(brk)) bits.push(`break around <strong>${midiToName(brk)}</strong>`);
  el('hvSummary').innerHTML = bits.length ? `<div class="hv-detail">${bits.join(' · ')}</div>` : '';
}

function startHeadVoice() {
  state.headVoiceActive = true;
  hvStepIdx = 0;
  hvHist = new Int32Array(128);
  hvTopMidi = null;
  hvToneSamples = [];
  hvRegister = null;
  hvBreakSamples = [];
  const storedBreak = parseInt(localStorage.getItem('hvBreakMidi'), 10);
  hvBreakMidi = Number.isFinite(storedBreak) ? storedBreak : null;
  state.hvTrace = new FreestyleTrace(el('hvTrace'));
  if (hvBreakMidi != null) state.hvTrace.setBreakLine(hvBreakMidi);
  el('hvStartBtn').style.display = 'none';
  el('hvGuideBtn').style.display = '';
  el('hvStopBtn').style.display = '';
  el('hvSummary').innerHTML = '';
  el('hvTop').textContent = '—';
  runHvStep(0);
}

function runHvStep(idx) {
  const step = HV_STEPS[idx];
  if (!step) return finishHeadVoice();
  hvStepIdx = idx;
  el('hvStep').textContent = `Exercise ${idx + 1} / ${HV_STEPS.length}`;
  el('hvTitle').textContent = step.title;
  el('hvInstruction').textContent = step.text;
  el('hvFeedback').textContent = '';
  el('hvFeedback').className = 'hv-feedback';
  el('hvToneWrap').style.visibility = step.kind === 'tone' ? 'visible' : 'hidden';
  el('hvNextBtn').style.display = '';
  el('hvNextBtn').textContent = idx === HV_STEPS.length - 1 ? 'Finish →' : 'Next exercise →';
  if (state.hvTrace) state.hvTrace.clear();

  // Per-step countdown that auto-advances; Next skips early.
  if (state.hvTimer) clearInterval(state.hvTimer);
  let left = step.secs;
  el('hvTimer').textContent = `${left}s left · or press Next when ready`;
  state.hvTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) { hvNextStep(); return; }
    el('hvTimer').textContent = `${left}s left · or press Next when ready`;
  }, 1000);
}

function handleHeadVoicePitch(note, db, breath, weight) {
  if (!state.headVoiceActive) return;
  el('hvNote').textContent = note ? note.name : '—';
  if (state.hvTrace) state.hvTrace.push(note ? note.midi : null, note ? note.cents : 0, db);

  if (note && note.midi != null && note.midi >= 0 && note.midi < 128) {
    hvHist[note.midi]++;
    // Highest note held long enough this session (glitch-safe).
    if (hvHist[note.midi] >= HV_MIN_FRAMES && (hvTopMidi == null || note.midi > hvTopMidi)) {
      hvTopMidi = note.midi;
      el('hvTop').textContent = midiToName(hvTopMidi);
    }
  }

  // Register tracking from timbre weight (low weight = light = head), with
  // hysteresis so it doesn't flicker. A chest→head flip while ascending marks
  // the break.
  hvDetectRegister(note, weight);

  const step = HV_STEPS[hvStepIdx];
  if (step && step.kind === 'tone') {
    // Clarity step: live tone read from breathiness.
    if (breath != null && note) {
      hvToneSamples.push(breath);
      const word = breath < 0.4 ? 'Clear' : breath <= 0.6 ? 'Some air' : 'Airy';
      el('hvTone').textContent = word;
      el('hvFeedback').textContent = breath < 0.4 ? '✓ Clear tone — that\'s it' : 'Lighten the breath — aim for a clean, clear "gee"';
      el('hvFeedback').className = 'hv-feedback ' + (breath < 0.4 ? 'ok' : 'off');
    } else if (!note) {
      el('hvTone').textContent = '—';
    }
  } else if (step) {
    // Glide steps: show which register you're in (+ break once known).
    const reg = hvRegister === 'head' ? '🪶 Head voice' : hvRegister === 'chest' ? '🎚️ Chest voice' : '';
    el('hvFeedback').textContent = reg + (hvBreakMidi != null && reg ? `  ·  break ~${midiToName(hvBreakMidi)}` : '');
    el('hvFeedback').className = 'hv-feedback ' + (hvRegister === 'head' ? 'ok' : '');
  }
}

// Track chest/head from timbre weight; record the pitch at each chest→head flip
// as a break estimate (median of recent flips), and mark it on the trace.
function hvDetectRegister(note, weight) {
  if (weight == null || !note) return;
  const prev = hvRegister;
  if (hvRegister === 'head') { if (weight > 0.6) hvRegister = 'chest'; }
  else if (hvRegister === 'chest') { if (weight < 0.4) hvRegister = 'head'; }
  else { hvRegister = weight < 0.5 ? 'head' : 'chest'; }
  if (prev === 'chest' && hvRegister === 'head' && note.midi != null) {
    hvBreakSamples.push(note.midi);
    if (hvBreakSamples.length > 9) hvBreakSamples.shift();
    const s = hvBreakSamples.slice().sort((a, b) => a - b);
    hvBreakMidi = s[Math.floor(s.length / 2)];
    if (state.hvTrace) state.hvTrace.setBreakLine(hvBreakMidi);
  }
}

function hvNextStep() {
  if (state.hvTimer) { clearInterval(state.hvTimer); state.hvTimer = null; }
  if (hvStepIdx + 1 >= HV_STEPS.length) finishHeadVoice();
  else runHvStep(hvStepIdx + 1);
}

// Play a low→high reference pair to slide between: anchored on your break if we
// know it, else your comfortable top, else a default chest→head span.
function playHvGuide() {
  let lo, hi;
  if (hvBreakMidi != null) { lo = hvBreakMidi - 5; hi = hvBreakMidi + 7; }
  else if (state.profileHighMidi != null) { lo = state.profileHighMidi - 9; hi = state.profileHighMidi; }
  else { lo = 48; hi = 60; }
  const f1 = noteToFreq(midiToName(lo));
  const f2 = noteToFreq(midiToName(hi));
  if (f1) tone.play(f1, 700);
  if (f2) setTimeout(() => tone.play(f2, 1100), 800);
  el('hvFeedback').textContent = `Guide: slide from ${midiToName(lo)} up to ${midiToName(hi)} and back`;
  el('hvFeedback').className = 'hv-feedback';
}

// Stop timers/trace and clear the active flag. Safe to call repeatedly.
function stopHeadVoice() {
  state.headVoiceActive = false;
  if (state.hvTimer) { clearInterval(state.hvTimer); state.hvTimer = null; }
  if (state.hvTrace) { state.hvTrace.destroy(); state.hvTrace = null; }
}

function exitHeadVoice() {
  stopHeadVoice();
  showIdle();
}

function finishHeadVoice() {
  const top = hvTopMidi;
  const toneAvg = hvToneSamples && hvToneSamples.length
    ? hvToneSamples.reduce((a, b) => a + b, 0) / hvToneSamples.length : null;
  stopHeadVoice();
  el('hvStep').textContent = 'Session complete';
  el('hvTitle').textContent = 'Nice work 🪶';
  el('hvInstruction').textContent = 'Head voice grows with gentle, regular practice — a few minutes most days beats one long push. Come back tomorrow.';
  el('hvTimer').textContent = '';
  el('hvFeedback').textContent = '';
  el('hvNote').textContent = '—';
  el('hvToneWrap').style.visibility = 'hidden';
  el('hvStartBtn').style.display = '';
  el('hvStartBtn').textContent = 'Train again';
  el('hvGuideBtn').style.display = 'none';
  el('hvNextBtn').style.display = 'none';
  el('hvStopBtn').style.display = 'none';

  const prevBest = parseInt(localStorage.getItem('hvBestMidi'), 10);
  const isBest = top != null && (!Number.isFinite(prevBest) || top > prevBest);
  if (isBest) localStorage.setItem('hvBestMidi', String(top));
  if (hvBreakMidi != null) localStorage.setItem('hvBreakMidi', String(hvBreakMidi));
  const toneLbl = toneAvg == null ? null : toneAvg < 0.4 ? 'clear' : toneAvg <= 0.6 ? 'a little airy' : 'breathy';
  el('hvSummary').innerHTML = `
    <div class="hv-headline">${top != null ? 'Highest note: ' + midiToName(top) : 'Keep at it'}</div>
    <div class="hv-detail">
      ${isBest && top != null ? '🎉 New highest note!' : Number.isFinite(prevBest) ? 'Your best: ' + midiToName(prevBest) : ''}
      ${hvBreakMidi != null ? ' · break around ' + midiToName(hvBreakMidi) : ''}
      ${toneLbl ? ' · head-voice tone was ' + toneLbl : ''}
    </div>`;

  window.vm.recordSession({ passed: HV_STEPS.length, total: HV_STEPS.length, xp: HV_XP, topMidi: top, avgStability: null })
    .then((r) => { refreshHeaderStats(); showAchievementUnlocks((r && r._newAchievements) || []); })
    .catch(() => {});
}

// ---------- INTERVAL TRAINING ----------
const INTERVAL_TOTAL = 10;
const INTERVAL_SET = [
  { semi: 2,  name: 'Major 2nd' },
  { semi: 3,  name: 'Minor 3rd' },
  { semi: 4,  name: 'Major 3rd' },
  { semi: 5,  name: 'Perfect 4th' },
  { semi: 7,  name: 'Perfect 5th' },
  { semi: 9,  name: 'Major 6th' },
  { semi: 11, name: 'Major 7th' },
  { semi: 12, name: 'Octave' }
];

function enterIntervals() {
  showIntervalsPanel();
  if (state.intervalTimers) state.intervalTimers.forEach(clearTimeout);
  state.intervalTimers = [];
  el('intervalRound').textContent = `Round 0 / ${INTERVAL_TOTAL}`;
  el('intervalPrompt').textContent = 'Press Start to begin';
  el('intervalReplayBtn').style.display = 'none';
  el('intervalChoices').innerHTML = '';
  el('intervalFeedback').textContent = '';
  el('intervalFeedback').className = 'ear-feedback';
  el('intervalSummary').innerHTML = '';
  el('intervalStartBtn').style.display = '';
  el('intervalStartBtn').textContent = 'Start';
}

function startIntervals() {
  state.intervalRound = 0;
  state.intervalScore = 0;
  el('intervalStartBtn').style.display = 'none';
  el('intervalSummary').innerHTML = '';
  renderIntervalChoices();
  nextIntervalRound();
}

function renderIntervalChoices() {
  el('intervalChoices').innerHTML = INTERVAL_SET.map((iv) =>
    `<button class="interval-choice" data-semi="${iv.semi}">${iv.name}</button>`
  ).join('');
  for (const b of el('intervalChoices').children) {
    b.addEventListener('click', () => answerInterval(Number(b.dataset.semi), b));
  }
}

function nextIntervalRound() {
  if (state.intervalRound >= INTERVAL_TOTAL) return finishIntervals();
  state.intervalRound++;
  state.intervalAnswered = false;
  const iv = INTERVAL_SET[Math.floor(Math.random() * INTERVAL_SET.length)];
  state.intervalCurrent = iv;
  // Root low enough that root + interval stays in a comfortable listening range.
  const rootLo = 50, rootHi = 72 - iv.semi;
  state.intervalRootMidi = rootLo + Math.floor(Math.random() * Math.max(1, rootHi - rootLo + 1));
  el('intervalRound').textContent = `Round ${state.intervalRound} / ${INTERVAL_TOTAL}`;
  el('intervalPrompt').textContent = 'Which interval did you hear?';
  el('intervalReplayBtn').style.display = '';
  el('intervalFeedback').textContent = '';
  el('intervalFeedback').className = 'ear-feedback';
  for (const b of el('intervalChoices').children) { b.disabled = false; b.classList.remove('correct', 'wrong'); }
  playIntervalPair();
}

function playIntervalPair() {
  if (state.intervalTimers) state.intervalTimers.forEach(clearTimeout);
  state.intervalTimers = [];
  const root = state.intervalRootMidi;
  const top = root + state.intervalCurrent.semi;
  const f1 = noteToFreq(midiToName(root));
  const f2 = noteToFreq(midiToName(top));
  tone.play(f1, 800);
  state.intervalTimers.push(setTimeout(() => tone.play(f2, 800), 900));
}

function answerInterval(semi, btn) {
  if (state.intervalAnswered) return;
  state.intervalAnswered = true;
  const correct = semi === state.intervalCurrent.semi;
  if (correct) state.intervalScore++;
  for (const b of el('intervalChoices').children) {
    b.disabled = true;
    if (Number(b.dataset.semi) === state.intervalCurrent.semi) b.classList.add('correct');
  }
  if (!correct) btn.classList.add('wrong');
  const fb = el('intervalFeedback');
  fb.textContent = correct
    ? `✓ ${state.intervalCurrent.name}`
    : `✗ It was a ${state.intervalCurrent.name}`;
  fb.className = 'ear-feedback ' + (correct ? 'ok' : 'off');
  state.intervalTimers.push(setTimeout(nextIntervalRound, 1300));
}

function finishIntervals() {
  const pct = Math.round((state.intervalScore / INTERVAL_TOTAL) * 100);
  const label = pct >= 85 ? 'Excellent ear' : pct >= 65 ? 'Good ear' : pct >= 40 ? 'Getting there' : 'Keep training';
  el('intervalPrompt').textContent = 'Done!';
  el('intervalReplayBtn').style.display = 'none';
  el('intervalChoices').innerHTML = '';
  el('intervalFeedback').textContent = '';
  el('intervalStartBtn').style.display = '';
  el('intervalStartBtn').textContent = 'Train again';
  el('intervalSummary').innerHTML = `<div class="ear-score">${pct}% — ${label}</div>`;
}

// ---------- ROUTINE BUILDER ----------
function renderBuilderRoutineList() {
  const wrap = el('builderRoutineList');
  if (!wrap) return;
  const rows = ['<div class="builder-routine-item' + (!state.activeRoutineId ? ' active' : '') +
    '" data-id=""><span>Built-in (full routine)</span>' +
    (!state.activeRoutineId ? '<span class="br-badge">active</span>' : '') + '</div>'];
  for (const r of (state.customRoutines || [])) {
    const active = r.id === state.activeRoutineId;
    rows.push(`<div class="builder-routine-item${active ? ' active' : ''}" data-id="${r.id}">
      <span>${escapeHtml(r.name)} <span class="br-badge">${r.exerciseIndices.length} ex</span></span>
      ${active ? '<span class="br-badge">active</span>' : ''}
    </div>`);
  }
  wrap.innerHTML = rows.join('');
  for (const node of wrap.children) {
    node.addEventListener('click', () => onBuilderRoutineClick(node.dataset.id));
  }
}

async function onBuilderRoutineClick(id) {
  // Clicking sets it active AND opens it for editing (built-in can't be edited)
  await window.vm.setActiveRoutine(id || null);
  state.activeRoutineId = id || null;
  rebuildRoutine();
  renderRoutineSelect();
  renderBuilderRoutineList();
  if (!id) {
    el('builderEditor').style.display = 'none';
    return;
  }
  const r = state.customRoutines.find((x) => x.id === id);
  if (r) openBuilderEditor(r);
}

function openBuilderEditor(routine) {
  // routine: {id, name, exerciseIndices} or null for new
  const included = new Set(routine ? routine.exerciseIndices : ROUTINE.map((_, i) => i));
  const order = routine && routine.exerciseIndices.length
    ? [...routine.exerciseIndices, ...ROUTINE.map((_, i) => i).filter((i) => !included.has(i))]
    : ROUTINE.map((_, i) => i);
  state.builderDraft = {
    id: routine ? routine.id : 'routine-' + Date.now(),
    name: routine ? routine.name : '',
    order,
    included
  };
  el('builderName').value = state.builderDraft.name;
  el('builderDeleteBtn').style.display = routine ? '' : 'none';
  el('builderEditor').style.display = '';
  renderBuilderExerciseList();
}

function renderBuilderExerciseList() {
  const wrap = el('builderExerciseList');
  const d = state.builderDraft;
  if (!d) return;
  wrap.innerHTML = d.order.map((exIdx, pos) => {
    const ex = ROUTINE[exIdx];
    const on = d.included.has(exIdx);
    return `<div class="builder-ex-item${on ? '' : ' disabled'}" data-idx="${exIdx}">
      <input type="checkbox" ${on ? 'checked' : ''} data-idx="${exIdx}" class="be-check" />
      <span class="be-name">${escapeHtml(ex.name)}</span>
      <span class="be-count">${ex.challenges.length} tasks</span>
      <span class="be-move">
        <button class="be-up" data-pos="${pos}" ${pos === 0 ? 'disabled' : ''}>↑</button>
        <button class="be-down" data-pos="${pos}" ${pos === d.order.length - 1 ? 'disabled' : ''}>↓</button>
      </span>
    </div>`;
  }).join('');
  for (const cb of wrap.querySelectorAll('.be-check')) {
    cb.addEventListener('change', () => {
      const i = Number(cb.dataset.idx);
      if (cb.checked) d.included.add(i); else d.included.delete(i);
      renderBuilderExerciseList();
    });
  }
  for (const b of wrap.querySelectorAll('.be-up')) {
    b.addEventListener('click', () => moveBuilderEx(Number(b.dataset.pos), -1));
  }
  for (const b of wrap.querySelectorAll('.be-down')) {
    b.addEventListener('click', () => moveBuilderEx(Number(b.dataset.pos), 1));
  }
}

function moveBuilderEx(pos, dir) {
  const d = state.builderDraft;
  const np = pos + dir;
  if (np < 0 || np >= d.order.length) return;
  const tmp = d.order[pos];
  d.order[pos] = d.order[np];
  d.order[np] = tmp;
  renderBuilderExerciseList();
}

async function saveBuilderRoutine() {
  const d = state.builderDraft;
  if (!d) return;
  const name = el('builderName').value.trim();
  if (!name) { showToast('Give the routine a name first.', 'info'); return; }
  const exerciseIndices = d.order.filter((i) => d.included.has(i));
  if (!exerciseIndices.length) { showToast('Include at least one exercise.', 'info'); return; }
  const routine = { id: d.id, name, exerciseIndices };
  state.customRoutines = await window.vm.saveRoutine(routine);
  renderBuilderRoutineList();
  renderRoutineSelect();
  rebuildRoutine();
  showToast(`Saved "${name}".`, 'ok');
  el('builderEditor').style.display = 'none';
}

async function deleteBuilderRoutine() {
  const d = state.builderDraft;
  if (!d) return;
  if (!confirm('Delete this routine?')) return;
  state.customRoutines = await window.vm.deleteRoutine(d.id);
  if (state.activeRoutineId === d.id) state.activeRoutineId = null;
  rebuildRoutine();
  renderBuilderRoutineList();
  renderRoutineSelect();
  el('builderEditor').style.display = 'none';
}

// ---------- SETTINGS MODAL ----------
async function showSettings() {
  const s = await window.vm.getSettings();
  el('setSessionsPerDay').value = s.sessionsPerDay;
  el('setWindowStart').value = s.windowStart;
  el('setWindowEnd').value = s.windowEnd;
  el('setAutoStart').checked = !!s.autoStart;
  el('setVoiceType').value = (s.voiceProfile && s.voiceProfile.voiceType) || 'baritone';
  el('setLowestComfortable').value = (s.voiceProfile && s.voiceProfile.lowestComfortable) || '';
  el('setHighestComfortable').value = (s.voiceProfile && s.voiceProfile.highestComfortable) || '';
  el('setTargetHighest').value = (s.voiceProfile && s.voiceProfile.targetHighest) || '';
  updateVoiceHint();
  await updateSettingsPreview();
  window.vm.getVersion().then((v) => { el('appVersion').textContent = v; });
  el('settingsModal').style.display = '';
}

function hideSettings() {
  el('settingsModal').style.display = 'none';
}

function updateVoiceHint() {
  const vt = el('setVoiceType').value;
  const offset = VOICE_TYPE_OFFSET[vt] || 0;
  const sign = offset > 0 ? '+' : '';
  el('setVoiceHint').textContent = offset === 0
    ? 'Baseline routine — no transposition.'
    : `Routine targets will be shifted ${sign}${offset} semitones from the baritone baseline.`;
}

async function updateSettingsPreview() {
  const times = await window.vm.schedulePreview();
  el('setPreview').textContent = 'Next sessions today: ' +
    times.map(t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })).join(', ');
}

async function saveSettings() {
  const patch = {
    sessionsPerDay: Number(el('setSessionsPerDay').value),
    windowStart: el('setWindowStart').value,
    windowEnd: el('setWindowEnd').value,
    autoStart: el('setAutoStart').checked,
    voiceProfile: {
      voiceType: el('setVoiceType').value,
      lowestComfortable: el('setLowestComfortable').value.trim(),
      highestComfortable: el('setHighestComfortable').value.trim(),
      targetHighest: el('setTargetHighest').value.trim()
    }
  };
  await window.vm.setSettings(patch);
  applyVoiceType(patch.voiceProfile.voiceType);
  await loadProfile();
  showToast('Settings saved.', 'ok');
  hideSettings();
}

async function refreshHeaderStats() {
  const stats = await window.vm.getStats();
  el('xpValue').textContent = state.sessionActive ? state.xpEarned : (stats.todayXp || 0);
  el('streakValue').textContent = stats.streak || 0;
}

async function markRange(kind) {
  if (state.lastDetectedMidi == null) {
    showToast('Sing a sustained note first — nothing detected yet.', 'info');
    return;
  }
  const noteName = midiToName(state.lastDetectedMidi);
  await window.vm.logRange({ kind, note: noteName, midi: state.lastDetectedMidi });
  const s = await window.vm.getSettings();
  const patch = { ...s.voiceProfile };
  if (kind === 'low') patch.lowestComfortable = noteName;
  if (kind === 'high') patch.highestComfortable = noteName;
  await window.vm.setSettings({ voiceProfile: patch });
  loadProfile();
}

// ---------- WIRING ----------
el('startBtn').addEventListener('click', startSession);
el('micBtn').addEventListener('click', () => enableMic());
el('skipBtn').addEventListener('click', skipChallenge);
el('restartBtn').addEventListener('click', restartChallenge);
el('quitBtn').addEventListener('click', quitSession);
el('pauseBtn').addEventListener('click', togglePause);

// Keyboard shortcuts — only active when the session panel is visible, no
// modal is open, and the user isn't typing into an input/textarea.
window.addEventListener('keydown', (ev) => {
  const tag = (ev.target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || ev.target.isContentEditable) return;
  if (el('settingsModal').style.display !== 'none') return; // settings modal owns Esc
  const inSession = state.sessionActive && el('sessionPanel').style.display !== 'none';
  if (!inSession) return;
  switch (ev.key) {
    case ' ': {
      ev.preventDefault();
      const ex = state.routine[state.exIdx];
      const ch = ex && ex.challenges[state.chIdx];
      if (ch) playReferenceFor(ch);
      break;
    }
    case 'p': case 'P':
      ev.preventDefault();
      togglePause();
      break;
    case 's': case 'S':
      ev.preventDefault();
      skipChallenge();
      break;
    case 'r': case 'R':
      ev.preventDefault();
      restartChallenge();
      break;
    case 'Escape':
      ev.preventDefault();
      quitSession();
      break;
  }
});
el('playRefBtn').addEventListener('click', () => {
  const ex = state.routine[state.exIdx];
  const ch = ex && ex.challenges[state.chIdx];
  if (ch) playReferenceFor(ch);
});
el('closeSummaryBtn').addEventListener('click', showIdle);
el('markLowBtn').addEventListener('click', () => markRange('low'));
el('markHighBtn').addEventListener('click', () => markRange('high'));
el('settingsBtn').addEventListener('click', showSettings);
el('settingsCloseBtn').addEventListener('click', hideSettings);
el('settingsCancelBtn').addEventListener('click', hideSettings);
el('settingsSaveBtn').addEventListener('click', saveSettings);
el('setVoiceType').addEventListener('change', updateVoiceHint);
el('checkUpdatesBtn').addEventListener('click', async () => {
  const btn = el('checkUpdatesBtn');
  btn.textContent = 'Checking…'; btn.disabled = true;
  const res = await window.vm.checkForUpdates();
  btn.disabled = false;
  btn.textContent = 'Check for updates now';
  if (res && res.ok === false && res.reason === 'dev') {
    showToast('Auto-update only runs in the installed app, not in dev mode.', 'info');
  } else if (res && res.ok === false) {
    showToast('Update check failed: ' + res.reason, 'error');
  }
});
['setSessionsPerDay', 'setWindowStart', 'setWindowEnd'].forEach((id) =>
  el(id).addEventListener('change', updateSettingsPreview));
// Click outside the panel closes the modal
el('settingsModal').addEventListener('click', (ev) => {
  if (ev.target.id === 'settingsModal') hideSettings();
});
// Esc to close the modal (only when it's open and we're not in session)
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && el('settingsModal').style.display !== 'none') {
    hideSettings();
  }
});
window.vm.onOpenSettings(() => { showSettings(); });

window.vm.onUpdateStatus(({ status, info }) => {
  switch (status) {
    case 'available':
      showUpdateNotice(info && info.version, false);
      break;
    case 'downloaded':
      showUpdateNotice(info && info.version, true);
      break;
    case 'error':
      console.warn('[update] error', info && info.message);
      break;
    // 'checking', 'none', 'downloading' are intentionally quiet
  }
});

// Tab bar navigation
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => navigateTo(tab.dataset.tab));
}

el('songPickerBack').addEventListener('click', showIdle);
el('spStartBtn').addEventListener('click', startSong);
el('spReplayBtn').addEventListener('click', () => {
  if (!state.currentSong) return;
  applySongTranspose(state.songTranspose || 0); // rebuild at the same key, ready state
  startSong();
});
el('spQuitBtn').addEventListener('click', quitSong);
el('spKeyDownOct').addEventListener('click', () => applySongTranspose((state.songTranspose || 0) - 12));
el('spKeyDown').addEventListener('click', () => applySongTranspose((state.songTranspose || 0) - 1));
el('spKeyUp').addEventListener('click', () => applySongTranspose((state.songTranspose || 0) + 1));
el('spKeyUpOct').addEventListener('click', () => applySongTranspose((state.songTranspose || 0) + 12));
el('spKeyAuto').addEventListener('click', () => applySongTranspose(autoFitTranspose(state.currentSong)));
el('karaokePickerBack').addEventListener('click', showIdle);
el('kpStartBtn').addEventListener('click', startKaraoke);
el('kpReplayBtn').addEventListener('click', () => {
  if (!state.songRunner) return;
  const songId = state.songRunner.song.id;
  openKaraoke(songId);
});
el('kpQuitBtn').addEventListener('click', quitKaraoke);
el('importLoadBtn').addEventListener('click', loadCustomSong);
el('importSchemaBtn').addEventListener('click', () => {
  const pre = el('importSchema');
  if (pre.style.display === 'none') {
    pre.textContent = SCHEMA_HELP;
    pre.style.display = '';
    el('importSchemaBtn').textContent = 'Hide schema';
  } else {
    pre.style.display = 'none';
    el('importSchemaBtn').textContent = 'Show schema';
  }
});
el('fsBackBtn').addEventListener('click', exitFreestyle);
el('fsRecBtn').addEventListener('click', toggleFreestyleRecording);
el('fsClearBtn').addEventListener('click', clearFreestyleTrace);
el('fsSourceBtn').addEventListener('click', toggleFreestyleSource);
el('fsMatchBtn').addEventListener('click', toggleFreestyleMatch);
el('fsMatchRefresh').addEventListener('click', refreshMatchSources);
el('fsMatchSource').addEventListener('change', async () => {
  localStorage.setItem('fsMatchSource', el('fsMatchSource').value);
  // If we're already matching, switch the live reference to the new source.
  if (tracker.hasReference()) { await stopMatchSource(); await startMatchSource(); }
});
// Stream captured-app PCM into the reference pitch/timbre path.
window.vm.onAppCaptureData((chunk) => tracker.pushReferencePcm(chunk));
el('fsMonOn').addEventListener('change', applyFreestyleMonitor);
el('fsMonEar').addEventListener('change', applyFreestyleMonitor);
el('fsMonReverb').addEventListener('input', applyFreestyleMonitor);
el('fsMonLevel').addEventListener('input', applyFreestyleMonitor);

// Dashboard
el('dashboardBack').addEventListener('click', showIdle);

// Ear training
el('earBack').addEventListener('click', exitEar);
el('earStartBtn').addEventListener('click', startEar);
el('earReplayBtn').addEventListener('click', playEarTarget);
el('earSkipBtn').addEventListener('click', skipEarRound);
el('earRangeLow').addEventListener('input', updateEarRangeLabels);
el('earRangeHigh').addEventListener('input', updateEarRangeLabels);

// Breath trainer
el('breathBack').addEventListener('click', exitBreath);
el('breathStartBtn').addEventListener('click', startBreath);
el('hvBack').addEventListener('click', exitHeadVoice);
el('hvStartBtn').addEventListener('click', startHeadVoice);
el('hvGuideBtn').addEventListener('click', playHvGuide);
el('hvNextBtn').addEventListener('click', hvNextStep);
el('hvStopBtn').addEventListener('click', finishHeadVoice);
el('breathStopBtn').addEventListener('click', finishBreath);

// Interval training
el('intervalsBack').addEventListener('click', () => { teardownCurrent(); showIdle(); });
el('intervalStartBtn').addEventListener('click', startIntervals);
el('intervalReplayBtn').addEventListener('click', playIntervalPair);

// Routine builder + selector
el('routineSelect').addEventListener('change', async (ev) => {
  const id = ev.target.value || null;
  await window.vm.setActiveRoutine(id);
  state.activeRoutineId = id;
  rebuildRoutine();
});
el('editRoutinesBtn').addEventListener('click', showRoutineBuilder);
el('builderBack').addEventListener('click', () => { showIdle(); renderRoutineSelect(); });
el('builderNewBtn').addEventListener('click', () => openBuilderEditor(null));
el('builderSaveBtn').addEventListener('click', saveBuilderRoutine);
el('builderDeleteBtn').addEventListener('click', deleteBuilderRoutine);
el('builderCancelBtn').addEventListener('click', () => { el('builderEditor').style.display = 'none'; });

window.vm.onStartSession(() => {
  if (!state.sessionActive) startSession();
});

renderRoutinePreview();
showIdle();
loadProfile();
loadRoutines();
pitchTrace = new PitchTrace(el('pitchTrace'));
pitchTrace.draw();
