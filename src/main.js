const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const ipcMain = electron.ipcMain;
const dialog = electron.dialog;
const shell = electron.shell;
const fs = require('fs').promises;
const path = require('path');
const isDev = require('electron-is-dev');
const { spawn } = require('child_process');

// Files shipped alongside the bundle rather than inside it. In dev they sit at
// the repo root; once packaged they land in resources/ (spawn cannot execute a
// script from inside app.asar, so the Python helpers must stay unpacked).
function resourcePath(name) {
  return isDev
    ? path.join(__dirname, '..', name)
    : path.join(process.resourcesPath, name);
}

const driveOauth = require('./drive/oauthClient');
const driveApi = require('./drive/driveApi');
const driveManifest = require('./drive/manifest');
const driveSync = require('./drive/syncEngine');
const driveFs = require('./drive/driveFs');
const lanServer = require('./server/lanServer');
const { extForMime } = require('./utils/cropFormat');

// Auth for live `drive://` paths. Kept as a helper so every guard reads the
// same and sign-in problems surface as one consistent error.
function liveAuth() {
  return driveOauth.getAuthClient();
}

// Disable GPU acceleration to work around GPU process errors — Windows only.
// On macOS this forces all rendering onto the CPU, which keeps the machine
// hot/busy even when idle, so we keep hardware acceleration on there.
if (process.platform === 'win32') {
  app.disableHardwareAcceleration();
}

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
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 11 },
    // On Windows a hidden title bar leaves no caption buttons at all, so draw
    // the native minimise/maximise/close set over the header instead. Colours
    // track --bg-surface / --text-primary so the overlay blends into it, and
    // the height matches .App-header. macOS ignores this and keeps its traffic
    // lights, positioned above.
    ...(process.platform === 'win32' && {
      titleBarOverlay: {
        color: '#11141b',
        symbolColor: '#f0f3f9',
        height: 36,
      },
    }),
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

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.control && input.meta && input.key.toLowerCase() === 'f') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });

  const menuTemplate = [
    ...(process.platform === 'darwin' ? [{
      label: electron.app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    }
  ];
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(menuTemplate));

  if (isDev) {
    // mainWindow.webContents.openDevTools();
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
      
      setTimeout(async () => {
        try {
          const fs = require('fs');
          const p = require('path');
          
          mainWindow.webContents.sendInputEvent({type: 'keyDown', keyCode: 'v'});
          await new Promise(r => setTimeout(r, 1000));
          const listImg = await mainWindow.webContents.capturePage();
          fs.writeFileSync(p.join(__dirname, '../public/screenshot_list.png'), listImg.toPNG());
          

          mainWindow.webContents.sendInputEvent({type: 'keyDown', keyCode: 'a'});
          await new Promise(r => setTimeout(r, 1000));
          const aiImg = await mainWindow.webContents.capturePage();
          fs.writeFileSync(p.join(__dirname, '../public/screenshot_ai.png'), aiImg.toPNG());
          
          console.log('Captures successful');
          app.quit();
        } catch (e) {
          console.error(e);
          app.quit();
        }
      }, 5000);
    });
  }

  mainWindow.on('will-enter-full-screen', () => {
    mainWindow.webContents.send('fullscreen-change', true);
  });

  mainWindow.on('will-leave-full-screen', () => {
    mainWindow.webContents.send('fullscreen-change', false);
  });

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

// ── Image dimension reader (PNG/JPEG/WebP header parsing) ──────────
function readImageDimensions(buf, ext) {
  try {
    if (ext === 'png') {
      if (buf.length < 24) return null;
      const sig = [137,80,78,71,13,10,26,10];
      for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (ext === 'jpg' || ext === 'jpeg') {
      if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
      let i = 2;
      while (i + 8 < buf.length) {
        if (buf[i] !== 0xFF) break;
        const marker = buf[i+1];
        const len = buf.readUInt16BE(i+2);
        if (marker >= 0xC0 && marker <= 0xC3)
          return { h: buf.readUInt16BE(i+5), w: buf.readUInt16BE(i+7) };
        i += 2 + len;
      }
    }
    if (ext === 'webp') {
      if (buf.toString('ascii',0,4) !== 'RIFF' || buf.toString('ascii',8,12) !== 'WEBP') return null;
      const fmt = buf.toString('ascii',12,16);
      if (fmt === 'VP8 ' && buf.length >= 30)
        return { w: buf.readUInt16LE(26) & 0x3FFF, h: buf.readUInt16LE(28) & 0x3FFF };
      if (fmt === 'VP8L' && buf.length >= 25) {
        const bits = buf.readUInt32LE(21);
        return { w: (bits & 0x3FFF) + 1, h: ((bits >> 14) & 0x3FFF) + 1 };
      }
    }
  } catch {}
  return null;
}

// ── Drive manifest hooks ──────────────────────────────────────────
// After a local mutation (crop / delete / rename / move), if the affected
// file lives inside a Drive-backed cache dir, update its .sync-manifest.json.
// All helpers are best-effort — they never throw into the caller.

async function markManifestModified(absPath) {
  if (driveFs.isDrivePath(absPath)) return; // live mode has no manifest
  try {
    const found = await driveManifest.findForAbsPath(absPath);
    if (!found) return;
    const stat = await driveManifest.statLocal(found.cacheRoot, found.relPath);
    driveManifest.markModified(found.manifest, found.relPath, stat);
    await driveManifest.write(found.cacheRoot, found.manifest);
    notifyManifestChanged(found.cacheRoot);
  } catch (err) { console.error('markManifestModified failed:', err); }
}

async function markManifestDeleted(absPath) {
  if (driveFs.isDrivePath(absPath)) return; // live mode has no manifest
  try {
    const found = await driveManifest.findForAbsPath(absPath);
    if (!found) return;
    driveManifest.markDeleted(found.manifest, found.relPath);
    await driveManifest.write(found.cacheRoot, found.manifest);
    notifyManifestChanged(found.cacheRoot);
  } catch (err) { console.error('markManifestDeleted failed:', err); }
}

async function markManifestRenamed(oldAbsPath, newAbsPath) {
  if (driveFs.isDrivePath(oldAbsPath)) return; // live mode has no manifest
  try {
    const found = await driveManifest.findForAbsPath(oldAbsPath);
    if (!found) return;
    const newRel = driveManifest.relFromAbs(found.cacheRoot, newAbsPath);
    const stat = await driveManifest.statLocal(found.cacheRoot, newRel);
    driveManifest.markRenamed(found.manifest, found.relPath, newRel, stat);
    await driveManifest.write(found.cacheRoot, found.manifest);
    notifyManifestChanged(found.cacheRoot);
  } catch (err) { console.error('markManifestRenamed failed:', err); }
}

let manifestChangeDebounce = null;
function notifyManifestChanged(cacheRoot) {
  if (manifestChangeDebounce) clearTimeout(manifestChangeDebounce);
  manifestChangeDebounce = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('drive-manifest-changed', { cacheRoot });
    }
  }, 100);
}

