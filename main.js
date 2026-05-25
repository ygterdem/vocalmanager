const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, session, systemPreferences, powerMonitor, desktopCapturer } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const store = new Store({
  defaults: {
    sessionsPerDay: 3,
    windowStart: '09:00',
    windowEnd: '21:00',
    autoStart: true,
    voiceProfile: {
      voiceType: 'baritone',
      lowestComfortable: 'E2',
      highestComfortable: 'E4',
      targetHighest: 'A4'
    },
    rangeLog: [],
    achievements: [],
    customRoutines: [],   // [{id, name, exerciseIndices:[...]}]
    activeRoutineId: null, // null = built-in default
    stats: {
      totalXp: 0,
      todayXp: 0,
      todayDate: '',
      streak: 0,
      lastSessionDate: '',
      sessions: []   // [{date, passed, total, xp, topMidi}]
    }
  }
});

const ACHIEVEMENTS = [
  { id: 'first-session', label: 'First session', desc: 'Complete your first vocal session.',
    check: (st) => (st.sessions || []).length >= 1 },
  { id: 'perfect-routine', label: 'Perfect routine', desc: 'Pass every challenge in a session.',
    check: (_st, ctx) => ctx.total > 0 && ctx.passed === ctx.total },
  { id: 'streak-3', label: '3-day streak', desc: 'Practice three days in a row.',
    check: (st) => st.streak >= 3 },
  { id: 'streak-7', label: '7-day streak', desc: 'A full week — habit forming.',
    check: (st) => st.streak >= 7 },
  { id: 'streak-30', label: '30-day streak', desc: 'A month of daily practice.',
    check: (st) => st.streak >= 30 },
  { id: 'xp-100', label: '100 XP', desc: 'Earn a hundred experience points.',
    check: (st) => st.totalXp >= 100 },
  { id: 'xp-500', label: '500 XP', desc: 'Halfway to a thousand.',
    check: (st) => st.totalXp >= 500 },
  { id: 'xp-1000', label: '1000 XP', desc: 'Four-digit XP. You earned this.',
    check: (st) => st.totalXp >= 1000 },
  { id: 'high-c4', label: 'Hit C4', desc: 'Reach middle C (the male tenor passaggio).',
    check: (_st, ctx) => ctx.topMidi != null && ctx.topMidi >= 60 },
  { id: 'high-c5', label: 'Hit C5', desc: 'Reach soprano C — the head-voice gateway for men.',
    check: (_st, ctx) => ctx.topMidi != null && ctx.topMidi >= 72 },
  { id: 'high-c6', label: 'Hit C6', desc: 'Whistle territory.',
    check: (_st, ctx) => ctx.topMidi != null && ctx.topMidi >= 84 }
];

function evaluateAchievements(stats, ctx) {
  const unlocked = store.get('achievements') || [];
  const newly = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked.includes(a.id)) continue;
    try {
      if (a.check(stats, ctx)) {
        unlocked.push(a.id);
        newly.push({ id: a.id, label: a.label, desc: a.desc });
      }
    } catch (e) {
      console.warn('[achievements] check failed for', a.id, e);
    }
  }
  store.set('achievements', unlocked);
  return newly;
}

let tray = null;
let mainWindow = null;
let scheduleTimers = [];
let isQuitting = false;

// 16×16 microphone glyph (accent-green capsule + blue stand). Generated.
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARUlEQVR42mNgGLQg7/n2/8iYZM37' +
  '/j/8T7YhowZgxgDZMUGy5oSlv/6j87GJEW0IugEENaMrRDaAaM2EvEC0JlyY6pkOAHV5ypNyANfBAAAAAElFTkSuQmCC';

function getTrayIcon() {
  const img = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  return img.isEmpty()
    ? nativeImage.createEmpty()
    : img.resize({ width: 16, height: 16 });
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isMaximized()) mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'Vocal Manager',
    backgroundColor: '#0e0f13',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();   // always open using the full screen
    mainWindow.show();
    if (process.argv.includes('--enable-logging') || process.env.VM_DEVTOOLS) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  return mainWindow;
}

function openSettings() {
  // Settings is now an in-window modal. Show the main window and tell the
  // renderer to open it. The legacy settings.html file is kept around for
  // direct navigation but is no longer how the tray menu reaches settings.
  const w = createMainWindow();
  const send = () => w.webContents.send('open-settings');
  if (w.webContents.isLoading()) {
    w.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function sendUpdateStatus(status, info) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, info: info || null });
  }
}

