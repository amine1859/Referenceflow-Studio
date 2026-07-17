const { app, BrowserWindow, Menu, screen, ipcMain, nativeImage, dialog, Tray, globalShortcut, clipboard, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let settings = {
  showInTaskbar: false,
  launchMinimized: false,
  alwaysOnTop: true,
  startOnBoot: false,
  dataDirectory: ''
};
try {
  if (fs.existsSync(settingsPath)) {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
  }
} catch (e) {
  console.error("Failed to read settings.json:", e);
}

const isBackgroundLaunch = process.argv.includes('--background');
const START_ON_BOOT_ARGS = ['--background'];

const normalizeLoginPath = (value) => {
  try {
    return path.resolve(String(value || '')).replace(/\\/g, '/').toLowerCase();
  } catch {
    return String(value || '').replace(/\\/g, '/').toLowerCase();
  }
};

function getStartOnBootRegistration() {
  if (!app.isPackaged) {
    return {
      success: false,
      supported: false,
      enabled: false,
      requiresElevation: false,
      message: 'Start on Boot is available in packaged Windows builds.'
    };
  }

  try {
    const registration = app.getLoginItemSettings({
      path: process.execPath,
      args: START_ON_BOOT_ARGS
    });
    const expectedPath = normalizeLoginPath(process.execPath);
    const matchingLaunchItem = Array.isArray(registration.launchItems)
      ? registration.launchItems.find(item => normalizeLoginPath(item.path) === expectedPath)
      : null;
    // Electron's exact `openAtLogin` match can briefly be false on Windows
    // when its registry command-line arguments are normalized differently.
    // These two signals report whether this executable is actually enabled in
    // Windows Startup Apps, which is the behavior the user asked for.
    const enabled = Boolean(
      registration.openAtLogin
      || registration.executableWillLaunchAtLogin
      || matchingLaunchItem?.enabled
    );
    return {
      success: true,
      supported: true,
      enabled,
      requiresElevation: false,
      executablePath: process.execPath,
      message: enabled
        ? 'RefFlowStudio will start when you sign in to Windows.'
        : 'Start on Boot is off. It uses your Windows account and does not require elevation.'
    };
  } catch (error) {
    return {
      success: false,
      supported: true,
      enabled: Boolean(settings.startOnBoot),
      requiresElevation: false,
      message: `Could not read the Windows startup registration: ${error.message}`
    };
  }
}

async function updateStartOnBootRegistration(enabled) {
  if (!app.isPackaged) return getStartOnBootRegistration();

  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      enabled: Boolean(enabled),
      name: app.getName(),
      path: process.execPath,
      args: START_ON_BOOT_ARGS
    });
    let result = getStartOnBootRegistration();
    // Windows can update StartupApproved shortly after the Run entry. Give it
    // a short confirmation window instead of showing a false failure instantly.
    for (const delay of [100, 250, 500]) {
      if (result.success && result.enabled === Boolean(enabled)) break;
      await new Promise(resolve => setTimeout(resolve, delay));
      result = getStartOnBootRegistration();
    }
    const verified = result.success && result.enabled === Boolean(enabled);
    settings.startOnBoot = result.enabled;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    return {
      ...result,
      success: verified,
      message: verified
        ? (result.enabled
            ? 'Start on Boot enabled for your Windows account. No extra administrator prompt is needed.'
            : 'Start on Boot disabled.')
        : `Windows still reports Start on Boot as ${result.enabled ? 'enabled' : 'disabled'}. Try the switch again or check Settings > Apps > Startup.`
    };
  } catch (error) {
    console.error('Failed to update login item settings:', error);
    return {
      success: false,
      supported: true,
      enabled: getStartOnBootRegistration().enabled,
      requiresElevation: false,
      message: `Could not update Start on Boot: ${error.message}`
    };
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// This overlay must keep its renderer responsive while occluded. Do not impose
// a small V8 heap limit: image/PDF data URLs can legitimately exceed it and a
// renderer OOM leaves behind an invisible native window.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let mainWindow;
let tray = null;
let isQuitting = false;
let interactiveRegions = [];
let forceWindowInteractive = true;
let interactionPollTimer = null;
let lastIgnoreMouseEvents = null;
let lastRendererHeartbeat = 0;
let rendererRecoveryTimer = null;
let rendererRecoveryAttempts = 0;
let updateCheckInFlight = null;
let updateInitialTimer = null;
let updateInterval = null;
let autoUpdatesConfigured = false;
let promptedUpdateVersion = null;
let updateStatus = {
  phase: app.isPackaged ? 'idle' : 'development',
  currentVersion: app.getVersion(),
  availableVersion: null,
  percent: null,
  bytesPerSecond: null,
  transferred: null,
  total: null,
  checkedAt: null,
  message: app.isPackaged
    ? 'Updates are checked automatically.'
    : 'Update checks are available in the installed app.'
};

const FALLBACK_ICON_PNG = "iVBORw0KGgoAAAANSUhEUgAAABAAAAEACAIAAADTED8xAAAAK0lEQVR4nGNk+M+ABzAyMsrBQMDAwKAQZGRkkGJgYGBgUGRgYBAAAI0sA6oGWmQqAAAAAElFTkSuQmCC";

function emitUpdateStatus(patch = {}) {
  updateStatus = {
    ...updateStatus,
    ...patch,
    currentVersion: app.getVersion()
  };

  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('update-status', updateStatus);
  }
  return { ...updateStatus };
}

