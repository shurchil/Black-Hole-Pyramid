/**
 * Electron main process — the Steam / desktop build.
 *
 * Security posture: the renderer runs with `nodeIntegration: false` and
 * `contextIsolation: true`. It never sees Node or Steamworks directly; the
 * preload script exposes a small, explicitly allow-listed bridge instead.
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');

/** Set this to the appid Valve issues for the store page before shipping. */
const STEAM_APP_ID = Number(process.env.STEAM_APP_ID || 480); // 480 = Spacewar test appid

let steamClient = null;

/**
 * Steamworks is loaded lazily and optionally: a desktop build must still run
 * perfectly when launched outside Steam (during development, or from a DRM-free
 * build), so a failure here is logged and then ignored.
 */
function initSteam() {
  try {
    const steamworks = require('steamworks.js');
    steamClient = steamworks.init(STEAM_APP_ID);
    console.log('[steam] initialised for', steamClient.localplayer.getName());
  } catch (err) {
    console.log('[steam] not available, running standalone:', err.message);
    steamClient = null;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: '#05060f',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // the preload needs require() for the Steam bridge
    },
  });

  // Avoid a white flash on launch: wait until the first frame is painted.
  win.once('ready-to-show', () => win.show());

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // External links open in the user's browser, never inside the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

/* ------------------------------------------------------------------ *
 * IPC: the only surface the renderer can reach
 * ------------------------------------------------------------------ */

ipcMain.handle('steam:available', () => steamClient !== null);

ipcMain.handle('steam:playerName', () => {
  try {
    return steamClient ? steamClient.localplayer.getName() : null;
  } catch {
    return null;
  }
});

ipcMain.on('steam:unlockAchievement', (_event, apiName) => {
  if (!steamClient || typeof apiName !== 'string') return;
  try {
    steamClient.achievement.activate(apiName);
  } catch (err) {
    console.warn('[steam] achievement failed:', apiName, err.message);
  }
});

ipcMain.on('steam:setStat', (_event, name, value) => {
  if (!steamClient || typeof name !== 'string' || typeof value !== 'number') return;
  try {
    steamClient.stats.setInt(name, Math.round(value));
  } catch (err) {
    console.warn('[steam] stat failed:', name, err.message);
  }
});

ipcMain.on('steam:store', () => {
  if (!steamClient) return;
  try {
    steamClient.stats.store();
  } catch {
    /* ignore */
  }
});

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

// One instance only: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    initSteam();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
