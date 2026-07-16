const { contextBridge, ipcRenderer } = require('electron');


try {
  console.log('[Preload] Starting preload script...');

  const apis = {
    platform: process.platform,
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    selectFile: (options) => ipcRenderer.invoke('select-file', options),
    getImages: (folderPath) => ipcRenderer.invoke('get-images', folderPath),
    deleteImages: (filePaths) => ipcRenderer.invoke('delete-images', filePaths),
    getImageData: (imagePath) => ipcRenderer.invoke('get-image-data', imagePath),
    getSubfolders: (folderPath) => ipcRenderer.invoke('get-subfolders', folderPath),
    getFolderPreview: (folderPath, limit) => ipcRenderer.invoke('get-folder-preview', { folderPath, limit }),
    createFolder: (parentPath, name) => ipcRenderer.invoke('create-folder', { parentPath, name }),
    renameFolder: (oldPath, newName) => ipcRenderer.invoke('rename-folder', { oldPath, newName }),
    deleteFolder: (folderPath) => ipcRenderer.invoke('delete-folder', folderPath),
    renameImages: (renames) => ipcRenderer.invoke('rename-images', renames),
    saveCroppedImage: ({ originalPath, dataUrl }) => ipcRenderer.invoke('save-cropped-image', { originalPath, dataUrl }),
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
    scanCharacter:         (imagePaths, characters, clipGate) => ipcRenderer.invoke('scan-character', { imagePaths, characters, clipGate }),
    onScanProgress:        (cb) => ipcRenderer.on('scan-progress', (_, p) => cb(p)),
    removeScanListeners:   () => ipcRenderer.removeAllListeners('scan-progress'),
    detectFaces:           (imagePaths) => ipcRenderer.invoke('detect-faces', { imagePaths }),
    onDetectProgress:      (cb) => ipcRenderer.on('detect-progress', (_, p) => cb(p)),
    removeDetectListeners: () => ipcRenderer.removeAllListeners('detect-progress'),

    drive: {
      status:            () => ipcRenderer.invoke('drive-status'),
      signIn:            () => ipcRenderer.invoke('drive-signin'),
      signOut:           () => ipcRenderer.invoke('drive-signout'),
      listFolder:        (folderId) => ipcRenderer.invoke('drive-list-folder', { folderId }),
      pull:              ({ driveFolderId, datasetName }) => ipcRenderer.invoke('drive-pull', { driveFolderId, datasetName }),
      push:              ({ cacheRoot, force }) => ipcRenderer.invoke('drive-push', { cacheRoot, force }),
      pushNew:           ({ localPath, parentId, folderName }) => ipcRenderer.invoke('drive-push-new', { localPath, parentId, folderName }),
      detectConflicts:   ({ cacheRoot }) => ipcRenderer.invoke('drive-detect-conflicts', { cacheRoot }),
      clearCache:        ({ cacheRoot, keepManifest }) => ipcRenderer.invoke('drive-clear-cache', { cacheRoot, keepManifest }),
      refreshManifest:   ({ cacheRoot }) => ipcRenderer.invoke('drive-refresh-manifest', { cacheRoot }),
      getManifest:       ({ cacheRoot }) => ipcRenderer.invoke('drive-get-manifest', { cacheRoot }),
      manifestForPath:   (absPath) => ipcRenderer.invoke('drive-manifest-for-path', absPath),
      getThumbnail:      (fileId) => ipcRenderer.invoke('drive-get-thumbnail', fileId),

      onProgress:            (cb) => ipcRenderer.on('drive-progress', (_, p) => cb(p)),
      removeProgressListeners: () => ipcRenderer.removeAllListeners('drive-progress'),
      onManifestChanged:     (cb) => ipcRenderer.on('drive-manifest-changed', (_, p) => cb(p)),
      removeManifestChangedListeners: () => ipcRenderer.removeAllListeners('drive-manifest-changed'),
    },
    onFullscreenChange: (callback) => ipcRenderer.on('fullscreen-change', (event, isFullscreen) => callback(isFullscreen)),
    removeFullscreenChangeListeners: () => ipcRenderer.removeAllListeners('fullscreen-change'),
  };

  contextBridge.exposeInMainWorld('electronAPI', apis);
  console.log('[Preload] electronAPI exposed successfully');
} catch (error) {
  console.error('[Preload] Error:', error);
}