function normalizeUpdateError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown update error');
  return message.replace(/\s+/g, ' ').trim();
}

function installDownloadedUpdate() {
  if (updateStatus.phase !== 'ready') return false;

  emitUpdateStatus({
    phase: 'installing',
    message: `Restarting to install v${updateStatus.availableVersion || 'latest'}...`
  });
  isQuitting = true;
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      isQuitting = false;
      emitUpdateStatus({
        phase: 'error',
        message: `Could not start the installer: ${normalizeUpdateError(error)}`
      });
    }
  });
  return true;
}

async function promptToInstallUpdate(info) {
  const version = info?.version || updateStatus.availableVersion || 'latest';
  if (promptedUpdateVersion === version) return;
  promptedUpdateVersion = version;

  const options = {
    type: 'info',
    title: 'RefFlow Studio update ready',
    message: `RefFlow Studio v${version} is ready to install.`,
    detail: 'Restart now to finish the update, or choose Later to keep working. The update will also install when you next quit the app.',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  };

  try {
    const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null;
    const result = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (result.response === 0) installDownloadedUpdate();
  } catch (error) {
    console.error('Failed to show the update prompt:', error);
  }
}

async function checkForAppUpdates(manual = false) {
  if (!app.isPackaged) {
    return emitUpdateStatus({
      phase: 'development',
      message: 'Update checks are available in the installed app.'
    });
  }

  if (['downloading', 'ready', 'installing'].includes(updateStatus.phase)) {
    return { ...updateStatus };
  }
  if (updateCheckInFlight) {
    await updateCheckInFlight;
    return { ...updateStatus };
  }

  emitUpdateStatus({
    phase: 'checking',
    message: manual ? 'Checking GitHub Releases for an update...' : 'Checking for updates...'
  });

  updateCheckInFlight = autoUpdater.checkForUpdates();
  try {
    await updateCheckInFlight;
  } catch (error) {
    if (updateStatus.phase !== 'error') {
      emitUpdateStatus({
        phase: 'error',
        checkedAt: new Date().toISOString(),
        message: `Update check failed: ${normalizeUpdateError(error)}`
      });
    }
  } finally {
    updateCheckInFlight = null;
  }
  return { ...updateStatus };
}

