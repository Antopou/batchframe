const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const dialog = electron.dialog;
const shell = electron.shell;
const fs = require('fs').promises;
const path = require('path');
const isDev = require('electron-is-dev');

// Disable GPU acceleration to fix GPU process errors
app.disableHardwareAcceleration();

let mainWindow;

function createWindow() {
  // Ensure preload path is absolute for both dev and production
  const preloadPath = isDev 
    ? path.resolve(__dirname, 'preload.js')
    : path.join(__dirname, 'preload.js');
  
  console.log('Preload path:', preloadPath);
  console.log('Is dev:', isDev);
  
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
    },
    icon: path.join(__dirname, '../public/icon.svg'),
  });

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../build/index.html')}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // CLI arg → initial folder
  // dev:  ["electron.exe", ".", "<folder>"]
  // prod: ["app.exe", "<folder>"]
  const cliArg = process.argv.slice(isDev ? 2 : 1).find(a => a && !a.startsWith('-') && a !== '.');
  if (cliArg) {
    mainWindow.webContents.once('did-finish-load', () => {
      try {
        mainWindow.webContents.send('initial-folder', path.resolve(cliArg));
      } catch (e) { console.error('initial-folder send failed:', e); }
    });
  }

  mainWindow.on('closed', () => {
    stopFolderWatcher();
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('get-images', async (event, folderPath) => {
  try {
    const files = await fs.readdir(folderPath);
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    const imageFiles = files.filter(file => imageExtensions.includes(path.extname(file).toLowerCase()));
    return await Promise.all(imageFiles.map(async name => {
      const filePath = path.join(folderPath, name);
      const stat = await fs.stat(filePath);
      return { name, path: filePath, size: stat.size, mtime: stat.mtimeMs };
    }));
  } catch (error) {
    console.error(error);
    return [];
  }
});

ipcMain.handle('get-subfolders', async (event, folderPath) => {
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const subfolders = entries
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, path: path.join(folderPath, e.name) }));
    const parentPath = path.dirname(folderPath);
    const hasParent = parentPath !== folderPath;
    return { subfolders, parentPath: hasParent ? parentPath : null };
  } catch {
    return { subfolders: [], parentPath: null };
  }
});

ipcMain.handle('delete-images', async (event, filePaths) => {
  const total = filePaths.length;
  const chunkSize = 20; // Smaller chunks for more frequent progress updates
  let success = true;
  let lastError = null;

  try {
    const { default: trash } = await import('trash');
    
    for (let i = 0; i < total; i += chunkSize) {
      const chunk = filePaths.slice(i, i + chunkSize);
      try {
        await trash(chunk);
      } catch (e) {
        // Fallback for individual chunk if trash fails
        for (const file of chunk) {
          try { await fs.unlink(file); } catch (err) { lastError = err; }
        }
      }
      
      const current = Math.min(i + chunkSize, total);
      event.sender.send('delete-progress', { current, total });
    }
    
    return { success: true };
  } catch (error) {
    console.error('Delete error:', error);
    // Ultimate fallback: simple loop
    try {
      for (let i = 0; i < total; i++) {
        await fs.unlink(filePaths[i]);
        event.sender.send('delete-progress', { current: i + 1, total });
      }
      return { success: true };
    } catch (fallbackError) {
      return { success: false, error: fallbackError.message };
    }
  }
});

ipcMain.handle('get-image-data', async (event, imagePath) => {
  try {
    const data = await fs.readFile(imagePath);
    return Buffer.from(data).toString('base64');
  } catch (error) {
    console.error(error);
    return null;
  }
});

