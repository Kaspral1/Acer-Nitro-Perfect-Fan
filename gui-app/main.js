const { app, BrowserWindow, ipcMain, Tray, Menu, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const net = require('net');

const appIsPackaged = app.isPackaged;
const pythonExecutable = 'python3';

// Manual PWM floors (must match daemon / API) — both fans min 30%
const MIN_PCT_CPU = 30;
const MIN_PCT_GPU = 30;
const MIN_PCT_MASTER = 30;

let pythonScriptPath;
if (appIsPackaged) {
  pythonScriptPath = path.join(process.resourcesPath, 'nbfc_control_api.py');
} else {
  pythonScriptPath = path.join(__dirname, '..', 'nbfc_control_api.py');
}

console.log(`[Main] Python script path: ${pythonScriptPath}`);

if (!fs.existsSync(pythonScriptPath)) {
  console.error(`[Main] Python script not found: ${pythonScriptPath}`);
  app.quit();
  return;
}

let mainWindow;
let tray = null;
let pythonProcess = null;
let appIsQuitting = false;
/** Preferencja przycisku X / zamknięcia okna: null = pytaj, 'minimize' | 'quit' */
let closeActionPref = null;

function clampManualSpeed(fanId, speed) {
  let s = Math.max(0, Math.min(100, Number(speed) || 0));
  if (fanId === undefined || fanId === null) {
    return Math.max(MIN_PCT_MASTER, s);
  }
  if (Number(fanId) === 0) {
    return Math.max(MIN_PCT_CPU, s);
  }
  return Math.max(MIN_PCT_GPU, s);
}

function sendBackendStatus(connected, detail) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('backend-status', {
      connected: !!connected,
      detail: detail || null,
    });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 920,
    minWidth: 800,
    minHeight: 560,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#1a1a1a',
    autoHideMenuBar: true,
    frame: false,
    show: false,
  });

  const indexPath = path.join(__dirname, 'index.html');
  console.log(`[Main] Loading HTML from: ${indexPath}`);
  mainWindow.loadFile(indexPath);

  mainWindow.once('ready-to-show', () => {
    // Blokada zoomu (Ctrl+/- / gesty) — wyglądało jak „okno o połowę mniejsze”
    try {
      mainWindow.webContents.setZoomFactor(1);
      mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
    } catch (e) {
      console.warn('[Main] zoom lock failed:', e.message);
    }
    mainWindow.show();
    startPythonBackend();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    try {
      mainWindow.webContents.setZoomFactor(1);
    } catch (_) { /* ignore */ }
  });

  mainWindow.on('close', (event) => {
    if (appIsQuitting) return;
    // Zawsze przejmujemy zamknięcie (X / Alt+F4 / menedżer okien),
    // żeby respektować ustawienie: pytaj / tray / wyjście.
    event.preventDefault();
    if (closeActionPref === 'quit') {
      appIsQuitting = true;
      stopPythonBackend();
      app.quit();
      return;
    }
    if (closeActionPref === 'minimize') {
      mainWindow.hide();
      return;
    }
    // 'ask' — pokaż okno i poproś renderer o modal potwierdzenia
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('close-requested');
  });

  mainWindow.on('closed', () => {
    stopPythonBackend();
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray_icon.png');
  tray = new Tray(iconPath);

  // Locale-aware tray labels (system language, fallback EN)
  const isPl = (app.getLocale() || '').toLowerCase().startsWith('pl');
  const labels = isPl
    ? { show: 'Pokaż aplikację', quit: 'Zakończ', tip: 'Acer Nitro Perfect Fan' }
    : { show: 'Show application', quit: 'Quit', tip: 'Acer Nitro Perfect Fan' };

  const contextMenu = Menu.buildFromTemplate([
    {
      label: labels.show,
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: labels.quit,
      click: () => {
        appIsQuitting = true;
        stopPythonBackend();
        app.quit();
      },
    },
  ]);
  tray.setToolTip(labels.tip);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function startPythonBackend() {
  try {
    console.log('[Main] Starting Python backend...');
    // Ensure log summary helper is importable when packaged or from repo root
    const scriptDir = path.dirname(pythonScriptPath);
    const env = { ...process.env, PYTHONPATH: [scriptDir, process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter) };

    pythonProcess = spawn(pythonExecutable, [pythonScriptPath], {
      cwd: scriptDir,
      env,
    });

    sendBackendStatus(true, 'started');

    let stdoutBuffer = '';

    pythonProcess.stdout.on('data', (data) => {
      try {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
          const message = line.trim();
          if (!message) continue;
          if (message.startsWith('{')) {
            const jsonData = JSON.parse(message);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('fan-data', jsonData);
            }
          } else {
            console.log(`[Python] ${message}`);
          }
        }
      } catch (err) {
        console.error('[Main] Error processing Python data:', err.message);
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      console.log(`[Python] Log: ${data}`);
    });

    pythonProcess.on('close', (code) => {
      console.log(`[Main] Python process exited with code: ${code}`);
      pythonProcess = null;
      sendBackendStatus(false, `exited:${code}`);
    });

    pythonProcess.on('error', (err) => {
      console.error('[Main] Python process error:', err);
      pythonProcess = null;
      sendBackendStatus(false, err.message);
    });
  } catch (err) {
    console.error('[Main] Error starting Python backend:', err);
    sendBackendStatus(false, err.message);
  }
}

function stopPythonBackend() {
  if (pythonProcess) {
    console.log('[Main] Stopping Python backend...');
    pythonProcess.kill();
    pythonProcess = null;
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopPythonBackend();
    app.quit();
  }
});