function configureAutoUpdates() {
  if (autoUpdatesConfigured) return;
  autoUpdatesConfigured = true;

  if (!app.isPackaged) {
    emitUpdateStatus({
      phase: 'development',
      message: 'Update checks are available in the installed app.'
    });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;
  // SignPath signs the final installer after packaging. Full downloads avoid
  // using a pre-signing blockmap whose bytes no longer match the signed file.
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => {
    emitUpdateStatus({ phase: 'checking', message: 'Checking for updates...' });
  });
  autoUpdater.on('update-available', info => {
    emitUpdateStatus({
      phase: 'available',
      availableVersion: info.version,
      percent: 0,
      message: `Downloading RefFlow Studio v${info.version}...`
    });
  });
  autoUpdater.on('download-progress', progress => {
    emitUpdateStatus({
      phase: 'downloading',
      percent: Number.isFinite(progress.percent) ? progress.percent : 0,
      bytesPerSecond: Number.isFinite(progress.bytesPerSecond) ? progress.bytesPerSecond : null,
      transferred: Number.isFinite(progress.transferred) ? progress.transferred : null,
      total: Number.isFinite(progress.total) ? progress.total : null,
      message: `Downloading update... ${Math.round(progress.percent || 0)}%`
    });
  });
  autoUpdater.on('update-not-available', () => {
    emitUpdateStatus({
      phase: 'up-to-date',
      availableVersion: null,
      percent: null,
      checkedAt: new Date().toISOString(),
      message: `RefFlow Studio v${app.getVersion()} is up to date.`
    });
  });
  autoUpdater.on('update-downloaded', info => {
    emitUpdateStatus({
      phase: 'ready',
      availableVersion: info.version,
      percent: 100,
      checkedAt: new Date().toISOString(),
      message: `RefFlow Studio v${info.version} is ready to install.`
    });
    void promptToInstallUpdate(info);
  });
  autoUpdater.on('error', error => {
    emitUpdateStatus({
      phase: 'error',
      checkedAt: new Date().toISOString(),
      message: `Update failed: ${normalizeUpdateError(error)}`
    });
  });

  updateInitialTimer = setTimeout(() => {
    updateInitialTimer = null;
    void checkForAppUpdates(false);
  }, isBackgroundLaunch ? 30000 : 12000);
  updateInterval = setInterval(() => void checkForAppUpdates(false), 6 * 60 * 60 * 1000);
}

function getAppIcon() {
  const candidatePaths = [
    path.join(__dirname, 'assets', 'referenceflow.png'),
    path.join(__dirname, 'assets', 'referenceflow.ico'),
    path.join(__dirname, 'assets', 'favicon.ico'),
    path.join(__dirname, 'assets', 'icon.ico'),
    path.join(process.resourcesPath || '', 'assets', 'referenceflow.png'),
    path.join(process.resourcesPath || '', 'assets', 'referenceflow.ico'),
    path.join(__dirname, 'public', 'favicon.ico'),
    path.join(process.resourcesPath || '', 'favicon.ico')
  ];

  for (const iconPath of candidatePaths) {
    try {
      if (iconPath && fs.existsSync(iconPath)) {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) return icon;
      }
    } catch (e) {
      console.warn("Icon candidate failed:", iconPath, e);
    }
  }

  return nativeImage.createFromBuffer(Buffer.from(FALLBACK_ICON_PNG, 'base64'));
}

function getBundledInstallDataDirectory() {
  const candidateFiles = [
    path.join(path.dirname(app.getPath('exe')), 'referenceflow-data-dir.txt'),
    path.join(process.resourcesPath || '', 'referenceflow-data-dir.txt')
  ];

  for (const filePath of candidateFiles) {
    try {
      if (filePath && fs.existsSync(filePath)) {
        const value = fs.readFileSync(filePath, 'utf8').trim();
        if (value) return value;
      }
    } catch (e) {
      console.warn("Failed to read installer data directory:", filePath, e);
    }
  }

  return '';
}

function getDefaultDataDirectory() {
  return settings.dataDirectory || getBundledInstallDataDirectory() || path.join(app.getPath('documents'), 'ReferenceFlow');
}

function getVirtualDisplayBounds() {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return { x: 0, y: 0, right: 1280, bottom: 720 };
  const first = displays[0].bounds;
  return displays.slice(1).reduce((bounds, display) => {
    const right = display.bounds.x + display.bounds.width;
    const bottom = display.bounds.y + display.bounds.height;
    return {
      x: Math.min(bounds.x, display.bounds.x),
      y: Math.min(bounds.y, display.bounds.y),
      right: Math.max(bounds.right, right),
      bottom: Math.max(bounds.bottom, bottom)
    };
  }, { x: first.x, y: first.y, right: first.x + first.width, bottom: first.y + first.height });
}

function getDisplayLayout() {
  const virtual = getVirtualDisplayBounds();
  const primaryDisplay = screen.getPrimaryDisplay();
  const primary = primaryDisplay.bounds;
  const toLocalBounds = bounds => ({
    x: bounds.x - virtual.x,
    y: bounds.y - virtual.y,
    width: bounds.width,
    height: bounds.height
  });
  return {
    virtual: {
      x: virtual.x,
      y: virtual.y,
      width: virtual.right - virtual.x,
      height: virtual.bottom - virtual.y
    },
    primary: toLocalBounds(primary),
    displays: screen.getAllDisplays().map(display => ({
      id: String(display.id),
      label: display.label || `Display ${display.id}`,
      bounds: toLocalBounds(display.bounds),
      workArea: toLocalBounds(display.workArea),
      scaleFactor: display.scaleFactor,
      isPrimary: display.id === primaryDisplay.id
    }))
  };
}

