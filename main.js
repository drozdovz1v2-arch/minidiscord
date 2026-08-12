const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const CONFIG = require('./config');
const { initializeNetwork, getNetworkState } = require('./network-setup');

// WebRTC: использовать Radmin/VPN интерфейсы для голоса
app.commandLine.appendSwitch(
  'force-webrtc-ip-handling-policy',
  'default_public_and_private_interfaces'
);
app.commandLine.appendSwitch('enable-features', 'WebRtcAllowInputVolumeAdjustment');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

let mainWindow = null;
let sessionToken = null;
let splashWindow = null;
let settingsWindow = null;
let updateWindow = null;
let isQuittingForUpdate = false;
let isCheckingUpdates = false;
let hasFinishedStartupCheck = false;
let currentUsername = null;
let startupUpdateTimeout = null;

const APP_ICON = path.join(__dirname, 'build', 'icon.ico');

function getSessionFilePath() {
  return path.join(app.getPath('userData'), 'session.json');
}

function loadSessionToken() {
  try {
    const raw = fs.readFileSync(getSessionFilePath(), 'utf8');
    const data = JSON.parse(raw);
    sessionToken = data?.token || null;
  } catch (_) {
    sessionToken = null;
  }
}

function saveSessionToken() {
  try {
    const filePath = getSessionFilePath();
    if (sessionToken) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ token: sessionToken }), 'utf8');
    } else if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    log.error('saveSessionToken error:', err);
  }
}

function sendToWindow(win, channel, payload) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function sendToSplash(channel, payload) {
  sendToWindow(splashWindow, channel, payload);
}

function sendToMain(channel, payload) {
  sendToWindow(mainWindow, channel, payload);
}

function sendToSettings(channel, payload) {
  sendToWindow(settingsWindow, channel, payload);
}

function sendToUpdate(channel, payload) {
  sendToWindow(updateWindow, channel, payload);
}

function setSplashStatus(text, activeStage, doneStages = [], pill = null) {
  sendToSplash('splash-status', {
    text,
    activeStage,
    doneStages,
    pill: pill || text
  });
}

function sendSharedWindowState(win) {
  if (!win || win.isDestroyed()) return;

  win.webContents.send('app-version', app.getVersion());
  win.webContents.send('server-host', CONFIG.SERVER_HOST);
  win.webContents.send('window-maximized', win.isMaximized());
}

function sendAppInfo() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    sendSharedWindowState(mainWindow);
  }

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    sendSharedWindowState(settingsWindow);
  }

  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('app-version', app.getVersion());
  }

  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('app-version', app.getVersion());
  }
}

function attachWindowStateForwarders(win) {
  if (!win) return;

  win.on('maximize', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window-maximized', true);
    }
  });

  win.on('unmaximize', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window-maximized', false);
    }
  });
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 980,
    minHeight: 680,
    resizable: true,
    minimizable: true,
    maximizable: true,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    parent: mainWindow || undefined,
    modal: false,
    backgroundColor: '#101736',
    icon: APP_ICON,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
	  preload: path.join(__dirname, 'preload.js')
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'app', 'splash.html'));

  splashWindow.webContents.on('did-finish-load', () => {
    splashWindow.webContents.send('app-version', app.getVersion());
    setSplashStatus('Подготовка интерфейса...', 'stage-ui', [], 'Инициализация');
  });

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.focus();
    return updateWindow;
  }

  updateWindow = new BrowserWindow({
    width: 540,
    height: 430,
    minWidth: 540,
    minHeight: 430,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    parent: mainWindow || undefined,
    modal: false,
    backgroundColor: '#0b0f1f',
    icon: APP_ICON,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  updateWindow.loadFile(path.join(__dirname, 'app', 'update.html'));

  updateWindow.webContents.on('did-finish-load', () => {
    updateWindow.webContents.send('app-version', app.getVersion());
  });

  updateWindow.once('ready-to-show', () => {
    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.show();
    }
  });

  updateWindow.on('closed', () => {
    updateWindow = null;
  });

  return updateWindow;
}

function showUpdateProgress(payload) {
  createUpdateWindow();
  sendToUpdate('update-status', payload);
}

function fadeInMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.show();

  let opacity = 0;
  const fadeIn = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      clearInterval(fadeIn);
      return;
    }

    opacity += 0.08;

    if (opacity >= 1) {
      opacity = 1;
      clearInterval(fadeIn);
    }

    mainWindow.setOpacity(opacity);
  }, 16);
}

function finishSplashAndShowMain() {
  sendToSplash('fade-out-splash');

  setTimeout(() => {
    fadeInMainWindow();

    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }
    }, 200);
  }, 430);
}

function startAppAfterUpdateCheck() {
  if (startupUpdateTimeout) {
    clearTimeout(startupUpdateTimeout);
    startupUpdateTimeout = null;
  }

  if (hasFinishedStartupCheck) return;
  hasFinishedStartupCheck = true;

  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }

  finishSplashAndShowMain();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#101736',
    autoHideMenuBar: true,
    show: false,
    opacity: 0,
    icon: APP_ICON,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  attachWindowStateForwarders(mainWindow);

  setSplashStatus(
    'Запуск интерфейса...',
    'stage-server',
    ['stage-ui'],
    'Подготовка приложения'
  );

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    sendAppInfo();

    setSplashStatus(
      'Почти готово...',
      'stage-ready',
      ['stage-ui', 'stage-server'],
      'Финальная загрузка'
    );

    setTimeout(() => {
      finishSplashAndShowMain();
    }, 650);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openChat(username) {
	currentUsername = username;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.loadFile(path.join(__dirname, 'app', 'chat.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('set-username', username);
    sendAppInfo();
  });
}