app.on('before-quit', () => {
  appIsQuitting = true;
  stopPythonBackend();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// --- IPC ---

ipcMain.handle('get-app-version', () => app.getVersion());

const EXTERNAL_URLS = new Set([
  'https://github.com/PXDiv/Div-Acer-Manager-Max',
  'https://github.com/PXDiv/Div-Linuwu-Sense',
  'https://github.com/Kaspral1/Acer-Nitro-Perfect-Fan',
  'https://github.com/keizenx/nitro-fan-control',
  'https://www.gnu.org/licenses/gpl-3.0.html',
  'https://opensource.org/licenses/MIT',
]);

ipcMain.handle('open-external', async (_event, url) => {
  const target = String(url || '').trim();
  if (!EXTERNAL_URLS.has(target)) {
    console.warn('[Main] blocked open-external:', target);
    return false;
  }
  try {
    await shell.openExternal(target);
    return true;
  } catch (err) {
    console.error('[Main] open-external failed:', err.message);
    return false;
  }
});

// DAMX thermal / CPU power profiles (firmware platform_profile is EIO on AN515-54;
// the daemon + LD_PRELOAD shim applies intel_pstate via /var/run/DAMX.sock).
const DAMX_SOCKET = '/var/run/DAMX.sock';
const DAMX_PROFILE_CACHE = '/var/lib/damx/thermal_profile';
const DAMX_PROFILE_CHOICES = [
  'low-power',
  'quiet',
  'balanced',
  'balanced-performance',
  'performance',
];

function readDamxProfileCache() {
  try {
    if (!fs.existsSync(DAMX_PROFILE_CACHE)) return null;
    const value = fs.readFileSync(DAMX_PROFILE_CACHE, 'utf8').trim().toLowerCase();
    return DAMX_PROFILE_CHOICES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function damxRequest(command, params = {}, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (!fs.existsSync(DAMX_SOCKET)) {
      resolve({ success: false, error: 'socket-missing' });
      return;
    }

    const socket = net.createConnection(DAMX_SOCKET);
    let buf = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish({ success: false, error: 'timeout' }), timeoutMs);

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(JSON.stringify({ command, params }));
    });
    socket.on('data', (chunk) => {
      buf += chunk;
      try {
        finish(JSON.parse(buf));
      } catch {
        // wait for a complete JSON object
      }
    });
    socket.on('error', (err) => finish({ success: false, error: err.message }));
    socket.on('end', () => {
      if (!settled && buf) {
        try {
          finish(JSON.parse(buf));
          return;
        } catch { /* fall through */ }
      }
      finish({ success: false, error: 'closed' });
    });
  });
}