function applyIgnoreMouseEvents(ignore) {
  if (!mainWindow || mainWindow.isDestroyed() || lastIgnoreMouseEvents === ignore) return;
  lastIgnoreMouseEvents = ignore;
  try {
    mainWindow.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
  } catch (error) {
    console.error('Failed to update native click-through state:', error);
  }
}

function updateClickThroughFromCursor() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
  if (!lastRendererHeartbeat || Date.now() - lastRendererHeartbeat > 4000) {
    // Fail open: if the renderer is gone or stalled, never leave an invisible
    // full-desktop window consuming the user's clicks.
    applyIgnoreMouseEvents(true);
    return;
  }
  if (forceWindowInteractive) {
    applyIgnoreMouseEvents(false);
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const windowBounds = mainWindow.getBounds();
  const x = cursor.x - windowBounds.x;
  const y = cursor.y - windowBounds.y;
  const isInteractive = interactiveRegions.some(rect =>
    x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
  );
  applyIgnoreMouseEvents(!isInteractive);
}

function startInteractionPolling() {
  if (interactionPollTimer) clearInterval(interactionPollTimer);
  interactionPollTimer = setInterval(updateClickThroughFromCursor, 32);
}

ipcMain.on('update-interactive-regions', (_event, payload = {}) => {
  const regions = Array.isArray(payload.regions) ? payload.regions : [];
  interactiveRegions = regions.slice(0, 1000).filter(rect =>
    rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0
  );
  lastRendererHeartbeat = Date.now();
  forceWindowInteractive = !!payload.forceInteractive;
  updateClickThroughFromCursor();
});

ipcMain.on('renderer-heartbeat', event => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  lastRendererHeartbeat = Date.now();
});

function recoverRenderer(reason) {
  console.error(`Renderer recovery requested: ${reason}`);
  interactiveRegions = [];
  forceWindowInteractive = false;
  lastRendererHeartbeat = 0;
  lastIgnoreMouseEvents = null;
  applyIgnoreMouseEvents(true);
  if (isQuitting || !mainWindow || mainWindow.isDestroyed() || rendererRecoveryTimer) return;
  if (rendererRecoveryAttempts >= 3) return;
  rendererRecoveryAttempts += 1;
  rendererRecoveryTimer = setTimeout(() => {
    rendererRecoveryTimer = null;
    if (!mainWindow || mainWindow.isDestroyed() || isQuitting) return;
    mainWindow.webContents.reloadIgnoringCache();
  }, 500);
}

// Helper to convert lowercase modifiers to Electron Accelerator format
function toElectronAccelerator(shortcutString) {
  if (!shortcutString) return '';
  const keyAliases = {
    comma: ',',
    space: 'Space',
    escape: 'Escape',
    esc: 'Escape',
    arrowup: 'Up',
    arrowdown: 'Down',
    arrowleft: 'Left',
    arrowright: 'Right',
    pageup: 'PageUp',
    pagedown: 'PageDown'
  };
  return shortcutString
    .split('+')
    .map(part => {
      const p = part.trim().toLowerCase();
      if (p === 'ctrl') return 'CommandOrControl';
      if (p === 'alt') return 'Alt';
      if (p === 'shift') return 'Shift';
      if (p === 'meta') return 'Command';
      if (keyAliases[p]) return keyAliases[p];
      return p.toUpperCase();
    })
    .join('+');
}

// 1. Trace every BrowserWindow created and log properties
app.on('browser-window-created', (event, win) => {
  const bounds = win.getBounds();
  console.log(`[TRACE] BrowserWindow Created | ID: ${win.id}`);
  console.log(`  - Bounds: x=${bounds.x}, y=${bounds.y}, width=${bounds.width}, height=${bounds.height}`);
  console.log(`  - Transparent: true`);
  console.log(`  - AlwaysOnTop: ${win.isAlwaysOnTop()}`);
  console.log(`  - IgnoreMouseEvents: false`);

  // Log state toggles dynamically
  const originalSetIgnoreMouseEvents = win.setIgnoreMouseEvents.bind(win);
  win.setIgnoreMouseEvents = (ignore, options) => {
    console.log(`[TRACE] Window ID=${win.id} setIgnoreMouseEvents(${ignore}, ${options ? JSON.stringify(options) : 'undefined'})`);
    originalSetIgnoreMouseEvents(ignore, options);
  };
});

