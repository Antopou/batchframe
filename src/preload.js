const { contextBridge, ipcRenderer } = require('electron');

// Electron prefixes a rejected handler's message with "Error invoking remote
// method 'x': Error: ", and the renderer shows these messages to the user
// verbatim. Hand back only what the handler itself said.
const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/;

function invoke(...args) {
  return ipcRenderer.invoke(...args).catch((err) => {
    const clean = new Error(String(err?.message ?? err).replace(IPC_PREFIX, ''));
    clean.cause = err;
    throw clean;
  });
}


try {
  console.log('[Preload] Starting preload script...');

  const apis = {
    platform: process.platform,
    selectFolder: () => invoke('select-folder'),
    selectFile: (options) => invoke('select-file', options),
    getImages: (folderPath) => invoke('get-images', folderPath),
    deleteImages: (filePaths) => invoke('delete-images', filePaths),
    softDeleteImages: (filePaths) => invoke('soft-delete-images', filePaths),
    restoreImages: (trashInfos) => invoke('restore-images', trashInfos),
    emptyTrash: (folderPath) => invoke('empty-trash', folderPath),
    getImageData: (imagePath, variant) => invoke('get-image-data', imagePath, variant),
    getSubfolders: (folderPath) => invoke('get-subfolders', folderPath),
    getFolderPreview: (folderPath, limit) => invoke('get-folder-preview', { folderPath, limit }),
    createFolder: (parentPath, name) => invoke('create-folder', { parentPath, name }),
    renameFolder: (oldPath, newName) => invoke('rename-folder', { oldPath, newName }),
    deleteFolder: (folderPath) => invoke('delete-folder', folderPath),
    renameImages: (renames) => invoke('rename-images', renames),
    saveCroppedImage: ({ originalPath, dataUrl }) => invoke('save-cropped-image', { originalPath, dataUrl }),
    openInApp: (filePaths, appPath) => invoke('open-in-app', { filePaths, appPath }),
    findPhotoshop: () => invoke('find-photoshop'),
    moveImages: (filePaths, destFolder) => invoke('move-images', { filePaths, destFolder }),
    startFolderWatch: (folderPath) => invoke('start-folder-watch', folderPath),
    stopFolderWatch: () => invoke('stop-folder-watch'),
    onDeleteProgress: (callback) => ipcRenderer.on('delete-progress', (event, data) => callback(data)),
    removeDeleteListeners: () => ipcRenderer.removeAllListeners('delete-progress'),
    onMoveProgress: (callback) => ipcRenderer.on('move-progress', (event, data) => callback(data)),
    removeMoveListeners: () => ipcRenderer.removeAllListeners('move-progress'),
    onInitialFolder: (callback) => ipcRenderer.on('initial-folder', (event, p) => callback(p)),
    onFolderChange: (callback) => ipcRenderer.on('folder-change', (event, data) => callback(data)),
    removeFolderChangeListeners: () => ipcRenderer.removeAllListeners('folder-change'),
    openPath:            (filePath) => invoke('open-path', filePath),
    openExternal:        (url) => invoke('open-external', url),
    showInFolder:        (filePath) => invoke('show-in-folder', filePath),
    getImageMetadata:    (filePath) => invoke('get-image-metadata', filePath),
    getTextFile:         (filePath) => invoke('get-text-file', filePath),
    saveTextFile:        (filePath, text) => invoke('save-text-file', filePath, text),
    copyImages:          (filePaths, destFolder) => invoke('copy-images', { filePaths, destFolder }),
    onCopyProgress:      (cb) => ipcRenderer.on('copy-progress', (event, data) => cb(data)),
    removeCopyListeners: () => ipcRenderer.removeAllListeners('copy-progress'),
    downloadImages:          (filePaths, destFolder) => invoke('download-images', { filePaths, destFolder }),
    onDownloadProgress:      (cb) => ipcRenderer.on('download-progress', (event, data) => cb(data)),
    removeDownloadListeners: () => ipcRenderer.removeAllListeners('download-progress'),
    pathExists:            (p) => invoke('path-exists', p),
    getCharacterProfiles:  () => invoke('get-character-profiles'),
    createCharacter:       (character) => invoke('create-character', character),
    openRefsFolder:        (character) => invoke('open-refs-folder', character),
    addToRefs:             ({ imagePaths, character }) => invoke('add-to-refs', { imagePaths, character }),
    clearRefs:             (character) => invoke('clear-refs', character),
    scanCharacter:         (imagePaths, characters, clipGate) => invoke('scan-character', { imagePaths, characters, clipGate }),
    onScanProgress:        (cb) => ipcRenderer.on('scan-progress', (_, p) => cb(p)),
    removeScanListeners:   () => ipcRenderer.removeAllListeners('scan-progress'),
    detectFaces:           (imagePaths) => invoke('detect-faces', { imagePaths }),
    findDuplicates:        (imagePaths) => invoke('find-duplicates', { imagePaths }),
    findSimilar:           (referencePath, imagePaths) => invoke('find-similar', { referencePath, imagePaths }),
    findSourceMatch:       (editedPaths, rawPaths, threshold) => invoke('find-source-match', { editedPaths, rawPaths, threshold }),
    clusterImages:         (imagePaths, numClusters) => invoke('cluster-images', { imagePaths, numClusters }),
    onDetectProgress:      (cb) => ipcRenderer.on('detect-progress', (_, p) => cb(p)),
    removeDetectListeners: () => ipcRenderer.removeAllListeners('detect-progress'),
    removeBackground:      (imagePaths, saveMode, background, quality) => invoke('remove-background', { imagePaths, saveMode, background, quality }),
    previewBackground:     (imagePath, background, quality) => invoke('preview-background', { imagePath, background, quality }),
    removeSubtitles:       (imagePaths, saveMode, area, fill, orderedPaths) => invoke('remove-subtitles', { imagePaths, saveMode, area, fill, orderedPaths }),
    previewSubtitles:      (imagePath, area, fill, orderedPaths) => invoke('preview-subtitles', { imagePath, area, fill, orderedPaths }),
    onSubProgress:         (cb) => ipcRenderer.on('sub-progress', (_, p) => cb(p)),
    removeSubListeners:    () => ipcRenderer.removeAllListeners('sub-progress'),
    onBgProgress:          (cb) => ipcRenderer.on('bg-progress', (_, p) => cb(p)),
    removeBgListeners:     () => ipcRenderer.removeAllListeners('bg-progress'),

    drive: {
      status:            () => invoke('drive-status'),
      cancel:            () => invoke('drive-cancel'),
      signIn:            (options) => invoke('drive-signin', options),
      signOut:           () => invoke('drive-signout'),
      listFolder:        (folderId) => invoke('drive-list-folder', { folderId }),
      pull:              ({ driveFolderId, datasetName, strategy }) => invoke('drive-pull', { driveFolderId, datasetName, strategy }),
      push:              ({ cacheRoot, force }) => invoke('drive-push', { cacheRoot, force }),
      createFolder:      ({ parentId, name }) => invoke('drive-create-folder', { parentId, name }),
      linkDataset:       ({ localPath, driveFolderId, datasetName }) => invoke('drive-link-dataset', { localPath, driveFolderId, datasetName }),
      detectConflicts:   ({ cacheRoot }) => invoke('drive-detect-conflicts', { cacheRoot }),
      clearCache:        ({ cacheRoot, keepManifest }) => invoke('drive-clear-cache', { cacheRoot, keepManifest }),
      clearAllCache:     () => invoke('drive-clear-all-cache'),
      refreshManifest:   ({ cacheRoot }) => invoke('drive-refresh-manifest', { cacheRoot }),
      getManifest:       ({ cacheRoot }) => invoke('drive-get-manifest', { cacheRoot }),
      manifestForPath:   (absPath) => invoke('drive-manifest-for-path', absPath),
      getThumbnail:      (fileId) => invoke('drive-get-thumbnail', fileId),

      onProgress:            (cb) => ipcRenderer.on('drive-progress', (_, p) => cb(p)),
      removeProgressListeners: () => ipcRenderer.removeAllListeners('drive-progress'),
      onManifestChanged:     (cb) => ipcRenderer.on('drive-manifest-changed', (_, p) => cb(p)),
      removeManifestChangedListeners: () => ipcRenderer.removeAllListeners('drive-manifest-changed'),
    },
    onFullscreenChange: (callback) => ipcRenderer.on('fullscreen-change', (event, isFullscreen) => callback(isFullscreen)),
    removeFullscreenChangeListeners: () => ipcRenderer.removeAllListeners('fullscreen-change'),

    lan: {
      start:     () => invoke('lan-start'),
      stop:      () => invoke('lan-stop'),
      status:    () => invoke('lan-status'),
      pushState: (partial) => invoke('lan-push-state', partial),
      onIntent:  (cb) => ipcRenderer.on('lan-intent', (_, data) => cb(data)),
      removeIntentListeners: () => ipcRenderer.removeAllListeners('lan-intent'),
    },
  };

  contextBridge.exposeInMainWorld('electronAPI', apis);
  console.log('[Preload] electronAPI exposed successfully');
} catch (error) {
  console.error('[Preload] Error:', error);
}