function setupAutoUpdates() {
  // The updater only functions in a packaged build (it reads app-update.yml
  // baked in by electron-builder). In dev (`npm start`) this is a no-op.
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', (info) => sendUpdateStatus('available', { version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdateStatus('none'));
  autoUpdater.on('download-progress', (p) => sendUpdateStatus('downloading', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => sendUpdateStatus('downloaded', { version: info.version }));
  autoUpdater.on('error', (err) => sendUpdateStatus('error', { message: String((err && err.message) || err) }));
  autoUpdater.checkForUpdates().catch(() => {});
  // Re-check every 6h for machines that leave the app running in the tray.
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

function parseHHMM(s) {
  const [h, m] = s.split(':').map(Number);
  return { h, m };
}

function computeSessionTimes() {
  const sessions = Math.max(1, Number(store.get('sessionsPerDay')) || 3);
  const { h: sh, m: sm } = parseHHMM(store.get('windowStart'));
  const { h: eh, m: em } = parseHHMM(store.get('windowEnd'));
  const now = new Date();
  const startMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm).getTime();
  const endMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em).getTime();
  const span = Math.max(0, endMs - startMs);
  const times = [];
  if (sessions === 1) {
    times.push(startMs + span / 2);
  } else {
    const step = span / (sessions - 1);
    for (let i = 0; i < sessions; i++) times.push(startMs + step * i);
  }
  return times;
}

function clearTimers() {
  scheduleTimers.forEach((t) => clearTimeout(t));
  scheduleTimers = [];
}

function scheduleToday() {
  clearTimers();
  const times = computeSessionTimes();
  const now = Date.now();
  times.forEach((t, idx) => {
    const delay = t - now;
    if (delay > 0) {
      scheduleTimers.push(
        setTimeout(() => fireReminder(idx + 1, times.length), delay)
      );
    }
  });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 5, 0, 0);
  scheduleTimers.push(setTimeout(scheduleToday, tomorrow.getTime() - now));
}

function fireReminder(n, total) {
  const note = new Notification({
    title: `Vocal session ${n}/${total}`,
    body: 'Time for a quick warm-up. Click to open your routine.',
    silent: false
  });
  note.on('click', () => {
    const w = createMainWindow();
    const send = () => w.webContents.send('start-session', { index: n, total });
    if (w.webContents.isLoading()) {
      w.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  });
  note.show();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Vocal Manager', click: () => createMainWindow() },
    { label: 'Practice now', click: () => {
        const w = createMainWindow();
        const send = () => w.webContents.send('start-session', { index: 0, total: 0, adhoc: true });
        if (w.webContents.isLoading()) {
          w.webContents.once('did-finish-load', send);
        } else {
          send();
        }
      }
    },
    { type: 'separator' },
    { label: 'Settings…', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);
}

app.on('second-instance', () => createMainWindow());

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.vocalmanager.app');

    // Auto-grant mic / audio permission requests, but only from our own
    // renderer windows (defensive — there shouldn't be any others, but if a
    // dependency ever opens a third-party webview we don't want to silently
    // hand it the mic).
    const isOwnRenderer = (wc) => {
      if (!wc) return false;
      try {
        const url = wc.getURL();
        return url.startsWith('file://') && /renderer\/(index|settings)\.html/.test(url);
      } catch (_) { return false; }
    };
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      if ((permission === 'media' || permission === 'audioCapture') && isOwnRenderer(wc)) {
        return callback(true);
      }
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission) => {
      if ((permission === 'media' || permission === 'audioCapture') && isOwnRenderer(wc)) return true;
      return false;
    });

    // System-audio (loopback) capture for "listen to what's playing on the PC".
    // We auto-provide a screen source + loopback audio so getDisplayMedia in the
    // renderer doesn't pop a picker; the renderer drops the video track and
    // only analyzes the audio.
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' });
      }).catch(() => callback({}));
    });
    if (process.platform === 'darwin' && systemPreferences.askForMediaAccess) {
      systemPreferences.askForMediaAccess('microphone').catch(() => {});
    }

    tray = new Tray(getTrayIcon());
    tray.setToolTip('Vocal Manager — vocal training reminders');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', () => createMainWindow());

    if (store.get('autoStart')) {
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true,
        args: ['--hidden']
      });
    }

    scheduleToday();
    setupAutoUpdates();

    // Single setTimeout calls don't survive system sleep cleanly on Windows —
    // when the laptop wakes 4h later, the queued reminder may fire late or
    // not at all. Re-reconcile timers whenever the OS comes back from sleep,
    // and once a missed-window check has run, notify if today still has
    // pending sessions left.
    const onPowerEvent = () => scheduleToday();
    powerMonitor.on('resume', onPowerEvent);
    powerMonitor.on('unlock-screen', onPowerEvent);

    if (!process.argv.includes('--hidden')) {
      createMainWindow();
    }
  });
}