// 2. Dynamic event handler to let mouse events pass through transparent areas
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  console.log(`[IPC_TRACE] 'set-ignore-mouse-events' received in electron-main.cjs | ignore=${ignore}, options=${options ? JSON.stringify(options) : 'undefined'}`);
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    console.log(`[IPC_TRACE] Target BrowserWindow located: ID=${win.id}, Title="${win.getTitle() || 'Untitled'}"`);
    try {
      if (win === mainWindow) {
        lastIgnoreMouseEvents = null;
        applyIgnoreMouseEvents(!!ignore);
      } else {
        win.setIgnoreMouseEvents(ignore, options);
      }
      console.log(`[IPC_TRACE] Successfully called setIgnoreMouseEvents(${ignore})`);
    } catch (err) {
      console.error(`[IPC_TRACE] Error calling win.setIgnoreMouseEvents:`, err);
    }
  } else {
    console.error(`[IPC_TRACE] Failed to locate BrowserWindow for sender of 'set-ignore-mouse-events'!`);
  }
});

ipcMain.on('start-drag', (event, filePath, iconPath) => {
  console.log(`[IPC] Starting native drag for file: ${filePath}`);
  if (filePath && fs.existsSync(filePath)) {
    let icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    if (icon.isEmpty() && filePath) {
      icon = nativeImage.createFromPath(filePath);
    }
    // Resize icon if too big for drag preview
    const size = icon.getSize();
    if (size.width > 256 || size.height > 256) {
      icon = icon.resize({ width: 128 });
    }
    event.sender.startDrag({
      file: filePath,
      icon: icon
    });
  }
});

