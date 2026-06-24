const { contextBridge, ipcRenderer } = require('electron');


try {
  console.log('[Preload] Starting preload script...');

  const apis = {
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    selectFile: (options) => ipcRenderer.invoke('select-file', options),
    getImages: (folderPath) => ipcRenderer.invoke('get-images', folderPath),
    deleteImages: (filePaths) => ipcRenderer.invoke('delete-images', filePaths),
    getImageData: (imagePath) => ipcRenderer.invoke('get-image-data', imagePath),
    getSubfolders: (folderPath) => ipcRenderer.invoke('get-subfolders', folderPath),
    renameImages: (renames) => ipcRenderer.invoke('rename-images', renames),
    openInApp: (filePaths, appPath) => ipcRenderer.invoke('open-in-app', { filePaths, appPath }),
    findPhotoshop: () => ipcRenderer.invoke('find-photoshop'),
    moveImages: (filePaths, destFolder) => ipcRenderer.invoke('move-images', { filePaths, destFolder }),
    startFolderWatch: (folderPath) => ipcRenderer.invoke('start-folder-watch', folderPath),
    stopFolderWatch: () => ipcRenderer.invoke('stop-folder-watch'),
    onDeleteProgress: (callback) => ipcRenderer.on('delete-progress', (event, data) => callback(data)),
    removeDeleteListeners: () => ipcRenderer.removeAllListeners('delete-progress'),
    onMoveProgress: (callback) => ipcRenderer.on('move-progress', (event, data) => callback(data)),
    removeMoveListeners: () => ipcRenderer.removeAllListeners('move-progress'),
    onInitialFolder: (callback) => ipcRenderer.on('initial-folder', (event, p) => callback(p)),
    onFolderChange: (callback) => ipcRenderer.on('folder-change', (event, data) => callback(data)),
    removeFolderChangeListeners: () => ipcRenderer.removeAllListeners('folder-change'),
    openPath:            (filePath) => ipcRenderer.invoke('open-path', filePath),
    showInFolder:        (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
    getImageMetadata:    (filePath) => ipcRenderer.invoke('get-image-metadata', filePath),
    copyImages:          (filePaths, destFolder) => ipcRenderer.invoke('copy-images', { filePaths, destFolder }),
    onCopyProgress:      (cb) => ipcRenderer.on('copy-progress', (event, data) => cb(data)),
    removeCopyListeners: () => ipcRenderer.removeAllListeners('copy-progress'),
    exportPaths:         (filePaths) => ipcRenderer.invoke('export-paths', { filePaths }),
    pathExists:            (p) => ipcRenderer.invoke('path-exists', p),
    getCharacterProfiles:  () => ipcRenderer.invoke('get-character-profiles'),
    createCharacter:       (character) => ipcRenderer.invoke('create-character', character),
    openRefsFolder:        (character) => ipcRenderer.invoke('open-refs-folder', character),
    addToRefs:             ({ imagePaths, character }) => ipcRenderer.invoke('add-to-refs', { imagePaths, character }),
    clearRefs:             (character) => ipcRenderer.invoke('clear-refs', character),
    scanCharacter:         (imagePaths, characters) => ipcRenderer.invoke('scan-character', { imagePaths, characters }),
    onScanProgress:        (cb) => ipcRenderer.on('scan-progress', (_, p) => cb(p)),
    removeScanListeners:   () => ipcRenderer.removeAllListeners('scan-progress'),
  };

  contextBridge.exposeInMainWorld('electronAPI', apis);
  console.log('[Preload] electronAPI exposed successfully');
} catch (error) {
  console.error('[Preload] Error:', error);
}