function normalizeDamxProfileState(res) {
  const data = res && res.success ? (res.data || {}) : {};
  const choices = Array.isArray(data.available) && data.available.length
    ? data.available
    : DAMX_PROFILE_CHOICES;
  const current = String(data.current || readDamxProfileCache() || '').trim().toLowerCase();
  return {
    available: !!(res && res.success),
    current: DAMX_PROFILE_CHOICES.includes(current) ? current : (current || null),
    choices,
    error: res && !res.success ? (res.error || 'damx-offline') : null,
  };
}

ipcMain.handle('get-thermal-profile', async () => {
  const res = await damxRequest('get_thermal_profile');
  return normalizeDamxProfileState(res);
});

ipcMain.handle('set-thermal-profile', async (_event, profile) => {
  const id = String(profile || '').trim().toLowerCase();
  if (!DAMX_PROFILE_CHOICES.includes(id)) {
    return {
      available: false,
      current: readDamxProfileCache(),
      choices: DAMX_PROFILE_CHOICES,
      error: 'invalid-profile',
    };
  }
  const res = await damxRequest('set_thermal_profile', { profile: id });
  if (res && res.success) {
    const after = await damxRequest('get_thermal_profile');
    const state = normalizeDamxProfileState(after.success ? after : res);
    if (!state.current) state.current = id;
    state.available = true;
    return state;
  }
  return normalizeDamxProfileState(res);
});

const KBD_LED_BRIGHTNESS = '/sys/devices/platform/acer-nitro-ec/kbd_backlight';
const KBD_LED_TIMEOUT = '/sys/devices/platform/acer-nitro-ec/kbd_timeout';

function readKbdTimeout() {
  try {
    if (!fs.existsSync(KBD_LED_TIMEOUT)) return null;
    return fs.readFileSync(KBD_LED_TIMEOUT, 'utf8').trim() === '1';
  } catch {
    return null;
  }
}

function readKbdBacklight() {
  try {
    if (!fs.existsSync(KBD_LED_BRIGHTNESS)) {
      return { available: false, level: 0, timeout: null };
    }
    const raw = parseInt(fs.readFileSync(KBD_LED_BRIGHTNESS, 'utf8').trim(), 10);
    const level = Number.isFinite(raw) ? Math.max(0, Math.min(4, raw)) : 0;
    return { available: true, level, timeout: readKbdTimeout() };
  } catch (err) {
    console.error('[Main] kbd backlight read failed:', err.message);
    return { available: false, level: 0, timeout: null };
  }
}

ipcMain.handle('get-kbd-backlight', () => readKbdBacklight());

ipcMain.handle('set-kbd-backlight', (_event, level) => {
  const n = Math.max(0, Math.min(4, Number(level) || 0));
  try {
    if (!fs.existsSync(KBD_LED_BRIGHTNESS)) {
      return { available: false, level: 0, timeout: null };
    }
    fs.writeFileSync(KBD_LED_BRIGHTNESS, String(n));
    return { available: true, level: n, timeout: readKbdTimeout() };
  } catch (err) {
    console.error('[Main] kbd backlight write failed:', err.message);
    return { available: false, level: n, timeout: null, error: err.message };
  }
});

ipcMain.handle('set-kbd-timeout', (_event, enabled) => {
  const on = enabled ? 1 : 0;
  try {
    if (!fs.existsSync(KBD_LED_TIMEOUT)) {
      return { available: false, timeout: null };
    }
    fs.writeFileSync(KBD_LED_TIMEOUT, String(on));
    return { available: true, timeout: on === 1 };
  } catch (err) {
    console.error('[Main] kbd timeout write failed:', err.message);
    return { available: false, timeout: null, error: err.message };
  }
});

ipcMain.on('request-fan-status', () => {
  // Status is pushed continuously by the Python loop; this is a no-op ping
  // that also reports backend liveness to the UI.
  sendBackendStatus(!!pythonProcess, pythonProcess ? 'alive' : 'dead');
});

ipcMain.on('set-fan-speed', (event, data) => {
  if (!pythonProcess) {
    console.error('[Main] Python backend is not running.');
    sendBackendStatus(false, 'dead');
    return;
  }

  if (data.fanId !== undefined && data.fanId !== null) {
    const speed = clampManualSpeed(data.fanId, data.speed);
    console.log(`[Main] set_fan_speed ${data.fanId} ${speed}`);
    pythonProcess.stdin.write(`set_fan_speed ${data.fanId} ${speed}\n`);
  } else {
    // Master base: set_all so API stores shared base (offset applied by daemon)
    const speed = clampManualSpeed(null, data.speed);
    console.log(`[Main] set_all_fans_speed ${speed}`);
    pythonProcess.stdin.write(`set_all_fans_speed ${speed}\n`);
  }
});

