const path = require('path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');

require('./app/server.js');

let mainWindow = null;
let settingsWindow = null;

function sendAppVersion() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-version', app.getVersion());
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#313338',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    sendAppVersion();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openChat(username) {
  if (!mainWindow) return;

  mainWindow.loadFile(path.join(__dirname, 'app', 'chat.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('set-username', username);
    sendAppVersion();
  });
}

function openLogin() {
  if (!mainWindow) return;

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    sendAppVersion();
  });
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 420,
    height: 320,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    parent: mainWindow || undefined,
    modal: false,
    backgroundColor: '#313338',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'app', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function setupAutoUpdates() {
  log.initialize();
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'info';
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info?.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        type: 'available',
        version: info?.version || null
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info?.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        type: 'not-available',
        version: info?.version || null
      });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    log.info(`Downloaded ${progress.percent}%`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        type: 'downloading',
        percent: progress.percent
      });
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    log.info('Update downloaded:', info?.version);

    const result = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Перезапустить сейчас', 'Позже'],
      defaultId: 0,
      cancelId: 1,
      title: 'Обновление готово',
      message: 'Новая версия MiniDiscord уже скачана.',
      detail: 'Перезапустить приложение сейчас и установить обновление?'
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (err) => {
    log.error('Auto update error:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', {
        type: 'error',
        message: err?.message || 'Unknown update error'
      });
    }
  });

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 3000);
}

ipcMain.on('login-success', (_event, username) => {
  openChat(username);
});

ipcMain.on('logout', () => {
  openLogin();
});

ipcMain.on('open-settings', () => {
  openSettingsWindow();
});

ipcMain.on('apply-mic-settings', (_event, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-mic-settings', payload);
  }
});

app.whenReady().then(() => {
  createMainWindow();
  setupAutoUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});