function getReferenceExtension(source, declaredType) {
  if (declaredType === 'docx' || /^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/i.test(source || '')) return '.docx';
  if (declaredType === 'xlsx' || /^data:application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/i.test(source || '')) return '.xlsx';
  if (declaredType === 'pdf' || /^data:application\/pdf/i.test(source || '')) return '.pdf';
  const mimeMatch = String(source || '').match(/^data:image\/([a-z0-9.+-]+)[;,]/i);
  if (mimeMatch) {
    const subtype = mimeMatch[1].toLowerCase();
    if (subtype === 'jpeg') return '.jpg';
    if (['png', 'jpg', 'webp', 'gif', 'bmp', 'tiff'].includes(subtype)) return `.${subtype}`;
  }
  try {
    const cleanSource = String(source || '').split(/[?#]/)[0];
    const ext = path.extname(cleanSource).toLowerCase();
    if (/^\.(png|jpe?g|webp|gif|bmp|tiff?|pdf|docx|xlsx)$/.test(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  } catch {
    // Fall through to the safest image extension.
  }
  return '.png';
}

function materializeReferenceForDrag(payload = {}) {
  if (payload.cachedPath && fs.existsSync(payload.cachedPath)) return payload.cachedPath;
  const source = String(payload.source || '');
  if (!source) return '';
  if (fs.existsSync(source)) return source;

  if (source.startsWith('file://')) {
    try {
      const filePath = decodeURIComponent(source.replace(/^file:\/\//i, '').replace(/^\//, ''));
      if (fs.existsSync(filePath)) return filePath;
    } catch {
      return '';
    }
  }

  if (!source.startsWith('data:')) return '';
  const commaIndex = source.indexOf(',');
  if (commaIndex === -1) return '';
  const metadata = source.slice(0, commaIndex);
  const data = source.slice(commaIndex + 1);
  const safeId = String(payload.id || 'reference').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80) || 'reference';
  const dragDir = path.join(app.getPath('temp'), 'ReferenceFlow', 'Drag');
  const filePath = path.join(dragDir, `${safeId}${getReferenceExtension(source, payload.type)}`);
  fs.mkdirSync(dragDir, { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(data, /;base64/i.test(metadata) ? 'base64' : 'utf8'));
  return filePath;
}

ipcMain.on('start-reference-drag', (event, payload) => {
  try {
    const filePath = materializeReferenceForDrag(payload);
    if (!filePath) {
      event.sender.send('reference-drag-error', payload?.id, 'The reference is still being prepared. Try dragging it again.');
      return;
    }
    let icon = nativeImage.createFromPath(filePath);
    if (icon.isEmpty()) icon = getAppIcon();
    if (!icon.isEmpty()) {
      const size = icon.getSize();
      if (size.width > 160 || size.height > 160) icon = icon.resize({ width: 96 });
    }
    event.sender.startDrag({ file: filePath, icon });
  } catch (error) {
    console.error('Native reference drag failed:', error);
    event.sender.send('reference-drag-error', payload?.id, error.message);
  }
});

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function writeFilePathToClipboardWithPowerShell(filePath) {
  if (process.platform !== 'win32' || !filePath || !fs.existsSync(filePath)) return Promise.resolve(false);
  const command = `Set-Clipboard -LiteralPath '${escapePowerShellSingleQuoted(filePath)}'`;
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64');

  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], { windowsHide: true }, error => {
      if (error) {
        console.warn("PowerShell file clipboard fallback failed:", error);
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

async function writeFilePathToClipboard(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const wroteNativeFileList = await writeFilePathToClipboardWithPowerShell(filePath);
  if (wroteNativeFileList) return true;

  const pathBuffer = Buffer.from(filePath + '\0\0', 'utf16le');
  const dropEffectBuffer = Buffer.alloc(4);
  dropEffectBuffer.writeUInt32LE(1, 0);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(20, 0);
  header.writeInt32LE(0, 4);
  header.writeInt32LE(0, 8);
  header.writeUInt32LE(0, 12);
  header.writeUInt32LE(1, 16);
  const dropFilesBuffer = Buffer.concat([header, pathBuffer]);

  clipboard.clear();
  clipboard.writeBuffer('CF_HDROP', dropFilesBuffer);
  clipboard.writeBuffer('FileNameW', pathBuffer);
  clipboard.writeBuffer('Preferred DropEffect', dropEffectBuffer);
  return true;
}

function writeImageToClipboard(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return false;
  clipboard.clear();
  clipboard.writeImage(image);
  return true;
}

ipcMain.handle('copy-image-to-clipboard', async (event, filePath) => {
  return writeImageToClipboard(filePath);
});

ipcMain.handle('copy-file-to-clipboard', async (event, filePath) => {
  return await writeFilePathToClipboard(filePath);
});

ipcMain.handle('copy-reference-to-clipboard', async (event, filePath) => {
  return await writeFilePathToClipboard(filePath);
});

ipcMain.handle('reveal-in-folder', async (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return false;
  shell.showItemInFolder(filePath);
  return true;
});

app.on('before-quit', () => {
  try {
    const os = require('os');
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir);
    for (const f of files) {
      if (f.startsWith('refflow_export_')) {
        fs.unlinkSync(path.join(tmpDir, f));
      }
    }
  } catch (e) {
    console.error("Cleanup error:", e);
  }
});

// 3. Close the app completely
ipcMain.on('close-app', () => {
  quitApplication();
});

ipcMain.on('set-skip-taskbar', (event, skip) => {
  const show = !skip;
  if (mainWindow) {
    mainWindow.setSkipTaskbar(skip);
  }
  try {
    settings.showInTaskbar = show;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error("Failed to write settings.json:", e);
  }
});

ipcMain.on('set-always-on-top', (event, enabled) => {
  settings.alwaysOnTop = !!enabled;
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver', 1);
  }
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error("Failed to write settings.json:", e);
  }
});

ipcMain.handle('get-start-on-boot-status', async () => getStartOnBootRegistration());

ipcMain.handle('set-start-on-boot', async (_event, enabled) => {
  return updateStartOnBootRegistration(Boolean(enabled));
});

ipcMain.on('set-launch-minimized', (event, enabled) => {
  settings.launchMinimized = !!enabled;
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error("Failed to write settings.json:", e);
  }
});

ipcMain.on('show-main-window', () => {
  if (!mainWindow) return;
  forceWindowInteractive = true;
  applyIgnoreMouseEvents(false);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('tray-action', 'show-pill');
});

ipcMain.handle('get-launch-context', async () => ({
  isBackgroundLaunch,
  shouldRevealPill: !isBackgroundLaunch
}));

ipcMain.handle('get-update-status', async () => ({ ...updateStatus }));

ipcMain.handle('check-for-updates', async () => {
  return await checkForAppUpdates(true);
});

ipcMain.handle('install-update', async () => installDownloadedUpdate());

ipcMain.handle('open-external-url', async (_event, targetUrl) => {
  if (typeof targetUrl !== 'string') return false;

  try {
    const parsedUrl = new URL(targetUrl);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') return false;

    await shell.openExternal(parsedUrl.toString());
    return true;
  } catch (error) {
    console.error('Failed to open external URL:', error);
    return false;
  }
});

ipcMain.on('register-global-shortcuts', (event, shortcuts) => {
  globalShortcut.unregisterAll();
  if (!shortcuts) return;

  Object.keys(shortcuts).forEach(key => {
    const rawVal = shortcuts[key];
    if (!rawVal) return;

    const accelerator = toElectronAccelerator(rawVal);
    if (!accelerator) return;

    try {
      const registered = globalShortcut.register(accelerator, () => {
        console.log(`[Global Shortcut Triggered] Key: ${key}, Accelerator: ${accelerator}`);
        if (mainWindow) {
          mainWindow.webContents.send('global-shortcut-trigger', key);
        }
      });
      if (!registered) {
        console.warn(`[Global Shortcut] Failed to register: ${accelerator}`);
      }
    } catch (e) {
      console.error(`[Global Shortcut] Error registering ${accelerator}:`, e);
    }
  });
});

function quitApplication() {
  isQuitting = true;
  if (tray) {
    try {
      tray.destroy();
    } catch (e) {
      console.error(e);
    }
    tray = null;
  }
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    try {
      win.removeAllListeners('close');
      win.close();
    } catch (e) {
      console.error(e);
    }
  });
  app.quit();
}

ipcMain.handle('show-save-dialog', async (event, options) => {
  console.log(`[IPC] Received show-save-dialog with options:`, JSON.stringify(options));
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    console.error(`[IPC] No BrowserWindow found for show-save-dialog emitter`);
    return { canceled: true };
  }
  try {
    const result = await dialog.showSaveDialog(win, options);
    console.log(`[IPC] show-save-dialog result:`, JSON.stringify(result));
    return result;
  } catch (err) {
    console.error(`[IPC] Error invoking dialog.showSaveDialog:`, err);
    return { canceled: true, error: err.message };
  }
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { canceled: true };
  try {
    return await dialog.showOpenDialog(win, options);
  } catch (err) {
    console.error(`[IPC] Error invoking dialog.showOpenDialog:`, err);
    return { canceled: true, error: err.message };
  }
});

ipcMain.handle('get-default-data-directory', async () => {
  return getDefaultDataDirectory();
});

ipcMain.handle('get-display-layout', async () => {
  return getDisplayLayout();
});

ipcMain.handle('set-default-data-directory', async (event, directoryPath) => {
  if (!directoryPath || typeof directoryPath !== 'string') return settings.dataDirectory || '';
  settings.dataDirectory = directoryPath;
  try {
    fs.mkdirSync(directoryPath, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error("Failed to save default data directory:", e);
  }
  return settings.dataDirectory;
});

function createWindow() {
  const applyVirtualDisplayBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = getVirtualDisplayBounds();
    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.right - bounds.x,
      height: bounds.bottom - bounds.y
    }, false);
    mainWindow.webContents.send('display-layout-changed', getDisplayLayout());
  };

  const virtualBounds = getVirtualDisplayBounds();

  mainWindow = new BrowserWindow({
    x: virtualBounds.x,
    y: virtualBounds.y,
    width: virtualBounds.right - virtualBounds.x,
    height: virtualBounds.bottom - virtualBounds.y,
    frame: false,
    transparent: true,
    fullscreenable: true,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: !settings.showInTaskbar,
    title: "RefFlow Studio - Native Reference Board",
    icon: getAppIcon(),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false // Enables loading local resource images into the canvas
    },
    backgroundColor: '#00000000',
    show: false
  });

  interactiveRegions = [];
  forceWindowInteractive = true;
  lastIgnoreMouseEvents = null;
  lastRendererHeartbeat = Date.now();

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    recoverRenderer(`process gone (${details.reason}, exit code ${details.exitCode})`);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) recoverRenderer(`load failed (${errorCode}: ${errorDescription})`);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    lastRendererHeartbeat = Date.now();
    setTimeout(() => {
      if (lastRendererHeartbeat && Date.now() - lastRendererHeartbeat < 3000) rendererRecoveryAttempts = 0;
    }, 15000);
  });
  mainWindow.on('unresponsive', () => recoverRenderer('window became unresponsive'));

  applyVirtualDisplayBounds();
  mainWindow.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver', 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  screen.on('display-added', applyVirtualDisplayBounds);
  screen.on('display-removed', applyVirtualDisplayBounds);
  screen.on('display-metrics-changed', applyVirtualDisplayBounds);

  // Links and browser-search providers belong in the user's normal browser,
  // never in a second transparent RefFlow window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') {
        void shell.openExternal(parsedUrl.toString());
      }
    } catch (error) {
      console.warn('Blocked invalid child-window URL:', error);
    }
    return { action: 'deny' };
  });

  // Hide top menu bar for clean PureRef-like artistic focus flow
  Menu.setApplicationMenu(null);

  // In development, load local Vite server; in production, load local dist index.html
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    applyVirtualDisplayBounds();
    if (isBackgroundLaunch && settings.launchMinimized) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('tray-action', 'show-pill');
    }
    startInteractionPolling();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', function () {
    screen.removeListener('display-added', applyVirtualDisplayBounds);
    screen.removeListener('display-removed', applyVirtualDisplayBounds);
    screen.removeListener('display-metrics-changed', applyVirtualDisplayBounds);
    if (interactionPollTimer) clearInterval(interactionPollTimer);
    interactionPollTimer = null;
    if (rendererRecoveryTimer) clearTimeout(rendererRecoveryTimer);
    rendererRecoveryTimer = null;
    mainWindow = null;
    if (isQuitting) app.quit();
  });
}