function openLogin() {
	currentUsername = null;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    sendAppInfo();
  });
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 980,
    minHeight: 680,
    resizable: true,
    minimizable: true,
    maximizable: true,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    parent: mainWindow || undefined,
    modal: false,
    backgroundColor: '#101736',
    icon: APP_ICON,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  attachWindowStateForwarders(settingsWindow);

  settingsWindow.loadFile(path.join(__dirname, 'app', 'settings.html'));

  settingsWindow.webContents.on('did-finish-load', () => {
    sendAppInfo();
    settingsWindow.webContents.send('settings-current-username', currentUsername);
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function setupAutoUpdates() {
  if (isCheckingUpdates) return;
  isCheckingUpdates = true;
  
  if (startupUpdateTimeout) {
  clearTimeout(startupUpdateTimeout);
}

startupUpdateTimeout = setTimeout(() => {
  log.warn('Update check timeout. Starting app without waiting further.');

  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.close();
  }

  setSplashStatus(
    'Проверка обновлений заняла слишком много времени. Открываем приложение...',
    'stage-ready',
    ['stage-ui', 'stage-server'],
    'Таймаут обновления'
  );

  startAppAfterUpdateCheck();
}, 12000);

  log.initialize();
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'info';
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.removeAllListeners();

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');

    setSplashStatus(
      'Проверка обновлений...',
      'stage-server',
      ['stage-ui'],
      'Проверка обновлений'
    );

    showUpdateProgress({
      percent: 0,
      phase: 'Проверка',
      text: 'Проверяем наличие новой версии...'
    });
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info?.version);

    showUpdateProgress({
      percent: 0,
      phase: 'Загрузка',
      text: `Найдена новая версия ${info?.version || ''}. Начинаем загрузку...`
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info?.version);

    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.close();
    }

    setSplashStatus(
      'Обновлений нет. Открываем приложение...',
      'stage-ready',
      ['stage-ui', 'stage-server'],
      'Готово'
    );

    startAppAfterUpdateCheck();
  });

  autoUpdater.on('download-progress', (progress) => {
    log.info(`Downloaded ${progress.percent}%`);

    showUpdateProgress({
      percent: progress.percent || 0,
      phase: 'Загрузка',
      text: `Скачиваем обновление... ${Math.round(progress.percent || 0)}%`,
      bytesPerSecond: progress.bytesPerSecond || 0
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info?.version);

    showUpdateProgress({
      percent: 100,
      phase: 'Установка',
      text: 'Обновление скачано. Перезапускаем приложение...'
    });

    isQuittingForUpdate = true;

    setTimeout(() => {
      autoUpdater.quitAndInstall(true, true);
    }, 1200);
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto update error:', err);
    log.error('Auto update error:', err);

    showUpdateProgress({
      percent: 0,
      phase: 'Ошибка',
      text: 'Не удалось проверить обновление. Открываем приложение...'
    });

    setSplashStatus(
      'Не удалось проверить обновления. Открываем приложение...',
      'stage-ready',
      ['stage-ui', 'stage-server'],
      'Ошибка обновления'
    );

    setTimeout(() => {
      if (updateWindow && !updateWindow.isDestroyed()) {
        updateWindow.close();
      }
      startAppAfterUpdateCheck();
    }, 1200);
  });

  autoUpdater.checkForUpdates();
}

// ---------- WINDOW CONTROLS ----------

ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.on('window-toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.on('set-session', (_event, token) => {
  sessionToken = token || null;
  saveSessionToken();
});

ipcMain.handle('get-session', () => {
  return sessionToken;
});

ipcMain.on('clear-session', () => {
  sessionToken = null;
  saveSessionToken();
});

ipcMain.handle('get-current-username', () => {
  return currentUsername;
});

ipcMain.handle('get-server-config', () => {
  return getNetworkState();
});

// ---------- APP EVENTS ----------

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

ipcMain.on('apply-settings', (_event, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('apply-settings', payload);
  }
});

// ---------- LIFECYCLE ----------

app.whenReady().then(async () => {
  loadSessionToken();

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback({});
  }, { useSystemPicker: true });

  createSplashWindow();

  try {
    await initializeNetwork({
      onStatus: (text) => {
        setSplashStatus(text, 'stage-server', ['stage-ui'], 'Radmin VPN');
      }
    });
  } catch (err) {
    log.error('initializeNetwork error:', err);
    setSplashStatus(
      'Не удалось настроить сеть. Проверь Radmin VPN.',
      'stage-server',
      ['stage-ui'],
      'Ошибка сети'
    );
  }

  setupAutoUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      hasFinishedStartupCheck = false;
      isCheckingUpdates = false;
      createSplashWindow();
      setupAutoUpdates();
    }
  });
});

app.on('window-all-closed', () => {
  if (isQuittingForUpdate) {
    return;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});