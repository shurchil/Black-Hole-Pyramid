/**
 * Preload bridge.
 *
 * This is the entire surface the renderer can reach. Everything is explicit:
 * there is no generic `invoke(channel, ...)` escape hatch, so a compromised
 * renderer cannot reach arbitrary IPC channels or the filesystem.
 *
 * The Steam calls that report progress are fire-and-forget on purpose — the
 * game must never block a frame waiting on a storefront.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Availability and player name are resolved once at startup so the synchronous
// getters the game expects can answer without an await.
let available = false;
let playerName = null;

void ipcRenderer.invoke('steam:available').then((value) => {
  available = Boolean(value);
  if (available) {
    void ipcRenderer.invoke('steam:playerName').then((name) => {
      playerName = name;
    });
  }
});

contextBridge.exposeInMainWorld('steamBridge', {
  isAvailable: () => available,
  getPlayerName: () => playerName,
  unlockAchievement: (apiName) => {
    if (typeof apiName === 'string') ipcRenderer.send('steam:unlockAchievement', apiName);
  },
  setStat: (name, value) => {
    if (typeof name === 'string' && typeof value === 'number') {
      ipcRenderer.send('steam:setStat', name, value);
    }
  },
  store: () => ipcRenderer.send('steam:store'),
  openOverlay: () => {
    /* reserved for the Steam overlay; intentionally inert outside Steam */
  },
});