app.on('window-all-closed', (e) => {
  // Keep alive in tray
});

ipcMain.handle('settings:get', () => ({
  sessionsPerDay: store.get('sessionsPerDay'),
  windowStart: store.get('windowStart'),
  windowEnd: store.get('windowEnd'),
  autoStart: store.get('autoStart'),
  voiceProfile: store.get('voiceProfile')
}));

ipcMain.handle('settings:set', (_evt, patch) => {
  Object.entries(patch).forEach(([k, v]) => store.set(k, v));
  if (typeof patch.autoStart === 'boolean') {
    app.setLoginItemSettings({
      openAtLogin: patch.autoStart,
      openAsHidden: patch.autoStart,
      args: ['--hidden']
    });
  }
  scheduleToday();
  return true;
});

ipcMain.handle('range:log', (_evt, entry) => {
  const log = store.get('rangeLog') || [];
  log.push({ ...entry, at: Date.now() });
  store.set('rangeLog', log.slice(-200));
  return true;
});

ipcMain.handle('range:history', () => store.get('rangeLog') || []);

ipcMain.handle('schedule:preview', () => computeSessionTimes());

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.round((db - da) / 86400000);
}

ipcMain.handle('stats:get', () => {
  const s = store.get('stats');
  const today = todayKey();
  if (s.todayDate !== today) {
    s.todayXp = 0;
    s.todayDate = today;
    store.set('stats', s);
  }
  return s;
});

ipcMain.handle('stats:recordSession', (_e, { passed, total, xp, topMidi, avgStability }) => {
  const s = store.get('stats');
  const today = todayKey();
  if (s.todayDate !== today) {
    s.todayXp = 0;
    s.todayDate = today;
  }
  s.todayXp += xp;
  s.totalXp += xp;

  // Streak: only counts when at least one challenge passed today
  if (passed > 0) {
    const gap = daysBetween(s.lastSessionDate, today);
    if (s.lastSessionDate === today) {
      // already counted today
    } else if (gap === 1) {
      s.streak += 1;
    } else if (gap == null || gap > 1) {
      s.streak = 1;
    }
    s.lastSessionDate = today;
  }
  s.sessions = (s.sessions || []).slice(-89);
  s.sessions.push({ date: today, passed, total, xp, topMidi, avgStability: avgStability ?? null, at: Date.now() });
  store.set('stats', s);
  const newAchievements = evaluateAchievements(s, { passed, total, xp, topMidi });
  return Object.assign({}, s, { _newAchievements: newAchievements });
});

ipcMain.handle('achievements:list', () => ({
  defs: ACHIEVEMENTS.map(({ id, label, desc }) => ({ id, label, desc })),
  unlocked: store.get('achievements') || []
}));

ipcMain.handle('routines:get', () => ({
  customRoutines: store.get('customRoutines') || [],
  activeRoutineId: store.get('activeRoutineId') ?? null
}));

ipcMain.handle('routines:save', (_e, routine) => {
  const list = store.get('customRoutines') || [];
  const idx = list.findIndex((r) => r.id === routine.id);
  if (idx >= 0) list[idx] = routine;
  else list.push(routine);
  store.set('customRoutines', list);
  return list;
});

ipcMain.handle('routines:delete', (_e, id) => {
  const list = (store.get('customRoutines') || []).filter((r) => r.id !== id);
  store.set('customRoutines', list);
  if (store.get('activeRoutineId') === id) store.set('activeRoutineId', null);
  return list;
});

ipcMain.handle('routines:setActive', (_e, id) => {
  store.set('activeRoutineId', id ?? null);
  return true;
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { ok: false, reason: 'dev' };
  try { await autoUpdater.checkForUpdates(); return { ok: true }; }
  catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});

ipcMain.handle('update:install', () => {
  isQuitting = true;
  // isSilent=true (no installer UI), isForceRunAfter=true (relaunch after).
  autoUpdater.quitAndInstall(true, true);
});