function createTray() {
  let trayIcon = getAppIcon();
  if (trayIcon.isEmpty()) {
    trayIcon = nativeImage.createFromBuffer(Buffer.from(FALLBACK_ICON_PNG, 'base64'));
  } else {
    trayIcon = trayIcon.resize({ width: 32, height: 32 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('ReferenceFlow');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show ReferenceFlow',
      click: () => {
        if (mainWindow) {
          forceWindowInteractive = true;
          applyIgnoreMouseEvents(false);
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('tray-action', 'show-pill');
        }
      }
    },
    {
      label: 'Hide ReferenceFlow',
      click: () => {
        if (mainWindow) {
          mainWindow.hide();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Show / Hide Pill',
      click: () => {
        if (mainWindow) {
          forceWindowInteractive = true;
          applyIgnoreMouseEvents(false);
          mainWindow.show();
          mainWindow.webContents.send('tray-action', 'toggle-pill');
        }
      }
    },
    {
      label: 'Project Manager',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray-action', 'toggle-manager');
        }
      }
    },
    {
      label: 'Quick Search',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray-action', 'toggle-search');
        }
      }
    },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray-action', 'toggle-settings');
        }
      }
    },
    {
      label: 'Check for Updates',
      click: () => {
        if (mainWindow) {
          forceWindowInteractive = true;
          applyIgnoreMouseEvents(false);
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('tray-action', 'show-settings');
        }
        void checkForAppUpdates(true);
      }
    },
    { type: 'separator' },
    {
      label: 'Show All References',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray-action', 'show-all-references');
        }
      }
    },
    {
      label: 'Hide All References',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray-action', 'hide-all-references');
        }
      }
    },
    {
      label: 'Lock All References',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray-action', 'lock-all-references');
        }
      }
    },
    {
      label: 'Unlock All References',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray-action', 'unlock-all-references');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit ReferenceFlow',
      click: () => {
        quitApplication();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      forceWindowInteractive = true;
      applyIgnoreMouseEvents(false);
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('tray-action', 'show-pill');
    }
  });
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    forceWindowInteractive = true;
    applyIgnoreMouseEvents(false);
    mainWindow.show();
    mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('tray-action', 'show-pill');
  });

  app.on('ready', () => {
    if (settings.startOnBoot) {
      void updateStartOnBootRegistration(true)
        .then(startupResult => {
          if (!startupResult.success) {
            console.error(`Failed to restore Start on Boot: ${startupResult.message}`);
          }
        })
        .catch(error => console.error('Failed to restore Start on Boot:', error));
    }
    createWindow();
    createTray();
    configureAutoUpdates();
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (interactionPollTimer) clearInterval(interactionPollTimer);
  if (updateInitialTimer) clearTimeout(updateInitialTimer);
  if (updateInterval) clearInterval(updateInterval);
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  } else {
    forceWindowInteractive = true;
    applyIgnoreMouseEvents(false);
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('tray-action', 'show-pill');
  }
});