ipcMain.handle('rename-images', async (event, renames) => {
  try {
    for (const { oldPath, newName } of renames) {
      const newPath = path.join(path.dirname(oldPath), newName);
      await fs.rename(oldPath, newPath);
    }
    return { success: true };
  } catch (error) {
    console.error('Rename error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-in-app', async (event, { filePaths, appPath }) => {
  try {
    const { spawn } = require('child_process');
    spawn(appPath, filePaths, { detached: true, stdio: 'ignore' }).unref();
    return { success: true };
  } catch (error) {
    console.error('Open in app error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('find-photoshop', async () => {
  const years = ['2026', '2025', '2024', '2023', '2022', '2021'];
  for (const yr of years) {
    const p = `C:\\Program Files\\Adobe\\Adobe Photoshop ${yr}\\Photoshop.exe`;
    try { await fs.access(p); return p; } catch {}
  }
  return null;
});

ipcMain.handle('select-file', async (event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: options.filters || [],
    title: options.title || 'Select File',
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('move-images', async (event, { filePaths, destFolder }) => {
  const results = { moved: [], failed: [] };
  const exists = (p) => fs.access(p).then(() => true).catch(() => false);

  for (let i = 0; i < filePaths.length; i++) {
    const src = filePaths[i];
    let dest = path.join(destFolder, path.basename(src));

    if (await exists(dest)) {
      const ext = path.extname(dest);
      const base = path.basename(dest, ext);
      let n = 1;
      while (await exists(path.join(destFolder, `${base} (${n})${ext}`))) n++;
      dest = path.join(destFolder, `${base} (${n})${ext}`);
    }

    try {
      await fs.rename(src, dest);
      results.moved.push(src);
    } catch (err) {
      if (err.code === 'EXDEV') {
        try {
          await fs.copyFile(src, dest);
          await fs.unlink(src);
          results.moved.push(src);
        } catch (e2) {
          results.failed.push({ path: src, error: e2.message });
        }
      } else {
        results.failed.push({ path: src, error: err.message });
      }
    }
    event.sender.send('move-progress', { current: i + 1, total: filePaths.length });
  }
  return { success: results.failed.length === 0, ...results };
});

// ── Folder watcher (auto-reload on external changes, e.g. Photoshop save) ──
let folderWatcher = null;
let watchDebounce = null;
const pendingChanges = new Set();

function stopFolderWatcher() {
  if (folderWatcher) {
    try { folderWatcher.close(); } catch {}
    folderWatcher = null;
  }
  if (watchDebounce) { clearTimeout(watchDebounce); watchDebounce = null; }
  pendingChanges.clear();
}

ipcMain.handle('start-folder-watch', async (event, folderPath) => {
  stopFolderWatcher();
  if (!folderPath) return { success: false };
  try {
    const fsSync = require('fs');
    folderWatcher = fsSync.watch(folderPath, { persistent: false }, async (eventType, filename) => {
      if (!filename) return;
      const ext = path.extname(filename).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) return;
      pendingChanges.add(filename);
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(async () => {
        const changes = [];
        for (const name of pendingChanges) {
          const filePath = path.join(folderPath, name);
          try {
            const stat = await fs.stat(filePath);
            changes.push({ name, path: filePath, size: stat.size, mtime: stat.mtimeMs, kind: 'change' });
          } catch {
            changes.push({ name, path: filePath, kind: 'remove' });
          }
        }
        pendingChanges.clear();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('folder-change', { folderPath, changes });
        }
      }, 250);
    });
    return { success: true };
  } catch (err) {
    console.error('start-folder-watch failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stop-folder-watch', async () => {
  stopFolderWatcher();
  return { success: true };
});

ipcMain.handle('open-path', async (event, filePath) => {
  const err = await shell.openPath(filePath);
  return { success: !err, error: err || null };
});

ipcMain.handle('show-in-folder', (event, filePath) => {
  shell.showItemInFolder(filePath);
  return { success: true };
});

ipcMain.handle('get-image-metadata', async (event, filePath) => {
  try {
    const buf = await fs.readFile(filePath);
    const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
      if (buf[i] !== PNG_SIG[i]) return { success: false, error: 'Not a PNG' };
    }
    const metadata = {};
    let offset = 8;
    while (offset + 12 <= buf.length) {
      const length = buf.readUInt32BE(offset);
      const type   = buf.toString('ascii', offset + 4, offset + 8);
      const data   = buf.slice(offset + 8, offset + 8 + length);
      offset += 12 + length;
      if (type === 'IEND') break;
      if (type === 'tEXt') {
        const n = data.indexOf(0);
        if (n !== -1) metadata[data.toString('latin1', 0, n)] = data.toString('latin1', n + 1);
      } else if (type === 'iTXt') {
        const n = data.indexOf(0);
        if (n === -1) continue;
        const key = data.toString('latin1', 0, n);
        if (data[n + 1] === 0) {
          let pos = n + 3;
          const l1 = data.indexOf(0, pos); if (l1 === -1) continue; pos = l1 + 1;
          const l2 = data.indexOf(0, pos); if (l2 === -1) continue; pos = l2 + 1;
          metadata[key] = data.toString('utf8', pos);
        }
      }
    }
    return { success: true, metadata, isEmpty: Object.keys(metadata).length === 0 };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
