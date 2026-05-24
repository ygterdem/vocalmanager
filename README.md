# Vocal Manager

A background Electron app that reminds you to do quick vocal exercises throughout
the day, with real-time mic-based pitch feedback. The default routine is tuned
for a low male voice (bass / baritone) and focused on extending the upper range
via lip trills, ng-sirens, 5-tone scales, and octave slides.

## Setup

```powershell
npm install
npm start
```

The app installs into the system tray. Close the window — it keeps running.
Right-click the tray icon for "Practice now", "Settings", or "Quit".

## How it works

- **Background scheduler.** You set sessions/day and an active time window
  (defaults: 3 sessions, 09:00–21:00). The app spaces notifications evenly.
  Click the notification to open the guided routine.
- **Real-time pitch detection.** Uses [Pitchy](https://github.com/ianprime0509/pitchy)
  (YIN/MPM) on the mic input. The big readout shows the detected note + cents
  off; the proximity bar shows how close you are to the exercise target.
- **Range tracking.** Sustain a low or high note, then click "Mark as low" /
  "Mark as high" — the app logs it and updates your voice profile.
- **Auto-start.** Enabled by default. Launches hidden into the tray on Windows
  login.

## Routine (default)

1. Lip trill warm-up (~90s)
2. Ng-sirens — mix builder (~90s)
3. 5-tone "nay" scale, chest (~90s)
4. 5-tone "nay" scale, bridge (~120s)
5. Octave slides on "wee" (~90s)
6. Cooldown sirens (~60s)

Total: ~8–9 minutes. Each step shows a reference tone you can play, a target
note range, and an instruction.

## Files

- `main.js` — Electron main process: tray, scheduler, notifications, settings store
- `preload.js` — IPC bridge
- `renderer/index.html` — main session window
- `renderer/app.js` — UI orchestrator
- `renderer/pitch.js` — mic capture + Pitchy + reference tone player
- `renderer/exercises.js` — routine definitions and note/frequency math
- `renderer/settings.html` — schedule + voice profile

## Notes

- The tray icon is a placeholder; replace `TRAY_ICON_DATA_URL` in `main.js`
  with a real 16×16 PNG if you want a recognizable icon.
- Mic permission is requested on first session start.
- For best pitch accuracy, disable Windows mic enhancements (noise suppression
  fights the detector).