// IPC Handlers
ipcMain.handle('select-folder', async (event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: defaultPath || undefined
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('get-images', async (event, folderPath) => {
  if (driveFs.isDrivePath(folderPath)) {
    return driveFs.getImages(await liveAuth(), folderPath);
  }
  try {
    const files = await fs.readdir(folderPath);
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.txt', '.zip', '.torrent', '.safetensors'];
    const imageFiles = files.filter(file => imageExtensions.includes(path.extname(file).toLowerCase()));
    return await Promise.all(imageFiles.map(async name => {
      const filePath = path.join(folderPath, name);
      const ext = path.extname(name).toLowerCase().slice(1);
      const stat = await fs.stat(filePath);
      const headerBuf = Buffer.alloc(512);
      let dims = null;
      try {
        const fd = await fs.open(filePath, 'r');
        const { bytesRead } = await fd.read(headerBuf, 0, 512, 0);
        await fd.close();
        dims = readImageDimensions(headerBuf.slice(0, bytesRead), ext);
      } catch {}
      return { name, path: filePath, size: stat.size, mtime: stat.mtimeMs, width: dims?.w ?? null, height: dims?.h ?? null };
    }));
  } catch (error) {
    console.error(error);
    return [];
  }
});

ipcMain.handle('get-folder-preview', async (event, { folderPath, limit = 4 }) => {
  if (driveFs.isDrivePath(folderPath)) {
    return driveFs.getFolderPreview(await liveAuth(), folderPath, limit);
  }
  try {
    const files = await fs.readdir(folderPath);
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.txt', '.zip', '.torrent', '.safetensors'];
    const imageFiles = files
      .filter(f => imageExtensions.includes(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .slice(0, limit);
    return await Promise.all(imageFiles.map(async (name) => {
      const abs = path.join(folderPath, name);
      const ext = path.extname(name).toLowerCase().slice(1);
      const mime = ext === 'png' ? 'image/png'
        : ext === 'gif' ? 'image/gif'
        : ext === 'webp' ? 'image/webp'
        : ext === 'bmp' ? 'image/bmp'
        : ext === 'svg' ? 'image/svg+xml'
        : 'image/jpeg';
      try {
        const data = await fs.readFile(abs);
        return { name, path: abs, dataUrl: `data:${mime};base64,${data.toString('base64')}` };
      } catch {
        return { name, path: abs, dataUrl: null };
      }
    }));
  } catch {
    return [];
  }
});

ipcMain.handle('get-subfolders', async (event, folderPath) => {
  if (!folderPath) {
    folderPath = app.getPath('home');
  }
  if (driveFs.isDrivePath(folderPath)) {
    return driveFs.getSubfolders(await liveAuth(), folderPath);
  }
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const subfolders = await Promise.all(
      entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(async e => {
          const folderAbsPath = path.join(folderPath, e.name);
          let mtime = 0;
          try {
            const stat = await fs.stat(folderAbsPath);
            mtime = stat.mtimeMs;
          } catch {}
          return { name: e.name, path: folderAbsPath, mtime };
        })
    );
    const parentPath = path.dirname(folderPath);
    const homeDir = app.getPath('home');
    const isAtHome = folderPath === homeDir;
    const hasParent = parentPath !== folderPath && !isAtHome;
    return { subfolders, parentPath: hasParent ? parentPath : null, resolvedPath: folderPath };
  } catch {
    return { subfolders: [], parentPath: null, resolvedPath: folderPath };
  }
});

ipcMain.handle('create-folder', async (event, { parentPath, name }) => {
  if (driveFs.isDrivePath(parentPath)) {
    return driveFs.createFolder(await liveAuth(), { parentPath, name });
  }
  try {
    const newPath = path.join(parentPath, name);
    await fs.mkdir(newPath, { recursive: true });
    return { success: true, path: newPath };
  } catch (error) {
    console.error('Create folder error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-folder', async (event, { oldPath, newName }) => {
  if (driveFs.isDrivePath(oldPath)) {
    return driveFs.renameFolder(await liveAuth(), { oldPath, newName });
  }
  try {
    const newPath = path.join(path.dirname(oldPath), newName);
    await fs.rename(oldPath, newPath);
    return { success: true, path: newPath };
  } catch (error) {
    console.error('Rename folder error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-folder', async (event, folderPath) => {
  if (driveFs.isDrivePath(folderPath)) {
    return driveFs.deleteFolder(await liveAuth(), folderPath);
  }
  try {
    const { default: trash } = await import('trash');
    await trash(folderPath);
    return { success: true };
  } catch (error) {
    console.error('Delete folder error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-images', async (event, filePaths) => {
  if (filePaths.length && driveFs.isDrivePath(filePaths[0])) {
    return driveFs.deleteImages(await liveAuth(), filePaths,
      (p) => event.sender.send('delete-progress', p));
  }
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

      for (const p of chunk) await markManifestDeleted(p);

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
        await markManifestDeleted(filePaths[i]);
        event.sender.send('delete-progress', { current: i + 1, total });
      }
      return { success: true };
    } catch (fallbackError) {
      return { success: false, error: fallbackError.message };
    }
  }
});
ipcMain.handle('soft-delete-images', async (event, filePaths) => {
  if (filePaths.length && driveFs.isDrivePath(filePaths[0])) {
    return driveFs.deleteImages(await liveAuth(), filePaths,
      (p) => event.sender.send('delete-progress', p));
  }
  const total = filePaths.length;
  try {
    const trashInfos = [];
    for (let i = 0; i < total; i++) {
      const originalPath = filePaths[i];
      const folderPath = path.dirname(originalPath);
      const trashFolder = path.join(folderPath, '.batchframe_trash');
      await fs.mkdir(trashFolder, { recursive: true });
      
      const fileName = path.basename(originalPath);
      let finalTrashPath = path.join(trashFolder, fileName);
      
      const exists = await fs.access(finalTrashPath).then(() => true).catch(() => false);
      if (exists) {
        finalTrashPath = path.join(trashFolder, `${Date.now()}_${fileName}`);
      }
      
      await fs.rename(originalPath, finalTrashPath);
      await markManifestDeleted(originalPath);
      
      trashInfos.push({ originalPath, trashPath: finalTrashPath });
      event.sender.send('delete-progress', { current: i + 1, total });
    }
    return { success: true, trashInfos };
  } catch (error) {
    console.error('Soft delete error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('restore-images', async (event, trashInfos) => {
  try {
    for (const info of trashInfos) {
      if (driveFs.isDrivePath(info.originalPath)) continue;
      await fs.rename(info.trashPath, info.originalPath);
      await markManifestModified(info.originalPath);
    }
    return { success: true };
  } catch (error) {
    console.error('Restore error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('empty-trash', async (event, folderPath) => {
  if (!folderPath || driveFs.isDrivePath(folderPath)) return { success: true };
  try {
    const trashFolder = path.join(folderPath, '.batchframe_trash');
    const exists = await fs.access(trashFolder).then(() => true).catch(() => false);
    if (exists) {
      await fs.rm(trashFolder, { recursive: true, force: true });
    }
    return { success: true };
  } catch (error) {
    console.error('Empty trash error:', error);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('get-image-data', async (event, imagePath, variant) => {
  if (driveFs.isDrivePath(imagePath)) {
    return driveFs.getImageData(await liveAuth(), imagePath, variant || 'full');
  }
  try {
    const ext = path.extname(imagePath).toLowerCase();
    if (['.safetensors', '.zip', '.torrent'].includes(ext)) {
      return null;
    }
    const data = await fs.readFile(imagePath);
    return Buffer.from(data).toString('base64');
  } catch (error) {
    console.error(error);
    return null;
  }
});

ipcMain.handle('save-cropped-image', async (event, { originalPath, dataUrl }) => {
  if (driveFs.isDrivePath(originalPath)) {
    return driveFs.saveCroppedImage(await liveAuth(), { originalPath, dataUrl });
  }
  try {
    const match = /^data:image\/(\w+);base64,(.+)$/s.exec(dataUrl || '');
    if (!match) return { success: false, error: 'Invalid image data' };
    const buffer = Buffer.from(match[2], 'base64');

    const dir = path.dirname(originalPath);
    const origExt = path.extname(originalPath);
    // Name the file for what the renderer actually encoded, which is the
    // source's own format whenever a canvas can produce it.
    const ext = extForMime(match[1], origExt);
    const base = path.basename(originalPath, origExt);

    // Overwrite the original in place. When the produced format can't keep the
    // original extension (e.g. a .webp source is written as .png), save the
    // correctly-extensioned file and remove the original so no copy is left.
    const outPath = path.join(dir, `${base}${ext}`);
    await fs.writeFile(outPath, buffer);
    if (path.resolve(outPath) !== path.resolve(originalPath)) {
      try { await fs.unlink(originalPath); } catch { /* original already gone */ }
      await markManifestRenamed(originalPath, outPath);
      await markManifestModified(outPath);
    } else {
      await markManifestModified(outPath);
    }
    return { success: true, path: outPath };
  } catch (error) {
    console.error('Save cropped image error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-images', async (event, renames) => {
  if (renames.length && driveFs.isDrivePath(renames[0].oldPath)) {
    return driveFs.renameImages(await liveAuth(), renames);
  }
  try {
    for (const { oldPath, newName } of renames) {
      const newPath = path.join(path.dirname(oldPath), newName);
      await fs.rename(oldPath, newPath);
      await markManifestRenamed(oldPath, newPath);
    }
    return { success: true };
  } catch (error) {
    console.error('Rename error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-in-app', async (event, { filePaths, appPath }) => {
  try {
    if (process.platform === 'darwin') {
      // A macOS app is a .app bundle (a directory), not an executable — launch
      // it with `open -a "<app>" <files…>` so the files open inside it.
      spawn('open', ['-a', appPath, ...filePaths], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn(appPath, filePaths, { detached: true, stdio: 'ignore' }).unref();
    }
    return { success: true };
  } catch (error) {
    console.error('Open in app error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('find-photoshop', async () => {
  const years = ['2026', '2025', '2024', '2023', '2022', '2021'];
  const candidates = process.platform === 'darwin'
    ? years.map(yr => `/Applications/Adobe Photoshop ${yr}/Adobe Photoshop ${yr}.app`)
    : years.map(yr => `C:\\Program Files\\Adobe\\Adobe Photoshop ${yr}\\Photoshop.exe`);
  for (const p of candidates) {
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
  if (driveFs.isDrivePath(destFolder) || (filePaths.length && driveFs.isDrivePath(filePaths[0]))) {
    if (!driveFs.isDrivePath(destFolder) || !filePaths.every(driveFs.isDrivePath)) {
      return { success: false, moved: [], failed: filePaths.map((p) => ({ path: p, error: 'Cannot move between Drive and local storage in live mode' })) };
    }
    return driveFs.moveImages(await liveAuth(), { filePaths, destFolder },
      (p) => event.sender.send('move-progress', p));
  }
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
      await markManifestRenamed(src, dest);
    } catch (err) {
      if (err.code === 'EXDEV') {
        try {
          await fs.cp(src, dest, { recursive: true });
          await fs.rm(src, { recursive: true, force: true });
          results.moved.push(src);
          await markManifestRenamed(src, dest);
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

ipcMain.handle('copy-images', async (event, { filePaths, destFolder }) => {
  if (driveFs.isDrivePath(destFolder) || (filePaths.length && driveFs.isDrivePath(filePaths[0]))) {
    if (!driveFs.isDrivePath(destFolder) || !filePaths.every(driveFs.isDrivePath)) {
      return { success: false, copied: [], failed: filePaths.map((p) => ({ src: p, error: 'Cannot copy between Drive and local storage in live mode' })) };
    }
    return driveFs.copyImages(await liveAuth(), { filePaths, destFolder },
      (p) => event.sender.send('copy-progress', p));
  }
  const results = { success: true, copied: [], failed: [] };
  const exists = (p) => fs.access(p).then(() => true).catch(() => false);
  for (let i = 0; i < filePaths.length; i++) {
    const src = filePaths[i];
    const name = path.basename(src);
    let dest = path.join(destFolder, name);
    if (await exists(dest)) {
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      let n = 1;
      while (await exists(path.join(destFolder, `${base} (${n})${ext}`))) n++;
      dest = path.join(destFolder, `${base} (${n})${ext}`);
    }
    try {
      await fs.cp(src, dest, { recursive: true });
      results.copied.push(dest);
    } catch (err) {
      results.failed.push({ src, error: err.message });
    }
    event.sender.send('copy-progress', { current: i + 1, total: filePaths.length });
  }
  if (results.failed.length > 0) results.success = false;
  return results;
});

ipcMain.handle('export-paths', async (event, { filePaths }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export selected paths',
    defaultPath: 'selected_images.txt',
    filters: [{ name: 'Text files', extensions: ['txt'] }],
  });
  if (result.canceled || !result.filePath) return { success: false, canceled: true };
  await fs.writeFile(result.filePath, filePaths.join('\n'), 'utf8');
  return { success: true, filePath: result.filePath };
});

// ── Folder watcher (auto-reload on external changes, e.g. Photoshop save) ──
let folderWatcher = null;
let watchDebounce = null;
let driveWatchStop = null;
const pendingChanges = new Set();

function stopFolderWatcher() {
  if (folderWatcher) {
    try { folderWatcher.close(); } catch {}
    folderWatcher = null;
  }
  if (driveWatchStop) {
    try { driveWatchStop(); } catch {}
    driveWatchStop = null;
  }
  if (watchDebounce) { clearTimeout(watchDebounce); watchDebounce = null; }
  pendingChanges.clear();
}

ipcMain.handle('start-folder-watch', async (event, folderPath) => {
  stopFolderWatcher();
  if (!folderPath) return { success: false };
  // Live Drive folders can't use fs.watch — poll the listing and emit the
  // same folder-change payloads, so web-UI edits appear in the grid.
  if (driveFs.isDrivePath(folderPath)) {
    try {
      const auth = await liveAuth();
      driveWatchStop = driveFs.watchFolder(auth, folderPath, (changes) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('folder-change', { folderPath, changes });
        }
      });
      return { success: true };
    } catch (err) {
      console.error('drive watch failed:', err);
      return { success: false, error: err.message };
    }
  }
  try {
    const fsSync = require('fs');
    if (!fsSync.existsSync(folderPath)) {
      fsSync.mkdirSync(folderPath, { recursive: true });
    }
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

// For live Drive paths, "open" and "reveal" both mean the Drive web UI.
async function openInDriveWeb(filePath) {
  try {
    const auth = await liveAuth();
    const meta = await driveApi.getFileMetadata(auth, driveFs.driveId(filePath));
    if (meta.webViewLink) {
      await shell.openExternal(meta.webViewLink);
      return { success: true };
    }
    return { success: false, error: 'No web link available' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

ipcMain.handle('open-path', async (event, filePath) => {
  if (driveFs.isDrivePath(filePath)) return openInDriveWeb(filePath);
  const err = await shell.openPath(filePath);
  return { success: !err, error: err || null };
});

ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('show-in-folder', async (event, filePath) => {
  if (driveFs.isDrivePath(filePath)) return openInDriveWeb(filePath);
  shell.showItemInFolder(filePath);
  return { success: true };
});

const REFS_BASE  = path.join(__dirname, '..', 'references');
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

ipcMain.handle('path-exists', async (_, p) => {
  if (driveFs.isDrivePath(p)) {
    return driveFs.pathExists(await liveAuth(), p);
  }
  try { await fs.access(p); return true; } catch { return false; }
});

ipcMain.handle('get-character-profiles', async () => {
  await fs.mkdir(REFS_BASE, { recursive: true });
  try {
    const entries  = await fs.readdir(REFS_BASE, { withFileTypes: true });
    const profiles = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const charPath = path.join(REFS_BASE, e.name);
      const files    = await fs.readdir(charPath);
      const count    = files.filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase())).length;
      profiles.push({ name: e.name, count, folder: charPath });
    }
    return profiles;
  } catch { return []; }
});

ipcMain.handle('create-character', async (_, character) => {
  await fs.mkdir(path.join(REFS_BASE, character), { recursive: true });
  return { success: true };
});

ipcMain.handle('open-refs-folder', async (_, character) => {
  const target = character ? path.join(REFS_BASE, character) : REFS_BASE;
  await fs.mkdir(target, { recursive: true });
  shell.openPath(target);
  return { success: true };
});

ipcMain.handle('add-to-refs', async (_, { imagePaths, character }) => {
  const charFolder = path.join(REFS_BASE, character);
  await fs.mkdir(charFolder, { recursive: true });
  const paths = Array.isArray(imagePaths) ? imagePaths : [imagePaths];
  await Promise.all(paths.map(p => fs.copyFile(p, path.join(charFolder, path.basename(p)))));
  const files = await fs.readdir(charFolder);
  const count = files.filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase())).length;
  return { success: true, count };
});

ipcMain.handle('clear-refs', async (_, character) => {
  const charFolder = path.join(REFS_BASE, character);
  try {
    const files = await fs.readdir(charFolder);
    await Promise.all(
      files
        .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
        .map(f => fs.unlink(path.join(charFolder, f)))
    );
  } catch {}
  return { success: true };
});

ipcMain.handle('scan-character', async (event, { imagePaths, characters, clipGate }) => {
  const pyCmd      = process.platform === 'win32' ? 'python' : 'python3';
  const scriptPath = resourcePath('ai_scan.py');

  return new Promise((resolve, reject) => {
    const py = spawn(pyCmd, [scriptPath]);
    py.stdin.write(JSON.stringify({ imagePaths, characters, clipGate }));
    py.stdin.end();

    let buf = '';
    py.stdout.on('data', (data) => {
      const lines = (buf + data.toString()).split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.status   !== undefined) mainWindow?.webContents.send('scan-progress', { type: 'status',   text: msg.status });
          if (msg.scanning !== undefined) mainWindow?.webContents.send('scan-progress', { type: 'scanning', path: msg.scanning });
          if (msg.done     !== undefined) mainWindow?.webContents.send('scan-progress', { type: 'done',     path: msg.done, score: msg.score, character: msg.character });
          if (msg.scores) resolve(msg.scores);
          if (msg.error)  reject(new Error(msg.error));
        } catch {}
      }
    });

    py.stderr.on('data', d => console.error('[ai_scan]', d.toString()));
    py.on('close', code => { if (code !== 0) reject(new Error(`ai_scan.py exited with code ${code}`)); });
  });
});

ipcMain.handle('detect-faces', async (event, { imagePaths }) => {
  const pyCmd      = process.platform === 'win32' ? 'python' : 'python3';
  const scriptPath = resourcePath('ai_detect.py');

  return new Promise((resolve, reject) => {
    const py = spawn(pyCmd, [scriptPath]);
    py.stdin.write(JSON.stringify({ imagePaths }));
    py.stdin.end();

    let buf = '';
    py.stdout.on('data', (data) => {
      const lines = (buf + data.toString()).split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.status   !== undefined) mainWindow?.webContents.send('detect-progress', { type: 'status',   text: msg.status });
          if (msg.scanning !== undefined) mainWindow?.webContents.send('detect-progress', { type: 'scanning', path: msg.scanning });
          if (msg.done     !== undefined) mainWindow?.webContents.send('detect-progress', { type: 'done',     path: msg.done, box: msg.box });
          if (msg.boxes) resolve(msg.boxes);
          if (msg.error) reject(new Error(msg.error));
        } catch {}
      }
    });

    py.stderr.on('data', d => console.error('[ai_detect]', d.toString()));
    py.on('close', code => { if (code !== 0) reject(new Error(`ai_detect.py exited with code ${code}`)); });
  });
});

// Shared driver for remove_bg.py. `progressChannel` is null for one-off preview
// runs, which must not push events at the batch modal's progress listener.
function runRemoveBg({ jobs, background, quality, progressChannel, onDone }) {
  const pyCmd      = process.platform === 'win32' ? 'python' : 'python3';
  const scriptPath = resourcePath('remove_bg.py');

  return new Promise((resolve, reject) => {
    const py = spawn(pyCmd, [scriptPath]);
    py.stdin.write(JSON.stringify({ jobs, background, quality }));
    py.stdin.end();

    let buf = '';
    py.stdout.on('data', (data) => {
      const lines = (buf + data.toString()).split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (progressChannel) {
            if (msg.status   !== undefined) mainWindow?.webContents.send(progressChannel, { type: 'status',   text: msg.status });
            if (msg.scanning !== undefined) mainWindow?.webContents.send(progressChannel, { type: 'scanning', path: msg.scanning });
            if (msg.done     !== undefined) mainWindow?.webContents.send(progressChannel, { type: 'done',     path: msg.done, ok: msg.ok });
          }
          if (msg.done !== undefined && msg.ok) onDone?.(msg.done);
          if (msg.summary) resolve(msg.summary);
          if (msg.error)   reject(new Error(msg.error));
        } catch {}
      }
    });

    py.stderr.on('data', d => console.error('[remove_bg]', d.toString()));
    py.on('close', code => { if (code !== 0) reject(new Error(`remove_bg.py exited with code ${code}`)); });
  });
}

// One-off cut-out for the preview modal's toggle: renders to a temp file,
// hands back a data URL and leaves the user's folder untouched.
ipcMain.handle('preview-background', async (event, { imagePath, background, quality }) => {
  if (driveFs.isDrivePath(imagePath)) {
    return { success: false, error: 'Background removal is not available for Google Drive folders.' };
  }
  const out = path.join(app.getPath('temp'), `batchframe-cutout-${Date.now()}.png`);
  try {
    await runRemoveBg({
      jobs: [{ in: imagePath, out }],
      background,
      quality,
      progressChannel: null,
    });
    const data = await fs.readFile(out);
    return { success: true, dataUrl: `data:image/png;base64,${Buffer.from(data).toString('base64')}` };
  } catch (error) {
    console.error('Preview background error:', error);
    return { success: false, error: error.message };
  } finally {
    try { await fs.unlink(out); } catch { /* never got written */ }
  }
});

ipcMain.handle('remove-background', async (event, { imagePaths, saveMode, background, quality }) => {
  const overwrite = saveMode === 'overwrite';

  // Python reads and writes the files directly, so Drive-backed paths (which
  // only exist behind driveFs) can't be handled here.
  if (imagePaths.some(p => driveFs.isDrivePath(p))) {
    return { written: 0, failed: 0, error: 'Background removal is not available for Google Drive folders.' };
  }

  // Keep the source's format: a cut-out from a .jpg should come back a .jpg.
  // The one thing that forces a change is transparency — a transparent cut-out
  // needs an alpha channel, which JPEG has no room for. On a white background
  // there is nothing to preserve, so every format is fair game.
  const transparent = background !== 'white';
  const KEEPABLE = new Set(['.png', '.jpg', '.jpeg', '.webp']);
  const HOLDS_ALPHA = new Set(['.png', '.webp']);

  const jobs = imagePaths.map(p => {
    const dir  = path.dirname(p);
    const ext  = path.extname(p);
    const low  = ext.toLowerCase();
    const keep = KEEPABLE.has(low) && (!transparent || HOLDS_ALPHA.has(low));
    const base = path.basename(p, ext);
    return { in: p, out: path.join(dir, `${base}${overwrite ? '' : '_cutout'}${keep ? ext : '.png'}`) };
  });

  // Only files Python reports as actually written get cleaned up after — a
  // pre-existing _cutout.png from an earlier run must not be mistaken for one
  // this run produced.
  const succeeded = new Set();

  const outcomes = await runRemoveBg({
    jobs,
    background,
    quality,
    progressChannel: 'bg-progress',
    onDone: (p) => succeeded.add(p),
  });

  // The renamed/modified bookkeeping mirrors save-cropped-image: in overwrite
  // mode a non-PNG source has been superseded by the .png next to it, so the
  // original file has to go and the manifest has to learn the new name.
  for (const job of jobs) {
    if (!succeeded.has(job.in)) continue;
    if (overwrite && path.resolve(job.in) !== path.resolve(job.out)) {
      try { await fs.unlink(job.in); } catch { /* original already gone */ }
      await markManifestRenamed(job.in, job.out);
    }
    await markManifestModified(job.out);
  }

  return outcomes;
});

// How far either side of an image to look for a frame to borrow pixels from.
// Neighbours are offered nearest-first; the worker stops at the first one that
// is the same shot and has no lettering of its own.
const REF_RADIUS = 3;

function neighboursOf(target, ordered) {
  const at = ordered.indexOf(target);
  if (at < 0) return [];
  const out = [];
  for (let d = 1; d <= REF_RADIUS; d++) {
    if (ordered[at + d]) out.push(ordered[at + d]);
    if (ordered[at - d]) out.push(ordered[at - d]);
  }
  return out;
}

function runRemoveSubs({ jobs, area, fill, progressChannel, onDone }) {
  const pyCmd      = process.platform === 'win32' ? 'python' : 'python3';
  const scriptPath = resourcePath('remove_subs.py');

  return new Promise((resolve, reject) => {
    const py = spawn(pyCmd, [scriptPath]);
    py.stdin.write(JSON.stringify({ jobs, area, fill }));
    py.stdin.end();

    let buf = '';
    py.stdout.on('data', (data) => {
      const lines = (buf + data.toString()).split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (progressChannel) {
            if (msg.status   !== undefined) mainWindow?.webContents.send(progressChannel, { type: 'status',   text: msg.status });
            if (msg.scanning !== undefined) mainWindow?.webContents.send(progressChannel, { type: 'scanning', path: msg.scanning });
            if (msg.done     !== undefined) mainWindow?.webContents.send(progressChannel, { type: 'done',     path: msg.done, ok: msg.ok });
          }
          // Only a file that actually had subtitles was written.
          if (msg.done !== undefined && msg.ok && msg.changed) onDone?.(msg.done);
          if (msg.summary) resolve(msg.summary);
          if (msg.error)   reject(new Error(msg.error));
        } catch {}
      }
    });

    py.stderr.on('data', d => console.error('[remove_subs]', d.toString()));
    py.on('close', code => { if (code !== 0) reject(new Error(`remove_subs.py exited with code ${code}`)); });
  });
}

// Subtitle removal never needs an alpha channel, so the source format always
// survives; only formats a canvas/PIL round trip cannot write become PNG.
const SUBS_KEEPABLE = new Set(['.png', '.jpg', '.jpeg', '.webp']);
function subsOutPath(p, overwrite) {
  const dir  = path.dirname(p);
  const ext  = path.extname(p);
  const base = path.basename(p, ext);
  const keep = SUBS_KEEPABLE.has(ext.toLowerCase());
  return path.join(dir, `${base}${overwrite ? '' : '_nosub'}${keep ? ext : '.png'}`);
}

ipcMain.handle('preview-subtitles', async (event, { imagePath, area, fill, orderedPaths }) => {
  if (driveFs.isDrivePath(imagePath)) {
    return { success: false, error: 'Subtitle removal is not available for Google Drive folders.' };
  }
  const out = path.join(app.getPath('temp'), `batchframe-nosub-${Date.now()}${path.extname(imagePath) || '.png'}`);
  try {
    const refs = neighboursOf(imagePath, Array.isArray(orderedPaths) ? orderedPaths : []);
    const summary = await runRemoveSubs({
      jobs: [{ in: imagePath, out, refs }], area, fill, progressChannel: null,
    });
    if (!summary?.written) {
      return { success: false, error: 'No subtitles found in this image.' };
    }
    const data = await fs.readFile(out);
    const ext = path.extname(out).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : ext === '.webp' ? 'webp' : 'png';
    return { success: true, dataUrl: `data:image/${mime};base64,${Buffer.from(data).toString('base64')}` };
  } catch (error) {
    console.error('Preview subtitles error:', error);
    return { success: false, error: error.message };
  } finally {
    try { await fs.unlink(out); } catch { /* never got written */ }
  }
});

ipcMain.handle('remove-subtitles', async (event, { imagePaths, saveMode, area, fill, orderedPaths }) => {
  const overwrite = saveMode === 'overwrite';

  if (imagePaths.some(p => driveFs.isDrivePath(p))) {
    return { written: 0, skipped: 0, failed: 0, error: 'Subtitle removal is not available for Google Drive folders.' };
  }

  // Neighbours come from the folder's current order, not the selection: the
  // frame that can donate pixels is usually one the user did not select.
  const ordered = Array.isArray(orderedPaths) && orderedPaths.length ? orderedPaths : imagePaths;
  const jobs = imagePaths.map(p => ({
    in: p,
    out: subsOutPath(p, overwrite),
    refs: neighboursOf(p, ordered),
  }));
  const succeeded = new Set();

  const outcomes = await runRemoveSubs({
    jobs,
    area,
    fill,
    progressChannel: 'sub-progress',
    onDone: (p) => succeeded.add(p),
  });

  for (const job of jobs) {
    if (!succeeded.has(job.in)) continue;
    if (overwrite && path.resolve(job.in) !== path.resolve(job.out)) {
      try { await fs.unlink(job.in); } catch { /* original already gone */ }
      await markManifestRenamed(job.in, job.out);
    }
    await markManifestModified(job.out);
  }

  return outcomes;
});

ipcMain.handle('find-duplicates', async (event, { imagePaths }) => {
  const pyCmd      = process.platform === 'win32' ? 'python' : 'python3';
  const scriptPath = resourcePath('ai_duplicates.py');

  return new Promise((resolve, reject) => {
    const py = spawn(pyCmd, [scriptPath]);
    // Send a threshold of 5 (Hamming distance) for strict duplicate matching
    py.stdin.write(JSON.stringify({ imagePaths, threshold: 5 }));
    py.stdin.end();

    let buf = '';
    py.stdout.on('data', (data) => {
      const lines = (buf + data.toString()).split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          // Re-use scan-progress for loading state
          if (msg.status   !== undefined) mainWindow?.webContents.send('scan-progress', { type: 'status',   text: msg.status });
          if (msg.scanning !== undefined) mainWindow?.webContents.send('scan-progress', { type: 'scanning', path: msg.scanning });
          if (msg.clusters) resolve(msg.clusters);
          if (msg.error) reject(new Error(msg.error));
        } catch {}
      }
    });

    py.stderr.on('data', d => console.error('[ai_duplicates]', d.toString()));
    py.on('close', code => { if (code !== 0) reject(new Error(`ai_duplicates.py exited with code ${code}`)); });
  });
});

ipcMain.handle('find-similar', async (event, { referencePath, imagePaths }) => {
  const pyCmd      = process.platform === 'win32' ? 'python' : 'python3';
  const scriptPath = resourcePath('ai_similar.py');

  return new Promise((resolve, reject) => {
    const py = spawn(pyCmd, [scriptPath]);
    py.stdin.write(JSON.stringify({ referencePath, imagePaths }));
    py.stdin.end();

    let buf = '';
    py.stdout.on('data', (data) => {
      const lines = (buf + data.toString()).split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.status   !== undefined) mainWindow?.webContents.send('scan-progress', { type: 'status',   text: msg.status });
          if (msg.scanning !== undefined) mainWindow?.webContents.send('scan-progress', { type: 'scanning', path: msg.scanning });
          if (msg.scores)  resolve(msg.scores);
          if (msg.error)   reject(new Error(msg.error));
        } catch {}
      }
    });

    py.stderr.on('data', d => console.error('[ai_similar]', d.toString()));
    py.on('close', code => { if (code !== 0) reject(new Error(`ai_similar.py exited with code ${code}`)); });
  });
});

ipcMain.handle('find-source-match', async (event, { editedPaths, rawPaths, threshold }) => {
  const pyCmd      = process.platform === 'win32' ? 'python' : 'python3';
  const scriptPath = resourcePath('find_source.py');

  return new Promise((resolve, reject) => {
    const py = spawn(pyCmd, [scriptPath]);
    py.stdin.write(JSON.stringify({ editedPaths, rawPaths, threshold: threshold ?? 8 }));
    py.stdin.end();

    let buf = '';
    py.stdout.on('data', (data) => {
      const lines = (buf + data.toString()).split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.status   !== undefined) mainWindow?.webContents.send('scan-progress', { type: 'status',   text: msg.status });
          if (msg.scanning !== undefined) mainWindow?.webContents.send('scan-progress', { type: 'scanning', path: msg.scanning });
          if (msg.report)  resolve(msg.report);
          if (msg.error)   reject(new Error(msg.error));
        } catch {}
      }
    });

    py.stderr.on('data', d => console.error('[find_source]', d.toString()));
    py.on('close', code => { if (code !== 0) reject(new Error(`find_source.py exited with code ${code}`)); });
  });
});

ipcMain.handle('cluster-images', async (event, { imagePaths, numClusters }) => {
  const pyCmd      = process.platform === 'win32' ? 'python' : 'python3';
  const scriptPath = resourcePath('cluster_images.py');

  return new Promise((resolve, reject) => {
    const py = spawn(pyCmd, [scriptPath]);
    py.stdin.write(JSON.stringify({ imagePaths, numClusters: numClusters ?? null }));
    py.stdin.end();

    let buf = '';
    py.stdout.on('data', (data) => {
      const lines = (buf + data.toString()).split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.status   !== undefined) mainWindow?.webContents.send('scan-progress', { type: 'status',   text: msg.status });
          if (msg.scanning !== undefined) mainWindow?.webContents.send('scan-progress', { type: 'scanning', path: msg.scanning });
          if (msg.result)  resolve(msg.result);
          if (msg.error)   reject(new Error(msg.error));
        } catch {}
      }
    });

    py.stderr.on('data', d => console.error('[cluster_images]', d.toString()));
    py.on('close', code => { if (code !== 0) reject(new Error(`cluster_images.py exited with code ${code}`)); });
  });
});

ipcMain.handle('get-image-metadata', async (event, filePath) => {
  try {
    // Live Drive paths: pull the bytes into the local byte-cache first, then
    // run the same PNG chunk parse below on the materialised file.
    if (driveFs.isDrivePath(filePath)) {
      filePath = await driveFs.materialize(await liveAuth(), filePath);
    }
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

ipcMain.handle('get-text-file', async (event, filePath) => {
  try {
    if (driveFs.isDrivePath(filePath)) {
      filePath = await driveFs.materialize(await liveAuth(), filePath);
    }
    const text = await fs.readFile(filePath, 'utf8');
    return { success: true, text };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-text-file', async (event, filePath, text) => {
  try {
    if (driveFs.isDrivePath(filePath)) {
      filePath = await driveFs.materialize(await liveAuth(), filePath);
    }
    await fs.writeFile(filePath, text, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Google Drive IPC handlers ─────────────────────────────────────

// Drive cache lives next to the project / installed app so it's easy to find
// and manage:
//   dev  → <repo>/drive-cache/
//   prod → <dir containing the app executable>/drive-cache/
function driveCacheBaseDir() {
  const base = app.getPath('home');
  return path.join(base, 'Drive');
}

ipcMain.handle('drive-status', async () => {
  try {
    const configured = driveOauth.hasConfiguredClient();
    const signedIn = configured && (await driveOauth.isSignedIn());
    const profile = signedIn ? await driveOauth.getProfile() : null;
    return { configured, signedIn, profile };
  } catch (err) {
    return { configured: false, signedIn: false, profile: null, error: err.message };
  }
});

ipcMain.handle('drive-signin', async (event, options) => {
  try {
    const r = await driveOauth.signIn(options);
    return { success: true, profile: r.profile };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive-signout', async () => {
  try {
    await driveOauth.signOut();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive-list-folder', async (_e, { folderId } = {}) => {
  try {
    const auth = await driveOauth.getAuthClient();
    const parentId = folderId || 'root';
    const children = await driveApi.listFolder(auth, parentId, { includeAll: false });
    const folders = children
      .filter((c) => c.mimeType === driveApi.FOLDER_MIME)
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const images = children
      .filter((c) => driveApi.isImage(c))
      .map((c) => ({ id: c.id, name: c.name, size: c.size ? Number(c.size) : null, modifiedTime: c.modifiedTime || null, thumbnailLink: c.thumbnailLink, hasThumbnail: c.hasThumbnail }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    return { success: true, folders, images, imageCount: images.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive-get-thumbnail', async (_e, fileId) => {
  try {
    const auth = await driveOauth.getAuthClient();
    const meta = await driveApi.getFileMetadata(auth, fileId);
    return meta.thumbnailLink || null;
  } catch (err) {
    return null;
  }
});

// Progress relay: pull / push send granular events via 'drive-progress'.
function relayProgress(phase) {
  return (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('drive-progress', { phase, ...event });
    }
  };
}

ipcMain.handle('drive-pull', async (_e, { driveFolderId, datasetName, strategy }) => {
  try {
    const auth = await driveOauth.getAuthClient();
    const result = await driveSync.pullDataset(auth, {
      driveFolderId,
      datasetName,
      cacheBaseDir: driveCacheBaseDir(),
      onProgress: relayProgress('pull'),
      strategy,
    });
    return { success: true, cacheRoot: result.cacheRoot };
  } catch (err) {
    console.error('drive-pull failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive-push', async (_e, { cacheRoot, force = false }) => {
  try {
    const auth = await driveOauth.getAuthClient();
    const result = await driveSync.pushDataset(auth, cacheRoot, {
      force,
      onProgress: relayProgress('push'),
    });
    if (!result.ok && result.conflicts) {
      return { success: false, conflicts: result.conflicts };
    }
    notifyManifestChanged(cacheRoot);
    return { success: true };
  } catch (err) {
    console.error('drive-push failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive-create-folder', async (_e, { parentId, name }) => {
  try {
    const auth = await driveOauth.getAuthClient();
    const created = await driveApi.createFolder(auth, { parentId, name });
    return { success: true, folder: created };
  } catch (err) {
    console.error('drive-create-folder failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive-link-dataset', async (_e, { localPath, driveFolderId, datasetName }) => {
  try {
    const auth = await driveOauth.getAuthClient();
    const result = await driveSync.linkDataset(auth, {
      localPath,
      driveFolderId,
      datasetName,
      onProgress: relayProgress('push'),
    });
    notifyManifestChanged(localPath);
    return { success: true, cacheRoot: result.cacheRoot };
  } catch (err) {
    console.error('drive-link-dataset failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive-detect-conflicts', async (_e, { cacheRoot }) => {
  try {
    const auth = await driveOauth.getAuthClient();
    const result = await driveSync.detectConflicts(auth, cacheRoot);
    return { success: true, conflicts: result.conflicts };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('drive-clear-cache', async (_e, { cacheRoot, keepManifest = true }) => {
  try {
    const result = await driveSync.clearLocalCache(cacheRoot, { keepManifest });
    notifyManifestChanged(cacheRoot);
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('drive-clear-all-cache', async (_e) => {
  try {
    const baseDir = driveCacheBaseDir();
    let entries;
    try {
      entries = await require('fs').promises.readdir(baseDir, { withFileTypes: true });
    } catch {
      return { ok: true };
    }
    
    const errors = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        const fullPath = path.join(baseDir, e.name);
        if (require('fs').existsSync(path.join(fullPath, '.sync-manifest.json'))) {
          const res = await driveSync.clearLocalCache(fullPath, { keepManifest: true });
          if (!res.ok) {
            if (res.error === 'unsynced-changes') {
              errors.push(`'${e.name}' (has unsynced edits)`);
            } else {
              errors.push(`'${e.name}' (${res.error})`);
            }
          }
        }
      }
    }
    if (errors.length > 0) return { ok: false, error: 'Could not clear: ' + errors.join(', ') + '. Please push these datasets first.' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('drive-cancel', () => {
  const { cancel } = require('./drive/driveCancel');
  cancel();
  return { success: true };
});

ipcMain.handle('drive-refresh-manifest', async (_e, { cacheRoot }) => {
  try {
    const m = await driveSync.refreshManifest(cacheRoot);
    notifyManifestChanged(cacheRoot);
    return { success: true, manifest: m };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

function buildStatesByPath(cacheRoot, m) {
  const out = {};
  for (const [rel, entry] of Object.entries(m.files || {})) {
    const abs = path.join(cacheRoot, driveManifest.toNative(rel));
    out[abs] = entry.state;
  }
  return out;
}

ipcMain.handle('drive-get-manifest', async (_e, { cacheRoot }) => {
  try {
    const m = await driveManifest.read(cacheRoot);
    if (!m) return { success: false, error: 'no-manifest' };
    return {
      success: true,
      manifest: m,
      summary: driveManifest.summary(m),
      statesByPath: buildStatesByPath(cacheRoot, m),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Given any absolute folder path, tell the caller whether it's a Drive-backed
// cache root. Used by App.js to decide whether to show the DrivePanel.
ipcMain.handle('drive-manifest-for-path', async (_e, absPath) => {
  try {
    if (!absPath) return { isCache: false };
    // Live drive:// workspaces have no manifest by design.
    if (driveFs.isDrivePath(absPath)) return { isCache: false };
    // Only treat as cache if the path itself contains a manifest at its root.
    const m = await driveManifest.read(absPath);
    if (!m) return { isCache: false };
    return {
      isCache: true,
      cacheRoot: absPath,
      manifest: m,
      summary: driveManifest.summary(m),
      statesByPath: buildStatesByPath(absPath, m),
    };
  } catch (err) {
    return { isCache: false, error: err.message };
  }
});

// ── LAN remote access ─────────────────────────────────────────────

ipcMain.handle('lan-start', async () => {
  try {
    const info = await lanServer.start({
      onIntent: (intent, payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lan-intent', { intent, payload });
        }
      },
    });
    let qrDataUrl = null;
    try {
      const qrcode = require('qrcode');
      qrDataUrl = await qrcode.toDataURL(info.url, { margin: 1, width: 260 });
    } catch (err) {
      console.error('qrcode gen failed:', err);
    }
    return { success: true, ...info, qrDataUrl };
  } catch (err) {
    console.error('lan-start failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lan-stop', async () => {
  lanServer.stop();
  return { success: true, ...lanServer.status() };
});

ipcMain.handle('lan-status', async () => lanServer.status());

ipcMain.handle('lan-push-state', (_e, partial) => {
  try { lanServer.pushState(partial || {}); } catch (err) { console.error('lan-push-state', err); }
  return true;
});