ipcMain.on('set-mode', (event, mode) => {
  const isDynamic = mode === 'auto';
  if (!pythonProcess) return;
  pythonProcess.stdin.write(`set_mode ${isDynamic ? 'dynamic' : 'fixed'}\n`);
});

ipcMain.on('apply-profile', (event, profile) => {
  if (!pythonProcess) return;
  pythonProcess.stdin.write(`apply_profile ${profile}\n`);
});

ipcMain.on('set-auto-logging', (event, enabled) => {
  if (!pythonProcess) return;
  pythonProcess.stdin.write(`set_auto_logging ${enabled}\n`);
});

ipcMain.on('get-log-summary', () => {
  if (!pythonProcess) return;
  pythonProcess.stdin.write('get_log_summary\n');
});

ipcMain.on('open-log-file', () => {
  const primaryPath = '/var/log/nitro-fan/telemetry.csv';
  const fallbackPath = path.join(os.homedir(), '.config', 'nitro-fan', 'telemetry.csv');

  let targetPath = primaryPath;
  if (!fs.existsSync(primaryPath)) {
    targetPath = fallbackPath;
  }

  if (fs.existsSync(targetPath)) {
    shell.openPath(targetPath);
  }
});

ipcMain.on('set-fan-curve', (event, curveData) => {
  if (!pythonProcess) return;
  const flatData = Array.isArray(curveData) ? curveData.flat() : [];
  pythonProcess.stdin.write(`set_curve ${flatData.join(' ')}\n`);
});

ipcMain.on('set-curve-source', (event, source) => {
  if (!pythonProcess) return;
  const src = (source === 'custom') ? 'custom' : 'default';
  pythonProcess.stdin.write(`set_curve_source ${src}\n`);
});

// set_default_curve <Profile> <cpu|gpu|all> t s t s ...
ipcMain.on('set-default-curve', (event, payload) => {
  if (!pythonProcess) return;
  if (!payload || typeof payload !== 'object') return;
  const profile = String(payload.profile || '').trim();
  const fan = String(payload.fan || 'all').toLowerCase();
  const points = Array.isArray(payload.points) ? payload.points : [];
  if (!profile || !['cpu', 'gpu', 'all'].includes(fan) || points.length < 2) {
    console.error('[Main] set-default-curve: invalid payload', payload);
    return;
  }
  const flat = points.flat();
  pythonProcess.stdin.write(`set_default_curve ${profile} ${fan} ${flat.join(' ')}\n`);
});

// reset_default_curves [Profile] — bez profilu = fabryczne dla wszystkich
ipcMain.on('reset-default-curves', (event, profile) => {
  if (!pythonProcess) return;
  if (profile && typeof profile === 'string' && profile.trim()) {
    pythonProcess.stdin.write(`reset_default_curves ${profile.trim()}\n`);
  } else {
    pythonProcess.stdin.write('reset_default_curves\n');
  }
});

ipcMain.on('set-speed-offset', (event, offset) => {
  if (!pythonProcess) {
    console.error('[Main] set-speed-offset: Python backend is not running.');
    return;
  }
  const val = Math.max(-50, Math.min(50, Math.round(Number(offset) || 0)));
  console.log(`[Main] set_speed_offset ${val}`);
  pythonProcess.stdin.write(`set_speed_offset ${val}\n`);
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  // Przechodzi przez handler 'close' → respektuje closeActionPref / modal
  if (mainWindow) mainWindow.close();
});

ipcMain.on('window-hide', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('window-quit', () => {
  appIsQuitting = true;
  stopPythonBackend();
  app.quit();
});

// Renderer synchronizuje preferencję zamykania (localStorage → main)
ipcMain.on('set-close-action-pref', (_event, action) => {
  if (action === 'quit' || action === 'minimize') {
    closeActionPref = action;
  } else {
    closeActionPref = null; // ask
  }
  console.log(`[Main] closeActionPref = ${closeActionPref || 'ask'}`);
});
