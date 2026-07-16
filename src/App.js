import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import './App.css';
import Controls from './components/Controls';
import ImageGrid from './components/ImageGrid';
import SubfolderBar from './components/SubfolderBar';
import ImagePreviewModal from './components/ImagePreviewModal';
import ConfirmDialog from './components/ConfirmDialog';
import ContextMenu from './components/ContextMenu';
import MetadataModal from './components/MetadataModal';
import RenameModal from './components/RenameModal';
import AutoCropModal from './components/AutoCropModal';
import CommandPalette from './components/CommandPalette';
import DriveButton from './components/DriveButton';
import { boxToCropRect } from './utils/faceCrop';

const LAST_FOLDER_KEY = 'batchframe-last-folder';
const CONFIRM_REQUIRED_KEY = 'batchframe-confirm-required';
const PREVIEW_MIN = 80;
const PREVIEW_MAX = 300;
const PREVIEW_STEP = 12;
const FOLDER_PREVIEW_CACHE_MAX = 200;
const FOLDER_PREVIEW_CONCURRENCY = 8;

function clamp(value) {
  return Math.max(PREVIEW_MIN, Math.min(PREVIEW_MAX, value));
}

function App() {
  const fileInputRef = useRef(null);
  const gridRef = useRef(null);

  const [folderPath, setFolderPath] = useState('');
  const [images, setImages] = useState([]);
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [selectedFolders, setSelectedFolders] = useState(new Set());
  const [previewSize, setPreviewSize] = useState(150);
  const [imageFitMode, setImageFitMode] = useState('contain');
  const [viewMode, setViewMode] = useState(() => {
    const v = localStorage.getItem('viewMode');
    return ['explorer', 'grid', 'list'].includes(v) ? v : 'explorer';
  });
  const [listDetail, setListDetail] = useState(() => localStorage.getItem('listDetail') === 'thumb' ? 'thumb' : 'plain');
  const [dragSelectEnabled, setDragSelectEnabled] = useState(true);
  const [pageSize, setPageSize] = useState(99999); // default to "All"
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [browserMode, setBrowserMode] = useState(false);
  const [lastFolderPath, setLastFolderPath] = useState('');
  const [confirmRequired, setConfirmRequired] = useState(true);

  // Custom confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Auto-hide header state
  const [headerVisible, setHeaderVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Lock functionality state
  const [lockedImages, setLockedImages] = useState(new Set());

  // Subfolder navigation state
  const [subfolders, setSubfolders] = useState([]);
  const [parentFolderPath, setParentFolderPath] = useState(null);

  // Folder management state (context menu + inline rename)
  const [folderMenu, setFolderMenu] = useState(null);
  const [editingFolderPath, setEditingFolderPath] = useState(null);

  // Subfolder bar visibility state
  const [subfolderBarVisible, setSubfolderBarVisible] = useState(true);
  const [subfolderBarPinned, setSubfolderBarPinned] = useState(true);
  const lastSubfolderScrollY = useRef(0);

  // Recent folders state
  const [recentFolders, setRecentFolders] = useState([]);
  const [showRecentFolders, setShowRecentFolders] = useState(false);
  const [forwardHistory, setForwardHistory] = useState([]);

  // Folder preview cache: LRU Map keyed by absolute folder path -> preview[] from get-folder-preview.
  // Session-only, capped at FOLDER_PREVIEW_CACHE_MAX entries; used by FolderThumbnail in explorer view + empty state.
  const [folderPreviews, setFolderPreviews] = useState(() => new Map());
  const folderLoadToken = useRef(0);

  // Preview modal state
  const [previewImage, setPreviewImage] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  // Help state
  const [showShortcuts, setShowShortcuts] = useState(false);

  const autoScrollBottom    = useRef(false);
  const folderPathRef       = useRef(null);
  const [initialRoot] = useState(() => localStorage.getItem('batchframe-root-folder') || '');
  const rootFolderPathRef   = useRef(initialRoot);
  const keyboardAnchorRef   = useRef(null);
  const keyboardSnapshotRef = useRef(null);
  const keyboardCursorRef   = useRef(null);
  const [keyboardCursorIndex, setKeyboardCursorIndex] = useState(null);

  // Smooth spacebar page-scroll animation state
  const scrollAnim = useRef({ target: 0, raf: null, minStep: 0 });

  // Delete operation state
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });

  // Sort state
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  // Order-select state
  const [orderSelectMode, setOrderSelectMode] = useState(false);
  const [orderedSelection, setOrderedSelection] = useState([]);

  // Photoshop state
  const [photoshopPath, setPhotoshopPath] = useState(() => localStorage.getItem('photoshopPath') || '');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Command Palette
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  // Move state
  const [isMoving, setIsMoving] = useState(false);
  const [moveProgress, setMoveProgress] = useState({ current: 0, total: 0 });

  // Auto-reload state
  const [autoReloadEnabled, setAutoReloadEnabled] = useState(() => localStorage.getItem('autoReloadEnabled') === 'true');

  // Context menu state
  const [contextMenu, setContextMenu]     = useState(null); // { x, y, image } | null
  const [metadataModal, setMetadataModal] = useState(null); // { imageName, metadata } | null
  const [renameModal, setRenameModal]     = useState(null); // { images: [...] } | null

  // ── Batch auto-crop-to-face state ──────────────────────────────
  const [autoCropModal, setAutoCropModal]       = useState(null); // { paths: [...] } | null
  const [autoCropRunning, setAutoCropRunning]   = useState(false);
  const [autoCropProgress, setAutoCropProgress] = useState({ current: 0, total: 0, text: '' });
  const [autoCropResult, setAutoCropResult]     = useState(null); // { cropped, skipped, failed, error } | null

  // Copy state
  const [isCopying, setIsCopying]       = useState(false);
  const [copyProgress, setCopyProgress] = useState({ current: 0, total: 0 });

  // Aspect ratio filter state
  const [aspectFilter, setAspectFilter] = useState('all');

  // AI scan state
  const [aiScores, setAiScores]           = useState({});
  const [aiThreshold, setAiThreshold]     = useState(0.80);
  const [scanning, setScanning]           = useState(false);
  const [scanProgress, setScanProgress]   = useState({ done: 0, total: 0 });
  const [profilesVersion, setProfilesVersion] = useState(0);
  const [scanningPath, setScanningPath]   = useState(null);
  const [scanStatus, setScanStatus]       = useState('');
  const [activeCharacter, setActiveCharacter] = useState(null);

  // Drive sync state: which cache is open, per-file sync state map for badges.
  const [driveCacheRoot, setDriveCacheRoot] = useState(null);
  const [driveManifest, setDriveManifest] = useState(null);
  const [driveSummary, setDriveSummary] = useState(null);
  const [driveStatesByPath, setDriveStatesByPath] = useState(null);

  // Listen to fullscreen changes
  useEffect(() => {
    if (window.electronAPI?.onFullscreenChange) {
      window.electronAPI.onFullscreenChange((isFull) => {
        setIsFullscreen(isFull);
      });
      return () => {
        if (window.electronAPI?.removeFullscreenChangeListeners) {
          window.electronAPI.removeFullscreenChangeListeners();
        }
      };
    }
  }, []);

  // Reload manifest whenever the open folder changes, and on drive-manifest-changed events.
  useEffect(() => {
    if (!window.electronAPI?.drive || !folderPath) {
      setDriveCacheRoot(null);
      setDriveManifest(null);
      setDriveSummary(null);
      setDriveStatesByPath(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const r = await window.electronAPI.drive.manifestForPath(folderPath);
      if (cancelled) return;
      if (r.isCache) {
        setDriveCacheRoot(r.cacheRoot);
        setDriveManifest(r.manifest);
        setDriveSummary(r.summary);
        setDriveStatesByPath(r.statesByPath || null);
      } else {
        setDriveCacheRoot(null);
        setDriveManifest(null);
        setDriveSummary(null);
        setDriveStatesByPath(null);
      }
    };
    load();
    const onChange = ({ cacheRoot }) => {
      if (cacheRoot === folderPath) load();
    };
    window.electronAPI.drive.onManifestChanged(onChange);
    return () => {
      cancelled = true;
      window.electronAPI.drive.removeManifestChangedListeners();
    };
  }, [folderPath]);

  // ── Init ────────────────────────────────────────────────────────
  useEffect(() => { setBrowserMode(!window.electronAPI); }, []);

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onDeleteProgress((data) => {
      setDeleteProgress(data);
    });
    if (window.electronAPI.onMoveProgress) {
      window.electronAPI.onMoveProgress((data) => setMoveProgress(data));
    }

    return () => {
      window.electronAPI.removeDeleteListeners();
      if (window.electronAPI.removeMoveListeners) window.electronAPI.removeMoveListeners();
    };
  }, []);


  useEffect(() => {
    if (!window.electronAPI) return;
    const saved = localStorage.getItem(LAST_FOLDER_KEY);
    if (saved) setLastFolderPath(saved);
    const savedConfirm = localStorage.getItem(CONFIRM_REQUIRED_KEY);
    if (savedConfirm !== null) setConfirmRequired(savedConfirm !== 'false');
    const savedRecent = localStorage.getItem('batchframe-recent-folders');
    if (savedRecent) setRecentFolders(JSON.parse(savedRecent));
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.findPhotoshop) return;
    if (photoshopPath) return;
    window.electronAPI.findPhotoshop().then(p => {
      if (p) { setPhotoshopPath(p); localStorage.setItem('photoshopPath', p); }
    });
  }, []);

  // Revoke blob URLs on images change
  useEffect(() => {
    return () => {
      images.forEach((img) => {
        if (img.previewSrc?.startsWith('blob:')) URL.revokeObjectURL(img.previewSrc);
      });
    };
  }, [images]);

  // ── Folder watcher (auto-reload when files change on disk) ──────
  useEffect(() => {
    if (!window.electronAPI?.startFolderWatch) return;
    if (!autoReloadEnabled || !folderPath) {
      if (window.electronAPI.stopFolderWatch) window.electronAPI.stopFolderWatch();
      return;
    }
    window.electronAPI.startFolderWatch(folderPath);

    const handleChange = ({ folderPath: changedFolder, changes }) => {
      if (changedFolder !== folderPath) return;
      const hasAdditions = changes.some(c => c.kind !== 'remove');
      if (hasAdditions) {
        autoScrollBottom.current = gridRef.current?.isNearBottom(300) ?? true;
      }
      setImages((prev) => {
        let next = prev;
        const byPath = new Map(prev.map((img, i) => [img.path, i]));
        const additions = [];
        for (const change of changes) {
          const idx = byPath.get(change.path);
          if (change.kind === 'remove') {
            if (idx != null) {
              if (next === prev) next = [...prev];
              next = next.filter((img) => img.path !== change.path);
            }
          } else {
            if (idx != null) {
              if (next === prev) next = [...prev];
              next[idx] = { ...next[idx], size: change.size, mtime: change.mtime };
            } else {
              additions.push({ name: change.name, path: change.path, size: change.size, mtime: change.mtime, source: 'electron', previewSrc: '' });
            }
          }
        }
        if (additions.length) {
          if (next === prev) next = [...prev];
          next = next.concat(additions);
        }
        return next;
      });
    };

    window.electronAPI.onFolderChange(handleChange);
    return () => {
      if (window.electronAPI.stopFolderWatch) window.electronAPI.stopFolderWatch();
      if (window.electronAPI.removeFolderChangeListeners) window.electronAPI.removeFolderChangeListeners();
    };
  }, [autoReloadEnabled, folderPath]);

  // ── Auto-scroll to newest image when folder watch adds files ────
  useEffect(() => {
    if (!autoScrollBottom.current) return;
    autoScrollBottom.current = false;
    requestAnimationFrame(() => {
      gridRef.current?.scrollToBottom();
    });
  }, [images]);

  // ── Sort ────────────────────────────────────────────────────────
  const sortedImages = useMemo(() => {
    if (sortBy === 'none') return images;
    return [...images].sort((a, b) => {
      let v = 0;
      if (sortBy === 'name') v = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      else if (sortBy === 'date') v = (a.mtime || 0) - (b.mtime || 0);
      else if (sortBy === 'size') v = (a.size  || 0) - (b.size  || 0);
      return sortDir === 'asc' ? v : -v;
    });
  }, [images, sortBy, sortDir]);

  // ── Search + aspect filter ──────────────────────────────────────
  const filteredImages = useMemo(() => {
    let result = sortedImages;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(img => img.name.toLowerCase().includes(q));
    }
    if (aspectFilter !== 'all') {
      result = result.filter(img => {
        if (!img.width || !img.height) return true;
        if (aspectFilter === 'portrait')  return img.height > img.width;
        if (aspectFilter === 'landscape') return img.width  > img.height;
        if (aspectFilter === 'square')    return img.width  === img.height;
        return true;
      });
    }
    return result;
  }, [sortedImages, searchQuery, aspectFilter]);

  const filteredImagesRef = useRef(filteredImages);
  const subfoldersRef = useRef(subfolders);
  useEffect(() => { filteredImagesRef.current = filteredImages; }, [filteredImages]);
  useEffect(() => { subfoldersRef.current = subfolders; }, [subfolders]);
  useEffect(() => { folderPathRef.current = folderPath; }, [folderPath]);

  // Redundant useEffect removed. Anchor/snapshot logic is managed synchronously in click/keyboard handlers.

  // ── Follow scanning position during AI scan ────────────────────
  useEffect(() => {
    if (!scanning || !scanningPath) return;
    const vp = gridRef.current?.getViewport();
    if (!vp) return;
    const index = filteredImages.findIndex(img => img.path === scanningPath);
    if (index < 0) return;

    // Geometry must match ImageGrid's windowing: cards are square, so row
    // height is the real column width (>= previewSize because tracks are 1fr).
    const gap = 10, padV = 16, padH = 40;
    const gridW = vp.clientWidth - padH;
    const cols  = Math.max(1, Math.floor((gridW + gap) / (previewSize + gap)));
    const colW  = (gridW - (cols - 1) * gap) / cols;
    const rowH  = colW + gap;
    const row   = Math.floor(index / cols);
    const rowTop = padV + row * rowH;
    const rowBot = rowTop + colW;
    const { scrollTop, clientHeight } = vp;

    // Only follow if scan is within one card-height of the viewport
    const near = rowTop <= scrollTop + clientHeight + colW + gap &&
                 rowTop >= scrollTop - colW - gap;
    if (!near) return;

    // Instant scroll: nudge just enough to keep card visible
    if (rowBot > scrollTop + clientHeight) {
      vp.scrollTo({ top: rowBot - clientHeight + gap });
    } else if (rowTop < scrollTop) {
      vp.scrollTo({ top: Math.max(0, rowTop - padV) });
    }
  }, [scanningPath, scanning, filteredImages, previewSize]);

  useEffect(() => { setCurrentPage(1); }, [searchQuery]);

  // ── Pagination ──────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filteredImages.length / pageSize));

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const pagedImages = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return filteredImages.slice(start, end);
  }, [filteredImages, currentPage, pageSize]);

  // ── Custom confirm helper ───────────────────────────────────────
  const showConfirm = useCallback((title, message, confirmLabel = 'Confirm', danger = true) => {
    return new Promise((resolve) => {
      setConfirmDialog({ title, message, confirmLabel, danger, resolve });
    });
  }, []);

  const handleConfirmYes = useCallback(() => {
    confirmDialog?.resolve(true);
    setConfirmDialog(null);
  }, [confirmDialog]);

  const handleConfirmNo = useCallback(() => {
    confirmDialog?.resolve(false);
    setConfirmDialog(null);
  }, [confirmDialog]);

  // ── Folder preview cache (LRU) ────────────────────────────────
  const invalidateFolderPreview = useCallback((folderPath) => {
    if (!folderPath) return;
    setFolderPreviews((prev) => {
      if (!prev.has(folderPath)) return prev;
      const next = new Map(prev);
      next.delete(folderPath);
      return next;
    });
  }, []);

  const loadFolderPreviews = useCallback(async (subfoldersList, token) => {
    if (!window.electronAPI?.getFolderPreview || !subfoldersList?.length) return;
    // Filter to folders not yet cached.
    const needed = [];
    setFolderPreviews((prev) => {
      for (const f of subfoldersList) if (!prev.has(f.path)) needed.push(f.path);
      return prev;
    });
    if (needed.length === 0) return;
    // Simple concurrency queue.
    let i = 0;
    const worker = async () => {
      while (i < needed.length) {
        const idx = i++;
        const p = needed[idx];
        try {
          const preview = await window.electronAPI.getFolderPreview(p, 4);
          if (folderLoadToken.current !== token) return;
          setFolderPreviews((prev) => {
            const next = new Map(prev);
            next.set(p, preview || []);
            // LRU cap: drop oldest entries.
            while (next.size > FOLDER_PREVIEW_CACHE_MAX) {
              const oldestKey = next.keys().next().value;
              next.delete(oldestKey);
            }
            return next;
          });
        } catch {}
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(FOLDER_PREVIEW_CONCURRENCY, needed.length) }, worker)
    );
  }, []);

  // ── Folder loading ──────────────────────────────────────────────
  const loadElectronFolder = useCallback(async (pathToLoad, persist = true, isExplicitOpen = false) => {
    if (!pathToLoad) return;

    if (isExplicitOpen) {
      rootFolderPathRef.current = pathToLoad;
      if (persist) {
        localStorage.setItem('batchframe-root-folder', pathToLoad);
      }
    }

    setFolderPath(pathToLoad);
    setLoading(true);
    const token = ++folderLoadToken.current;
    try {
      const [list, folderInfo] = await Promise.all([
        window.electronAPI.getImages(pathToLoad),
        window.electronAPI.getSubfolders(pathToLoad),
      ]);
      const mapped = list.map((img) => ({ ...img, previewSrc: '', source: 'electron' }));
      setImages(mapped);
      setSubfolders(folderInfo.subfolders);

      let parentPath = folderInfo.parentPath;
      const root = rootFolderPathRef.current;
      if (root && (pathToLoad === root || !pathToLoad.startsWith(root))) {
        parentPath = null;
      }
      setParentFolderPath(parentPath);
      setSubfolderBarVisible(true);
      setSelectedImages(new Set());
      setSelectedFolders(new Set());
      setLockedImages(new Set());
      setCurrentPage(1);
      if (persist) {
        localStorage.setItem(LAST_FOLDER_KEY, pathToLoad);
        setLastFolderPath(pathToLoad);

        // Update recent folders
        setRecentFolders((prev) => {
          const updated = [pathToLoad, ...prev.filter((f) => f !== pathToLoad)].slice(0, 10);
          localStorage.setItem('batchframe-recent-folders', JSON.stringify(updated));
          return updated;
        });
      }
      // Kick off preview loads for the newly displayed subfolders (fire and forget).
      loadFolderPreviews(folderInfo.subfolders, token);
      return mapped;
    } finally {
      setLoading(false);
    }
  }, [loadFolderPreviews]);

  // Navigate to a folder from the subfolder bar and reset the grid scroll to top
  const handleNavigateToFolder = useCallback(async (pathToLoad, opts = {}) => {
    const { isBack, isForward } = opts;
    if (isBack) {
      setForwardHistory(prev => [...prev, folderPathRef.current]);
    } else if (!isForward) {
      setForwardHistory([]);
    }
    await loadElectronFolder(pathToLoad, true);
    setTimeout(() => gridRef.current?.scrollToTop(), 0);
  }, [loadElectronFolder]);

  const handleNavigateUp = useCallback(async () => {
    if (parentFolderPath) await handleNavigateToFolder(parentFolderPath, { isBack: true });
  }, [parentFolderPath, handleNavigateToFolder]);

  const handleNavigateForward = useCallback(async () => {
    if (forwardHistory.length > 0) {
      const next = forwardHistory[forwardHistory.length - 1];
      setForwardHistory(prev => prev.slice(0, -1));
      await handleNavigateToFolder(next, { isForward: true });
    }
  }, [forwardHistory, handleNavigateToFolder]);

  const handleFolderLongPress = useCallback((path) => {
    setSelectedFolders((prev) => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }, []);

  const handleFolderClick = useCallback((folderPath) => {
    if (selectedFolders.size > 0 || selectedImages.size > 0) {
      const currentFiltered = filteredImagesRef.current || [];
      const currentSubfolders = subfoldersRef.current || [];
      const allItems = [
        ...currentSubfolders.map(f => ({ type: 'folder', path: f.path })),
        ...currentFiltered.map(img => ({ type: 'image', path: img.path }))
      ];
      const idx = allItems.findIndex(i => i.path === folderPath);
      if (idx !== -1) {
        keyboardAnchorRef.current = idx;
        keyboardCursorRef.current = idx;
        setKeyboardCursorIndex(idx);
        keyboardSnapshotRef.current = null;
      }

      setSelectedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderPath)) next.delete(folderPath);
        else next.add(folderPath);
        return next;
      });
      return;
    }
    handleNavigateToFolder(folderPath);
  }, [handleNavigateToFolder, selectedFolders.size, selectedImages.size]);

  // ── Folder management ─────────────────────────────────────────────
  const computeNextFolderName = useCallback(() => {
    const numeric = subfolders
      .map((f) => f.name)
      .filter((n) => /^\d+$/.test(n));
    if (numeric.length === 0) return '01';
    const max = Math.max(...numeric.map((n) => parseInt(n, 10)));
    const width = Math.max(2, ...numeric.map((n) => n.length));
    const existing = new Set(subfolders.map((f) => f.name));
    let next = max + 1;
    let name = String(next).padStart(width, '0');
    while (existing.has(name)) {
      next += 1;
      name = String(next).padStart(width, '0');
    }
    return name;
  }, [subfolders]);

  const handleCreateFolder = useCallback(async () => {
    if (!window.electronAPI || !folderPath) return;
    const name = computeNextFolderName();
    const result = await window.electronAPI.createFolder(folderPath, name);
    if (result?.success) {
      if (result.path) invalidateFolderPreview(result.path);
      await loadElectronFolder(folderPath, false);
      if (result.path) setEditingFolderPath(result.path);
    }
  }, [folderPath, computeNextFolderName, loadElectronFolder, invalidateFolderPreview]);

  const handleFolderContextMenu = useCallback((e, folder) => {
    e.preventDefault();
    setFolderMenu({ x: e.clientX, y: e.clientY, folder });
  }, []);

  const handleCloseFolderMenu = useCallback(() => setFolderMenu(null), []);

  const handleRenameFolderCommit = useCallback(async (folder, newName) => {
    setEditingFolderPath(null);
    if (!window.electronAPI || !newName || newName === folder.name) return;
    const result = await window.electronAPI.renameFolder(folder.path, newName);
    if (result?.success) {
      invalidateFolderPreview(folder.path);
      if (result.path) invalidateFolderPreview(result.path);
      await loadElectronFolder(folderPath, false);
    }
  }, [folderPath, loadElectronFolder, invalidateFolderPreview]);

  const handleDeleteFolder = useCallback(async (folder) => {
    if (!window.electronAPI) return;
    const ok = await showConfirm(
      'Delete folder',
      `Move '${folder.name}' to the Recycle Bin? Everything inside it will be moved too.`,
      'Delete'
    );
    if (!ok) return;
    const result = await window.electronAPI.deleteFolder(folder.path);
    if (result?.success) {
      invalidateFolderPreview(folder.path);
      await loadElectronFolder(folderPath, false);
    }
  }, [folderPath, loadElectronFolder, showConfirm, invalidateFolderPreview]);

  const buildFolderMenuItems = useCallback((folder) => [
    { label: 'Rename', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>, onClick: () => setEditingFolderPath(folder.path) },
    { label: 'Delete', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>, danger: true, onClick: () => handleDeleteFolder(folder) },
    { separator: true },
    { label: 'Show in Explorer', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>, onClick: () => window.electronAPI?.showInFolder(folder.path) },
    { label: 'New folder', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>, onClick: () => handleCreateFolder() },
  ], [handleDeleteFolder, handleCreateFolder]);

  // Initial folder from CLI arg (e.g. `app.exe C:\images\foo`)
  useEffect(() => {
    if (!window.electronAPI?.onInitialFolder) return;
    window.electronAPI.onInitialFolder((folder) => {
      if (folder) loadElectronFolder(folder, true, true);
    });
  }, [loadElectronFolder]);

  const handleSelectFolder = useCallback(async () => {
    if (window.electronAPI) {
      try {
        const path = await window.electronAPI.selectFolder();
        if (!path) return;
        await loadElectronFolder(path, true, true);
      } catch (err) {
        console.error('Error selecting folder:', err);
      }
      return;
    }
    if (fileInputRef.current) { fileInputRef.current.value = ''; fileInputRef.current.click(); }
  }, [loadElectronFolder]);

  const handleOpenLastFolder = useCallback(async () => {
    if (!window.electronAPI || !lastFolderPath) return;
    try {
      await loadElectronFolder(lastFolderPath, true, true);
    } catch (err) {
      console.error('Error opening last folder:', err);
      localStorage.removeItem(LAST_FOLDER_KEY);
      setLastFolderPath('');
    }
  }, [lastFolderPath, loadElectronFolder]);

  const handleBrowserFolderSelect = useCallback((event) => {
    const files = Array.from(event.target.files || []).filter((f) => f.type.startsWith('image/'));
    setImages((prev) => {
      prev.forEach((img) => { if (img.previewSrc?.startsWith('blob:')) URL.revokeObjectURL(img.previewSrc); });
      return files.map((file) => ({
        name: file.name,
        path: file.webkitRelativePath || file.name,
        file,
        previewSrc: URL.createObjectURL(file),
        source: 'browser',
      }));
    });
    setFolderPath(files[0]?.webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : 'Browser folder');
    setSelectedImages(new Set());
    setSelectedFolders(new Set());
    setLockedImages(new Set());
    setCurrentPage(1);
  }, []);

  const handleFolderPathEdit = useCallback(async (newPath) => {
    if (!newPath || !window.electronAPI) return;
    await loadElectronFolder(newPath, true, true);
    setShowRecentFolders(false);
  }, [loadElectronFolder]);

  const handleRecentFolderClick = useCallback((folder) => {
    setFolderPath(folder);
    setShowRecentFolders(false);
    loadElectronFolder(folder, true, true);
  }, [loadElectronFolder]);

  // ── Preview modal functions ─────────────────────────────
  const handleOpenPreview = useCallback((image, index) => {
    setPreviewImage(image);
    setPreviewIndex(index);
    setSelectedImages(new Set());
    setSelectedFolders(new Set());
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewImage(null);
    setPreviewIndex(0);
  }, []);

  const handleNextPreview = useCallback(() => {
    if (previewIndex < pagedImages.length - 1) {
      const nextIndex = previewIndex + 1;
      setPreviewIndex(nextIndex);
      setPreviewImage(pagedImages[nextIndex]);
    }
  }, [previewIndex, pagedImages]);

  const handlePrevPreview = useCallback(() => {
    if (previewIndex > 0) {
      const prevIndex = previewIndex - 1;
      setPreviewIndex(prevIndex);
      setPreviewImage(pagedImages[prevIndex]);
    }
  }, [previewIndex, pagedImages]);

  const handleGoToPreview = useCallback((index) => {
    if (index >= 0 && index < pagedImages.length) {
      setPreviewIndex(index);
      setPreviewImage(pagedImages[index]);
    }
  }, [pagedImages]);

  // Delete just the image currently shown in the preview, then advance to the
  // next one (close if it was the last). Locked images are protected.
  const handleDeletePreview = useCallback(async () => {
    const img = previewImage;
    if (!img) return;
    if (lockedImages.has(img.path)) return;
    const proceed = confirmRequired
      ? await showConfirm('Delete', 'Permanently delete this image?')
      : true;
    if (!proceed) return;
    try {
      if (!browserMode) await window.electronAPI.deleteImages([img.path]);
      setImages(prev => prev.filter(i => i.path !== img.path));
      setSelectedImages(prev => { const n = new Set(prev); n.delete(img.path); return n; });

      // Advance to the next image using the current paged snapshot; close if none left.
      const remaining = pagedImages.filter(i => i.path !== img.path);
      if (remaining.length === 0) {
        handleClosePreview();
      } else {
        const nextIdx = Math.min(previewIndex, remaining.length - 1);
        setPreviewIndex(nextIdx);
        setPreviewImage(remaining[nextIdx]);
      }
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Delete failed. Check console for details.');
    }
  }, [previewImage, previewIndex, pagedImages, lockedImages, confirmRequired,
      showConfirm, browserMode, handleClosePreview]);

  // Save a cropped image as a new file next to the original, refresh the grid,
  // and open the freshly-cropped image in the preview so the result is visible.
  const handleSaveCrop = useCallback(async (originalPath, dataUrl) => {
    if (!window.electronAPI?.saveCroppedImage) {
      return { success: false, error: 'Crop saving is unavailable — fully restart the app (quit and re-launch) so the updated Electron backend loads.' };
    }
    const result = await window.electronAPI.saveCroppedImage({ originalPath, dataUrl });
    if (result?.success) {
      // Show the crop instantly from the in-memory data URL — no disk re-read,
      // no waiting on a full folder rescan.
      const name = result.path.split(/[\\/]/).pop();
      setPreviewImage({ name, path: result.path, previewSrc: dataUrl, source: 'electron' });
      // Refresh the grid in the background so the new file appears there too.
      if (folderPath) {
        loadElectronFolder(folderPath, false).then((mapped) => {
          const idx = mapped ? mapped.findIndex((img) => img.path === result.path) : -1;
          if (idx >= 0) setPreviewIndex(idx);
        });
      }
    }
    return result;
  }, [folderPath, loadElectronFolder]);

  const handleToggleShortcuts = useCallback(() => {
    setShowShortcuts(prev => !prev);
  }, []);

  const handleToggleSubfolderBar = useCallback(() => {
    setSubfolderBarPinned(prev => {
      if (!prev) setSubfolderBarVisible(true);
      return !prev;
    });
  }, []);

  const handleImageFitModeChange = useCallback((mode) => {
    setImageFitMode(mode);
  }, []);

  
  const handleDragSelectEnabledChange = useCallback((enabled) => {
    setDragSelectEnabled(enabled);
  }, []);

  // ── Single toggle ───────────────────────────────────────────────
  const handleToggleImage = useCallback((imagePath) => {
    if (orderSelectMode) {
      setOrderedSelection(prev => {
        const idx = prev.indexOf(imagePath);
        if (idx === -1) return [...prev, imagePath];
        return prev.filter(p => p !== imagePath);
      });
      return;
    }

    const currentFiltered = filteredImagesRef.current || [];
    const currentSubfolders = subfoldersRef.current || [];
    const allItems = [
      ...currentSubfolders.map(f => ({ type: 'folder', path: f.path })),
      ...currentFiltered.map(img => ({ type: 'image', path: img.path }))
    ];
    const idx = allItems.findIndex(i => i.path === imagePath);
    const isAdding = !selectedImages.has(imagePath);
    if (idx !== -1) {
      if (isAdding) {
        keyboardAnchorRef.current = idx;
        keyboardSnapshotRef.current = null;
      }
      keyboardCursorRef.current = idx;
      setKeyboardCursorIndex(idx);
    }

    setSelectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(imagePath)) next.delete(imagePath); else next.add(imagePath);
      return next;
    });
  }, [orderSelectMode]);

  // ── Select all / deselect ───────────────────────────────────────
  // Selects images currently visible on the page; toggles off when all are selected.
  const handleSelectAll = useCallback(() => {
    const pagePaths = pagedImages.map(img => img.path);
    if (pagePaths.length === 0) return;
    const allOnPageSelected = pagePaths.every(p => selectedImages.has(p));
    setSelectedImages(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) pagePaths.forEach(p => next.delete(p));
      else pagePaths.forEach(p => next.add(p));
      return next;
    });
  }, [pagedImages, selectedImages]);

  const handleDeselectAll = useCallback(() => {
    setSelectedImages(new Set());
    setSelectedFolders(new Set());
  }, []);

  // ── Lock/Unlock functionality ─────────────────────────────────────
  const handleToggleLock = useCallback((imagePath) => {
    setLockedImages((prev) => {
      const next = new Set(prev);
      if (next.has(imagePath)) next.delete(imagePath); else next.add(imagePath);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e, image) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, image });
  }, []);

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), []);

  const handleLockSelected = useCallback(() => {
    selectedImages.forEach((imagePath) => {
      setLockedImages((prev) => {
        const next = new Set(prev);
        next.add(imagePath);
        return next;
      });
    });
    // Unselect all images after locking them
    handleDeselectAll();
  }, [selectedImages, handleDeselectAll]);

  const handleUnlockSelected = useCallback(() => {
    selectedImages.forEach((imagePath) => {
      setLockedImages((prev) => {
        const next = new Set(prev);
        next.delete(imagePath);
        return next;
      });
    });
  }, [selectedImages]);

  // ── Order-select mode ──────────────────────────────────────────
  const handleSetOrderSelectMode = useCallback((enabled) => {
    setOrderSelectMode(enabled);
    if (!enabled) setOrderedSelection([]);
  }, []);

  const handleRenameByOrder = useCallback(async (prefix, digits) => {
    if (!window.electronAPI || orderedSelection.length === 0) return;
    const renames = orderedSelection.map((imgPath, i) => {
      const ext = imgPath.slice(imgPath.lastIndexOf('.'));
      return { oldPath: imgPath, newName: `${prefix}${String(i + 1).padStart(digits, '0')}${ext}` };
    });
    try {
      await window.electronAPI.renameImages(renames);
      setOrderedSelection([]);
      setOrderSelectMode(false);
      await loadElectronFolder(folderPath, false);
    } catch (err) {
      console.error('Rename failed:', err);
    }
  }, [orderedSelection, folderPath, loadElectronFolder]);

  // ── Photoshop ──────────────────────────────────────────────────
  const handleSetPhotoshopPath = useCallback((p) => {
    setPhotoshopPath(p);
    localStorage.setItem('photoshopPath', p);
  }, []);

  const handleOpenInPhotoshop = useCallback(() => {
    if (!photoshopPath || selectedImages.size === 0) return;
    window.electronAPI.openInApp([...selectedImages], photoshopPath);
  }, [photoshopPath, selectedImages]);

  // ── Move selected to folder ────────────────────────────────────
  const handleMoveSelected = useCallback(async () => {
    if (!window.electronAPI || selectedImages.size === 0) return;
    const dest = await window.electronAPI.selectFolder();
    if (!dest) return;
    if (dest === folderPath) return;
    const movable = images.filter(img => selectedImages.has(img.path) && !lockedImages.has(img.path));
    if (movable.length === 0) return;
    const proceed = confirmRequired
      ? await showConfirm('Move', `Move ${movable.length} image${movable.length > 1 ? 's' : ''} to:\n${dest}`, 'Move', false)
      : true;
    if (!proceed) return;
    setIsMoving(true);
    setMoveProgress({ current: 0, total: movable.length });
    try {
      const result = await window.electronAPI.moveImages(movable.map(i => i.path), dest);
      const movedSet = new Set(result.moved);
      setImages(prev => prev.filter(img => !movedSet.has(img.path)));
      setSelectedImages(new Set());
      if (result.failed && result.failed.length > 0) {
        console.error('Some moves failed:', result.failed);
      }
    } catch (err) {
      console.error('Move failed:', err);
    } finally {
      setIsMoving(false);
      setMoveProgress({ current: 0, total: 0 });
    }
  }, [selectedImages, images, lockedImages, folderPath, confirmRequired, showConfirm]);

  // ── Copy selected to folder ────────────────────────────────────
  const handleCopySelected = useCallback(async () => {
    if (!window.electronAPI || selectedImages.size === 0) return;
    const dest = await window.electronAPI.selectFolder();
    if (!dest) return;
    const filePaths = [...selectedImages].filter(p => !lockedImages.has(p));
    if (filePaths.length === 0) return;
    setIsCopying(true);
    setCopyProgress({ current: 0, total: filePaths.length });
    window.electronAPI.onCopyProgress(data => setCopyProgress(data));
    try {
      await window.electronAPI.copyImages(filePaths, dest);
    } catch (err) {
      console.error('Copy failed:', err);
    } finally {
      window.electronAPI.removeCopyListeners();
      setIsCopying(false);
      setCopyProgress({ current: 0, total: 0 });
    }
  }, [selectedImages, lockedImages]);

  // ── Export selected paths to .txt ─────────────────────────────
  const handleExportPaths = useCallback(async () => {
    const paths = [...selectedImages];
    if (paths.length === 0) return;
    await window.electronAPI.exportPaths(paths);
  }, [selectedImages]);

  // ── Batch auto-crop to face ────────────────────────────────────
  // Open the modal for the current selection (minus locked), or a single image.
  const handleOpenAutoCrop = useCallback((image) => {
    const isSelected = image && selectedImages.has(image.path);
    const base = isSelected && selectedImages.size > 1 ? [...selectedImages] : (image ? [image.path] : [...selectedImages]);
    const paths = base.filter(p => !lockedImages.has(p));
    if (paths.length === 0) return;
    setAutoCropResult(null);
    setAutoCropProgress({ current: 0, total: 0, text: '' });
    setAutoCropModal({ paths });
  }, [selectedImages, lockedImages]);

  // Crop one file to a data URL (fractions rect) using the same canvas pipeline
  // as the preview modal's Apply, then hand it to saveCroppedImage.
  const cropFileToDataUrl = useCallback(async (filePath, name, box, ratio) => {
    const base64 = await window.electronAPI.getImageData(filePath);
    if (!base64) return null;
    const ext = (name || '').toLowerCase().split('.').pop();
    const mime = ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : ext === 'bmp' ? 'image/bmp'
      : 'image/jpeg';
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = `data:${mime};base64,${base64}`;
    });
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const rect = boxToCropRect({ box, ratio, natW, natH });
    const sx = Math.round(rect.x * natW);
    const sy = Math.round(rect.y * natH);
    const sw = Math.max(1, Math.round(rect.w * natW));
    const sh = Math.max(1, Math.round(rect.h * natH));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const isJpg = ext === 'jpg' || ext === 'jpeg';
    return isJpg ? canvas.toDataURL('image/jpeg', 0.95) : canvas.toDataURL('image/png');
  }, []);

  const handleAutoCropFace = useCallback(async (ratio) => {
    const paths = autoCropModal?.paths || [];
    if (paths.length === 0 || !window.electronAPI?.detectFaces) return;
    setAutoCropRunning(true);
    setAutoCropResult(null);

    // Phase 1: detection (Python loads the model once, streams progress).
    let detected = 0;
    setAutoCropProgress({ current: 0, total: paths.length, text: 'Detecting faces…' });
    window.electronAPI.onDetectProgress?.((p) => {
      if (p.type === 'status') setAutoCropProgress(prev => ({ ...prev, text: p.text }));
      else if (p.type === 'done') setAutoCropProgress(prev => ({ ...prev, current: ++detected, text: 'Detecting faces…' }));
    });

    let boxes;
    try {
      boxes = await window.electronAPI.detectFaces(paths);
    } catch (err) {
      window.electronAPI.removeDetectListeners?.();
      setAutoCropResult({ cropped: 0, skipped: 0, failed: 0, error: err.message });
      setAutoCropRunning(false);
      return;
    }
    window.electronAPI.removeDetectListeners?.();

    // Phase 2: crop + save (JS canvas → saveCroppedImage), sequential.
    const nameOf = (p) => p.split(/[\\/]/).pop();
    let cropped = 0, skipped = 0, failed = 0;
    const withFace = paths.filter(p => boxes?.[p]);
    setAutoCropProgress({ current: 0, total: withFace.length, text: 'Cropping…' });
    for (const p of paths) {
      const box = boxes?.[p];
      if (!box) { skipped++; continue; }
      try {
        const dataUrl = await cropFileToDataUrl(p, nameOf(p), box, ratio);
        const result = dataUrl && await window.electronAPI.saveCroppedImage({ originalPath: p, dataUrl });
        if (result?.success) cropped++; else failed++;
      } catch (err) {
        console.error('Auto-crop failed for', p, err);
        failed++;
      }
      setAutoCropProgress(prev => ({ ...prev, current: cropped + failed, text: 'Cropping…' }));
    }

    setAutoCropResult({ cropped, skipped, failed });
    setAutoCropRunning(false);
    setSelectedImages(new Set());
    if (folderPath) await loadElectronFolder(folderPath, false);
  }, [autoCropModal, cropFileToDataUrl, folderPath, loadElectronFolder]);

  const handleCloseAutoCrop = useCallback(() => {
    if (autoCropRunning) return;
    setAutoCropModal(null);
    setAutoCropResult(null);
    setAutoCropProgress({ current: 0, total: 0, text: '' });
  }, [autoCropRunning]);

  // ── Invert selection (across all filtered images) ─────────────
  const handleInvertSelection = useCallback(() => {
    setSelectedImages(prev => {
      const next = new Set();
      for (const img of filteredImages) {
        if (!prev.has(img.path)) next.add(img.path);
      }
      return next;
    });
  }, [filteredImages]);

  // ── Select all filtered images across all pages ───────────────
  const handleSelectAllFiltered = useCallback(() => {
    setSelectedImages(prev => {
      const allSelected = filteredImages.every(img => prev.has(img.path));
      return allSelected ? new Set() : new Set(filteredImages.map(img => img.path));
    });
  }, [filteredImages]);

  // ── Bulk rename ────────────────────────────────────────────────
  const handleOpenBulkRename = useCallback(() => {
    if (selectedImages.size === 0) return;
    const orderedSelected = filteredImages.filter(img => selectedImages.has(img.path));
    setRenameModal({ images: orderedSelected });
  }, [selectedImages, filteredImages]);

  const handleConfirmBulkRename = useCallback(async (prefix, startN, digits) => {
    if (!renameModal) return;
    const renames = renameModal.images.map((img, i) => {
      const ext = img.name.slice(img.name.lastIndexOf('.'));
      return { oldPath: img.path, newName: `${prefix}${String(startN + i).padStart(digits, '0')}${ext}` };
    });
    setRenameModal(null);
    try {
      await window.electronAPI.renameImages(renames);
      setSelectedImages(new Set());
      await loadElectronFolder(folderPath, false);
    } catch (err) {
      console.error('Bulk rename failed:', err);
    }
  }, [renameModal, folderPath, loadElectronFolder]);

  // ── AI character scan ──────────────────────────────────────────
  const handleAIScan = useCallback(async (threshold, characters, gate) => {
    const paths = filteredImagesRef.current.map(i => i.path);
    if (paths.length === 0 || !characters?.length) return;

    setScanning(true);
    setAiThreshold(threshold);
    setAiScores({});
    setSelectedImages(new Set());
    setScanProgress({ done: 0, total: paths.length });

    // Register once — covers main scan + all tail batches
    window.electronAPI.onScanProgress((data) => {
      if (data.type === 'status') {
        setScanStatus(data.text);
      } else if (data.type === 'scanning') {
        setScanStatus('');
        setScanningPath(data.path);
      } else if (data.type === 'done') {
        setScanningPath(null);
        setScanProgress(p => ({ ...p, done: p.done + 1 }));
        if (data.score != null) {
          setAiScores(prev => ({ ...prev, [data.path]: { score: data.score, character: data.character } }));
          if (data.score >= threshold) {
            setSelectedImages(prev => { const s = new Set(prev); s.add(data.path); return s; });
          }
        }
      }
    });

    try {
      const folder      = folderPathRef.current;
      const scannedPaths = new Set(paths);
      await window.electronAPI.scanCharacter(paths, characters, gate);

      // Tail phase: poll filesystem every 500 ms; stop after 1 s of idle
      let idleSince = Date.now();
      while (folder && Date.now() - idleSince < 1000) {
        await new Promise(r => setTimeout(r, 500));
        const current  = await window.electronAPI.getImages(folder) || [];
        const newPaths = current.map(i => i.path).filter(p => !scannedPaths.has(p));
        if (newPaths.length > 0) {
          idleSince = Date.now();
          newPaths.forEach(p => scannedPaths.add(p));
          setScanProgress(prev => ({ ...prev, total: prev.total + newPaths.length }));
          setScanStatus('');
          await window.electronAPI.scanCharacter(newPaths, characters, gate);
        } else {
          setScanStatus('Watching…');
        }
      }
    } catch (err) {
      console.error('AI scan failed:', err);
      alert(`AI scan failed: ${err.message}`);
    } finally {
      window.electronAPI.removeScanListeners();
      setScanningPath(null);
      setScanStatus('');
      setScanning(false);
      setScanProgress({ done: 0, total: 0 });
    }
  }, []);

  const handleClearAiScores = useCallback(() => {
    setAiScores({});
  }, []);

  const handleAddToRefs = useCallback(async (imagePaths) => {
    if (!window.electronAPI?.addToRefs || !activeCharacter) return;
    await window.electronAPI.addToRefs({ imagePaths, character: activeCharacter });
    setProfilesVersion(v => v + 1);
  }, [activeCharacter]);

  // Toolbar shortcut: add the current selection as references in one click
  const handleUseSelectedAsRefs = useCallback(() => {
    if (selectedImages.size === 0) return;
    handleAddToRefs([...selectedImages]);
  }, [selectedImages, handleAddToRefs]);

  const handleNavigateFolder = useCallback((delta) => {
    if (!folderPath) return;
    const sep = folderPath.includes('\\') ? '\\' : '/';
    const lastSep = folderPath.lastIndexOf(sep);
    const parent = folderPath.slice(0, lastSep);
    const name   = folderPath.slice(lastSep + 1);
    const match  = name.match(/^(.*?)(\d+)$/);
    if (!match) return;
    const [, prefix, numStr] = match;
    const next = parseInt(numStr, 10) + delta;
    if (next < 0) return;
    const newName = prefix + String(next).padStart(numStr.length, '0');
    handleNavigateToFolder(parent + sep + newName);
  }, [folderPath, handleNavigateToFolder]);

  const handleClearRefs = useCallback(async (character) => {
    if (!window.electronAPI?.clearRefs) return;
    await window.electronAPI.clearRefs(character);
    setProfilesVersion(v => v + 1);
  }, []);

  // ── Auto-reload toggle ─────────────────────────────────────────────────────
  const handleAutoReloadChange = useCallback((enabled) => {
    setAutoReloadEnabled(enabled);
    localStorage.setItem('autoReloadEnabled', String(enabled));
  }, []);

  // ── Range select (Shift+Click) ────────────────────────────────
  const handleShiftSelectRange = useCallback((startIdx, endIdx) => {
    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);
    const folderCount = subfoldersRef.current?.length || 0;
    
    keyboardCursorRef.current = endIdx + folderCount;
    setKeyboardCursorIndex(keyboardCursorRef.current);
    // We intentionally DO NOT update keyboardAnchorRef.current here so shift-arrow continues from the original anchor.

    setSelectedImages((prev) => {
      if (!keyboardSnapshotRef.current) {
        keyboardSnapshotRef.current = { images: new Set(prev), folders: new Set(selectedFolders) };
      }
      const next = new Set(keyboardSnapshotRef.current.images);
      pagedImages.slice(min, max + 1).forEach((img) => next.add(img.path));
      return next;
    });
  }, [pagedImages, selectedFolders]);

  // ── Range select (drag — Google Drive style) ──────────────────
  const handleSetRangeSelectedFinal = useCallback((startIdx, endIdx, mode, snapshot) => {
    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);
    const folderCount = subfoldersRef.current?.length || 0;
    
    keyboardCursorRef.current = endIdx + folderCount;
    setKeyboardCursorIndex(keyboardCursorRef.current);
    if (mode === 'select') {
      keyboardAnchorRef.current = startIdx + folderCount;
      keyboardSnapshotRef.current = null;
    }

    const next = new Set(snapshot);
    pagedImages.slice(min, max + 1).forEach((img) => {
      if (mode === 'select') next.add(img.path);
      else next.delete(img.path);
    });
    setSelectedImages(next);
  }, [pagedImages]);

  // ── Delete selected ─────────────────────────────────────────────
  const handleDeleteSelected = useCallback(async () => {
    if (selectedImages.size === 0 && selectedFolders.size === 0) return;
    
    const imageList = selectedImages.size === images.length ? images : images.filter(img => selectedImages.has(img.path));
    const safeImages = imageList.filter(img => !lockedImages.has(img.path));
    const folderList = Array.from(selectedFolders);
    
    if (safeImages.length === 0 && folderList.length === 0) return;
    
    let message = '';
    if (safeImages.length > 0 && folderList.length > 0) {
      message = `Permanently delete ${safeImages.length} image${safeImages.length > 1 ? 's' : ''} and ${folderList.length} folder${folderList.length > 1 ? 's' : ''}?`;
    } else if (safeImages.length > 0) {
      message = `Permanently delete ${safeImages.length} image${safeImages.length > 1 ? 's' : ''}?`;
    } else {
      message = `Permanently delete ${folderList.length} folder${folderList.length > 1 ? 's' : ''}?`;
    }

    const proceed = confirmRequired ? await showConfirm('Delete', message) : true;
    if (!proceed) return;
    
    // Find the index of the last selected image to determine where to scroll
    const selectedIndices = Array.from(selectedImages).map(path => images.findIndex(img => img.path === path)).sort((a, b) => a - b);
    const lastSelectedIndex = selectedIndices[selectedIndices.length - 1];
    
    setIsDeleting(true);
    setDeleteProgress({ current: 0, total: safeImages.length + folderList.length });
    try {
      if (browserMode) {
        // Browser mode - just remove from state
        await new Promise(resolve => setTimeout(resolve, 300)); // Simulate operation
        setImages(prev => prev.filter(img => !selectedImages.has(img.path)));
      } else {
        // Electron mode - delete files and folders
        if (safeImages.length > 0) {
          await window.electronAPI.deleteImages(safeImages.map(img => img.path));
          setImages(prev => prev.filter(img => !selectedImages.has(img.path)));
        }
        if (folderList.length > 0) {
          for (const path of folderList) {
            await window.electronAPI.deleteFolder(path);
          }
          await loadElectronFolder(folderPath, false); // Reload to refresh folders
        }
      }
      setSelectedImages(new Set());
      setSelectedFolders(new Set());
      
      // Scroll to the image that comes after the last selected image
      setTimeout(() => {
        const newGrid = gridRef.current;
        const newViewport = newGrid?.getViewport();
        if (newViewport && typeof newGrid.scrollTo === 'function') {
          const remainingImages = images.length - selectedImages.size;
          
          if (remainingImages === 0) {
            // All images deleted - scroll to top
            newGrid.scrollToTop();
          } else {
            // Find the image after the last selected one in the new array
            const newImages = images.filter(img => !selectedImages.has(img.path));
            const targetIndex = Math.min(lastSelectedIndex, newImages.length - 1);
            
            if (targetIndex >= 0) {
              // Calculate scroll position to show the target image
              const itemHeight = previewSize + 10; // 10px gap
              const targetScrollTop = targetIndex * itemHeight;
              newGrid.scrollTo({ top: targetScrollTop });
            }
          }
        }
      }, 100);
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Delete failed. Check console for details.');
    } finally {
      setIsDeleting(false);
      setDeleteProgress({ current: 0, total: 0 });
    }
  }, [selectedImages, selectedFolders, images, lockedImages, confirmRequired, showConfirm, browserMode, previewSize]);

  // ── Keep selected, delete rest (current page only) ──────────────
  const handleKeepSelected = useCallback(async () => {
    if (selectedImages.size === 0) return;
    if (!window.electronAPI) return;

    // Find the index of the last selected image to scroll to it
    const selectedIndices = Array.from(selectedImages).map(path => images.findIndex(img => img.path === path)).sort((a, b) => a - b);
    const lastSelectedIndex = selectedIndices[selectedIndices.length - 1];

    const pageStart = (currentPage - 1) * pageSize;
    const currentPageImages = images.slice(pageStart, pageStart + pageSize);
    const toDelete = currentPageImages.filter((img) => 
      !selectedImages.has(img.path) && !lockedImages.has(img.path)
    );

    if (toDelete.length === 0) return;

    const lockedCount = currentPageImages.filter((img) => 
      !selectedImages.has(img.path) && lockedImages.has(img.path)
    ).length;

    let confirmMessage = `Delete ${toDelete.length} unselected image${toDelete.length !== 1 ? 's' : ''} from page ${currentPage}?`;
    if (lockedCount > 0) {
      confirmMessage += `\n\n${lockedCount} locked image${lockedCount !== 1 ? 's' : ''} will be preserved.`;
    }
    confirmMessage += '\n\nImages on other pages will NOT be affected.';

    if (confirmRequired) {
      const ok = await showConfirm(
        'Keep Selected · Delete Rest',
        confirmMessage,
        'Delete'
      );
      if (!ok) return;
    }

    setLoading(true);
    setIsDeleting(true);
    setDeleteProgress({ current: 0, total: toDelete.length });
    try {
      const toDeletePaths = new Set(toDelete.map((img) => img.path));
      const result = await window.electronAPI.deleteImages(Array.from(toDeletePaths));
      if (result.success) {
        setImages((prev) => prev.filter((img) => !toDeletePaths.has(img.path)));
        setSelectedImages(new Set());
        
        // Scroll to the last selected image
        setTimeout(() => {
          const newGrid = gridRef.current;
          const newViewport = newGrid?.getViewport();
          if (newViewport && typeof newGrid.scrollTo === 'function') {
            const remainingOnPage = currentPageImages.filter(img => !toDeletePaths.has(img.path)).length;
            
            if (remainingOnPage === 0) {
              // Current page is now empty - scroll to top
              newGrid.scrollToTop();
            } else {
              // Find the last selected image in the new array and scroll to it
              const newImages = images.filter(img => !toDeletePaths.has(img.path));
              const lastSelectedInNewArray = newImages.findIndex(img => selectedImages.has(img.path));
              
              if (lastSelectedInNewArray >= 0) {
                // Calculate scroll position to show the last selected image
                const itemHeight = previewSize + 10; // 10px gap
                const targetScrollTop = lastSelectedInNewArray * itemHeight;
                newGrid.scrollTo({ top: targetScrollTop });
              }
            }
          }
        }, 100);
      }
    } catch (err) {
      console.error('Error deleting:', err);
    } finally {
      setLoading(false);
      setIsDeleting(false);
      setDeleteProgress({ current: 0, total: 0 });
    }
  }, [selectedImages, images, currentPage, pageSize, confirmRequired, showConfirm, lockedImages, previewSize]);

  // ── Pagination ──────────────────────────────────────────────────
  const handlePrevPage = useCallback(() => setCurrentPage((p) => Math.max(1, p - 1)), []);
  const handleNextPage = useCallback(() => setCurrentPage((p) => Math.min(totalPages, p + 1)), [totalPages]);
  const handlePageSizeChange = useCallback((n) => { setPageSize(n); setCurrentPage(1); }, []);
  const handlePreviewSizeChange = useCallback((n) => setPreviewSize(clamp(n)), []);
  const handlePreviewPresetChange = useCallback((n) => setPreviewSize(clamp(n)), []);

  const handleConfirmRequiredChange = useCallback((val) => {
    setConfirmRequired(val);
    localStorage.setItem(CONFIRM_REQUIRED_KEY, String(val));
  }, []);

  const globalActions = useMemo(() => {
    const actions = [
      { id: 'view-grid', name: 'ls -l', subtitle: 'Switch to thumbnail grid layout', shortcut: ['V'], onExecute: () => { setViewMode('grid'); localStorage.setItem('viewMode', 'grid'); } },
      { id: 'view-list', name: 'ls', subtitle: 'Switch to compact list layout', shortcut: ['V'], onExecute: () => { setViewMode('list'); localStorage.setItem('viewMode', 'list'); } },
      { id: 'view-explorer', name: 'explorer', subtitle: 'Mixed folders + images thumbnail view', shortcut: ['V'], onExecute: () => { setViewMode('explorer'); localStorage.setItem('viewMode', 'explorer'); }, keywords: ['tree', 'mixed'] },
      { id: 'view-thumb', name: 'ls --thumbs', subtitle: 'Show/hide thumbnails in list view', shortcut: ['T'], onExecute: () => setListDetail(prev => prev === 'thumb' ? 'plain' : 'thumb') },
      { id: 'view-fit', name: 'fit --toggle', subtitle: 'Switch between Contain and Cover', shortcut: ['T'], onExecute: () => setImageFitMode(prev => prev === 'contain' ? 'cover' : 'contain') },
      { id: 'select-all', name: 'select *', subtitle: 'Select all images currently visible', shortcut: ['⌘', 'A'], onExecute: handleSelectAll },
      { id: 'deselect-all', name: 'clear', subtitle: 'Clear your current selection', shortcut: ['Esc'], onExecute: handleDeselectAll },
      { id: 'invert-selection', name: 'select --invert', subtitle: 'Select unselected, deselect selected', shortcut: ['I'], onExecute: handleInvertSelection },
      { id: 'copy-selected', name: 'cp', subtitle: 'Copy selected images to another folder', shortcut: ['C'], onExecute: handleCopySelected },
      { id: 'move-selected', name: 'mv', subtitle: 'Move selected images to another folder', shortcut: ['M'], onExecute: handleMoveSelected },
      { id: 'delete-selected', name: 'rm', subtitle: 'Move selected images to trash', shortcut: ['Del'], onExecute: handleDeleteSelected },
      { id: 'keep-selected', name: 'rm --inverse', subtitle: 'Delete all unselected images', shortcut: ['⇧', 'Del'], onExecute: handleKeepSelected },
      { id: 'lock-selected', name: 'chmod +r', subtitle: 'Prevent selected images from being deleted', shortcut: ['L'], onExecute: handleLockSelected },
      { id: 'unlock-selected', name: 'chmod -r', subtitle: 'Allow selected images to be deleted', shortcut: ['⇧', 'L'], onExecute: handleUnlockSelected },
      { id: 'bulk-rename', name: 'rename', subtitle: 'Sequentially rename selected images', shortcut: ['R'], onExecute: handleOpenBulkRename },
      { id: 'open-photoshop', name: 'open -a Photoshop', subtitle: 'Send selected images to Photoshop', shortcut: ['P'], onExecute: handleOpenInPhotoshop },
      { id: 'use-as-ref', name: 'export --ref', subtitle: 'Add selected to AI references', shortcut: ['F'], onExecute: handleUseSelectedAsRefs },
      { id: 'toggle-ai', name: 'ai --toggle', subtitle: 'Open or close the AI character scanner', shortcut: ['A'], onExecute: () => setShowAIScan(p => !p) },
      { id: 'toggle-drag-select', name: 'set drag_select toggle', subtitle: 'Enable/disable click-and-drag selection', shortcut: ['D'], onExecute: () => setDragSelectEnabled(p => !p) },
      { id: 'toggle-order-select', name: 'set order_select toggle', subtitle: 'Click images in sequence to rename', shortcut: ['O'], onExecute: () => setOrderSelectMode(p => !p) },
      { id: 'sort-name', name: 'sort -n', subtitle: 'Order images alphabetically', onExecute: () => { setSortBy('name'); setSortDir('asc'); } },
      { id: 'sort-date', name: 'sort -t', subtitle: 'Order images by modified time', onExecute: () => { setSortBy('date'); setSortDir('desc'); } },
      { id: 'sort-size', name: 'sort -s', subtitle: 'Order images by file size', onExecute: () => { setSortBy('size'); setSortDir('desc'); } },
      { id: 'open-drive', name: 'mount gdrive', subtitle: 'Pick a dataset from your Drive', onExecute: () => document.querySelector('.drive-btn')?.click() },
      { id: 'open-folder', name: 'cd', subtitle: 'Browse your computer for a folder', onExecute: handleSelectFolder },
    ];
    // Filter out actions requiring selection if none selected
    return actions.filter(a => {
      if (['copy-selected', 'move-selected', 'delete-selected', 'keep-selected', 'lock-selected', 'unlock-selected', 'bulk-rename', 'open-photoshop', 'use-as-ref'].includes(a.id)) {
        return selectedImages.size > 0;
      }
      return true;
    });
  }, [
    setViewMode, setListDetail, setImageFitMode, handleSelectAll, handleDeselectAll, handleInvertSelection,
    handleCopySelected, handleMoveSelected, handleDeleteSelected, handleKeepSelected, handleLockSelected, handleUnlockSelected,
    handleOpenBulkRename, handleOpenInPhotoshop, handleUseSelectedAsRefs, setDragSelectEnabled, setOrderSelectMode,
    setSortBy, setSortDir, handleSelectFolder, selectedImages.size
  ]);

  // ── Keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      // Command Palette
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setShowCommandPalette(p => !p);
        return;
      }

      // Open Google Drive Panel
      if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        document.querySelector('.drive-btn')?.click();
        return;
      }

      // Ignore standard single-key shortcuts if user is typing
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // While the preview modal is open it owns the keyboard; the grid ignores
      // everything so shortcuts can't act on the selection behind the modal.
      if (previewImage) return;

      if (e.key === 'Escape') {
        if (showCommandPalette) {
          setShowCommandPalette(false);
          return;
        }
        handleDeselectAll();
        return;
      }

      const navigateSelection = (delta, extend = false) => {
        const currentSubfolders = subfoldersRef.current || [];
        const currentFiltered = filteredImagesRef.current || [];
        const allItems = [
          ...currentSubfolders.map(f => ({ type: 'folder', path: f.path })),
          ...currentFiltered.map(img => ({ type: 'image', path: img.path }))
        ];
        if (allItems.length === 0) return;

        const totalSelected = selectedImages.size + selectedFolders.size;
        let currentIndex = keyboardCursorRef.current !== null ? keyboardCursorRef.current : -1;
        
        // If nothing is selected, forget the old cursor and start from the beginning/end
        if (totalSelected === 0) {
          currentIndex = -1;
        }

        if (currentIndex === -1) {
          if (selectedImages.size > 0) {
            const lastImage = Array.from(selectedImages).pop();
            currentIndex = allItems.findIndex(item => item.path === lastImage);
          } else if (selectedFolders.size > 0) {
            const lastFolder = Array.from(selectedFolders).pop();
            currentIndex = allItems.findIndex(item => item.path === lastFolder);
          }
        }

        let nextIndex = 0;
        if (currentIndex !== -1) {
          nextIndex = currentIndex + delta;
          if (nextIndex < 0) nextIndex = 0;
          if (nextIndex >= allItems.length) nextIndex = allItems.length - 1;
        } else if (delta < 0) {
          nextIndex = allItems.length - 1;
        }

        const nextItem = allItems[nextIndex];
        keyboardCursorRef.current = nextIndex;
        setKeyboardCursorIndex(nextIndex);

        if (extend && keyboardAnchorRef.current !== null && keyboardAnchorRef.current !== -1) {
          if (!keyboardSnapshotRef.current) {
            keyboardSnapshotRef.current = { images: new Set(selectedImages), folders: new Set(selectedFolders) };
          }
          const min = Math.min(keyboardAnchorRef.current, nextIndex);
          const max = Math.max(keyboardAnchorRef.current, nextIndex);
          const nextImages = new Set(keyboardSnapshotRef.current.images);
          const nextFolders = new Set(keyboardSnapshotRef.current.folders);
          for (let i = min; i <= max; i++) {
            const item = allItems[i];
            if (item.type === 'folder') nextFolders.add(item.path);
            else nextImages.add(item.path);
          }
          setSelectedFolders(nextFolders);
          setSelectedImages(nextImages);
        } else {
          keyboardSnapshotRef.current = null;
          
          if (totalSelected > 1) {
            // Pre-select state behavior: when multiple items are selected, 
            // normal arrow keys move the cursor AND the anchor, but do NOT change the selection.
            // This ensures that a subsequent Shift+Arrow starts the new selection from here!
            keyboardAnchorRef.current = nextIndex;
          } else {
            keyboardAnchorRef.current = nextIndex;
            if (nextItem.type === 'folder') {
              setSelectedFolders(new Set([nextItem.path]));
              setSelectedImages(new Set());
            } else {
              setSelectedImages(new Set([nextItem.path]));
              setSelectedFolders(new Set());
            }
          }
        }
      };

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedImages.size > 0 || selectedFolders.size > 0) {
          e.preventDefault();
          if (e.shiftKey) handleKeepSelected(); else handleDeleteSelected();
        }
      } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) {
          handleOpenLastFolder();
        } else {
          if (selectedFolders.size > 0) {
            const folderPath = Array.from(selectedFolders).pop();
            handleNavigateToFolder(folderPath);
          } else if (selectedImages.size > 0) {
            const imagePath = Array.from(selectedImages).pop();
            const index = filteredImagesRef.current?.findIndex(img => img.path === imagePath);
            if (index !== undefined && index >= 0) {
              handleOpenPreview(filteredImagesRef.current[index], index);
            }
          }
        }
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (e.shiftKey) handleUnlockSelected(); else handleLockSelected();

      } else if (e.key === 'ArrowLeft' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleNavigateUp();
      } else if (e.key === 'ArrowRight' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleNavigateForward();
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const hasSelection = selectedImages.size > 0 || selectedFolders.size > 0;
        if (!hasSelection) {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            handleNavigateFolder(e.key === 'ArrowRight' ? 1 : -1);
          }
        } else {
          e.preventDefault();
          const cols = gridRef.current?.getCols?.() || 1;
          let delta = 0;
          if (e.key === 'ArrowRight') delta = 1;
          else if (e.key === 'ArrowLeft') delta = -1;
          else if (e.key === 'ArrowDown') delta = cols;
          else if (e.key === 'ArrowUp') delta = -cols;
          
          navigateSelection(delta, e.shiftKey);
        }
      } else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSelectAll();
      } else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (selectedImages.size > 0) handleCopySelected();
      } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (selectedImages.size > 0) handleMoveSelected();
      } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (selectedImages.size > 0) handleOpenBulkRename();
      } else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (selectedImages.size > 0) handleUseSelectedAsRefs();
      } else if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (selectedImages.size > 0) handleOpenInPhotoshop();
      } else if (e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleInvertSelection();
      } else if (e.key === '1' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setPreviewSize(120);
      } else if (e.key === '2' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setPreviewSize(170);
      } else if (e.key === '3' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setPreviewSize(230);
      } else if (e.key === '4' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setPreviewSize(280);
      } else if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setViewMode(prev => {
          const order = ['grid', 'list', 'explorer'];
          const next = order[(order.indexOf(prev) + 1) % order.length];
          localStorage.setItem('viewMode', next);
          return next;
        });
      } else if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (viewMode === 'list') {
          setListDetail(prev => {
            const next = prev === 'thumb' ? 'plain' : 'thumb';
            localStorage.setItem('listDetail', next);
            return next;
          });
        } else {
          setImageFitMode(prev => prev === 'contain' ? 'cover' : 'contain');
        }
      } else if (e.key.toLowerCase() === 'o' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOrderSelectMode(prev => !prev);
      } else if (e.key.toLowerCase() === 'd' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setDragSelectEnabled(prev => !prev);
      } else if (e.key.toLowerCase() === 'q' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setAutoReloadEnabled(prev => {
          const next = !prev;
          localStorage.setItem('autoReloadEnabled', next ? 'true' : 'false');
          return next;
        });
      } else if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setConfirmRequired(prev => !prev);
      } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        navigateSelection(e.shiftKey ? -1 : 1);
      } else if (e.key === ' ') {
        e.preventDefault();

        // Browser-like page scroll: one viewport jump per press (Shift = up).
        // Custom rAF tween: starts immediately (no native smooth-scroll lag) and
        // when the key is held, each repeat just extends the target so the motion
        // stays continuous instead of stuttering.
        const viewport = gridRef.current?.getViewport();
        if (viewport) {
          const anim = scrollAnim.current;
          const max = viewport.scrollHeight - viewport.clientHeight;
          const page = Math.max(80, viewport.clientHeight - 80);
          // If no tween is running, start from the real position (handles user's
          // own scrolling between presses); otherwise stack onto the live target.
          const base = anim.raf != null ? anim.target : viewport.scrollTop;
          anim.target = Math.min(max, Math.max(0, base + (e.shiftKey ? -page : page)));
          // Steady floor speed so a single press has no slow tail (~one page in
          // ~0.14s). Catch-up below scales above this when presses stack up.
          anim.minStep = page / 8;

          if (anim.raf == null) {
            const tick = () => {
              const dist = anim.target - viewport.scrollTop;
              // Speed grows with the backlog so rapid/held presses stay instant,
              // but never drops below the floor — no decelerating tail.
              const speed = Math.max(anim.minStep, Math.abs(dist) * 0.3);
              viewport.scrollTop += Math.sign(dist) * Math.min(Math.abs(dist), speed);
              if (Math.abs(anim.target - viewport.scrollTop) < 1) {
                viewport.scrollTop = anim.target;
                anim.raf = null;
                return;
              }
              anim.raf = requestAnimationFrame(tick);
            };
            anim.raf = requestAnimationFrame(tick);
          }
        }
      }
    };
    window.addEventListener('keydown', handler);

    // If the user scrolls manually (wheel/trackpad), stop the tween so it
    // doesn't fight them and pull the view back to its target.
    const cancelAnim = () => {
      if (scrollAnim.current.raf != null) {
        cancelAnimationFrame(scrollAnim.current.raf);
        scrollAnim.current.raf = null;
      }
    };
    window.addEventListener('wheel', cancelAnim, { passive: true });

    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('wheel', cancelAnim);
      cancelAnim();
    };
  }, [handleDeleteSelected, handleKeepSelected, handleLockSelected, handleUnlockSelected, handleDeselectAll, handleSelectAll, handleNavigateFolder, handleCopySelected, handleMoveSelected, handleOpenBulkRename, handleUseSelectedAsRefs, handleOpenInPhotoshop, handleInvertSelection, selectedImages, previewImage, viewMode, selectedFolders, handleOpenLastFolder, handleNavigateToFolder, handleNavigateUp, handleNavigateForward, handleOpenPreview]);

  // ── Ctrl+Wheel zoom ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setPreviewSize((p) => clamp(p + (e.deltaY < 0 ? 1 : -1) * PREVIEW_STEP));
    };
    window.addEventListener('wheel', handler, { passive: false });
    return () => window.removeEventListener('wheel', handler);
  }, []);

  // ── Auto-hide header on scroll ───────────────────────────────────
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      if (currentScrollY > lastScrollY && currentScrollY > 50) {
        // Scrolling down and past threshold
        setHeaderVisible(false);
      } else if (currentScrollY < lastScrollY) {
        // Scrolling up
        setHeaderVisible(true);
      }

      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  // ── Auto-hide subfolder bar on grid scroll ──────────────────────
  useEffect(() => {
    if (!gridRef.current) return;
    const viewport = gridRef.current.getViewport();
    if (!viewport) return;

    const handleGridScroll = () => {
      if (subfolderBarPinned) return;
      const currentY = viewport.scrollTop;
      const delta = currentY - lastSubfolderScrollY.current;
      if (delta > 10) setSubfolderBarVisible(false);
      else if (delta < -10) setSubfolderBarVisible(true);
      lastSubfolderScrollY.current = currentY;
    };

    viewport.addEventListener('scroll', handleGridScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', handleGridScroll);
  }, [images, subfolderBarPinned]);

  // ── Context menu item builder ────────────────────────────────────
  const buildContextItems = (image) => {
    const isSelected = selectedImages.has(image.path);
    const isLocked   = lockedImages.has(image.path);
    const isPng      = image.name?.toLowerCase().endsWith('.png');
    return [
      {
        label: 'Open in Preview',
        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>,
        onClick: () => window.electronAPI.openPath(image.path),
      },
      {
        label: 'Open in Photoshop',
        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></svg>,
        onClick: () => window.electronAPI.openInApp([image.path], photoshopPath),
        disabled: !photoshopPath,
      },
      { separator: true },
      {
        label: 'View Metadata',
        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8h.01M12 11v5"/></svg>,
        onClick: async () => {
          const result = await window.electronAPI.getImageMetadata(image.path);
          setMetadataModal({ imageName: image.name, metadata: result.metadata || {} });
        },
        disabled: !isPng,
      },
      { separator: true },
      {
        label: 'Show in Explorer',
        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
        onClick: () => window.electronAPI.showInFolder(image.path),
      },
      {
        label: 'Copy Path',
        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>,
        onClick: () => navigator.clipboard.writeText(image.path),
      },
      {
        label: (() => {
          const charSuffix = activeCharacter ? ` → ${activeCharacter}` : ' (set character first)';
          return isSelected && selectedImages.size > 1
            ? `Use ${selectedImages.size} as reference${charSuffix}`
            : `Use as reference${charSuffix}`;
        })(),
        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>,
        disabled: !activeCharacter,
        onClick: () => handleAddToRefs(
          isSelected && selectedImages.size > 1
            ? [...selectedImages]
            : [image.path]
        ),
      },
      { separator: true },
      {
        label: (isSelected && selectedImages.size > 1)
          ? `Auto-crop ${selectedImages.size} to face`
          : 'Auto-crop to face',
        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>,
        onClick: () => handleOpenAutoCrop(image),
      },
      { separator: true },
      {
        label: isSelected ? 'Deselect' : 'Select',
        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
        onClick: () => handleToggleImage(image.path),
      },
      {
        label: isLocked ? 'Unlock' : 'Lock',
        icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
        onClick: () => handleToggleLock(image.path),
      },
    ];
  };

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="App">
      {!isFullscreen && (
        <header className={`App-header ${headerVisible ? 'header-visible' : 'header-hidden'}`}>
          {/*
          <svg className="header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="App Icon">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L4 21" />
          </svg>
          <div className="title-bar">
            <h1>BatchFrame</h1>
          </div>
          <div className="header-divider" />
          <p>Cull, organize, and manage your image collections</p>
          */}
        </header>
      )}

      {browserMode && (
        <div className="mode-banner">
          Browser mode — delete to Recycle Bin only works in the Electron app.
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        webkitdirectory="true"
        directory="true"
        style={{ display: 'none' }}
        onChange={handleBrowserFolderSelect}
      />

      <Controls
        browserMode={browserMode}
        folderPath={folderPath}
        lastFolderPath={lastFolderPath}
        recentFolders={recentFolders}
        onOpenLastFolder={handleOpenLastFolder}
        onSelectFolder={handleSelectFolder}
        onFolderPathEdit={handleFolderPathEdit}
        selectedCount={selectedImages.size + selectedFolders.size}
        totalCount={images.length + subfolders.length}
        lockedCount={lockedImages.size}
        onSelectAll={handleSelectAll}
        onDeselectAll={handleDeselectAll}
        onLockSelected={handleLockSelected}
        onUnlockSelected={handleUnlockSelected}
        onDeleteSelected={handleDeleteSelected}
        onKeepSelected={handleKeepSelected}
        previewSize={previewSize}
        onPreviewSizeChange={handlePreviewSizeChange}
        onPreviewPresetChange={handlePreviewPresetChange}
        imageFitMode={imageFitMode}
        onImageFitModeChange={handleImageFitModeChange}
        viewMode={viewMode}
        onViewModeChange={(v) => { setViewMode(v); localStorage.setItem('viewMode', v); }}
        listDetail={listDetail}
        onListDetailChange={(v) => { setListDetail(v); localStorage.setItem('listDetail', v); }}
        pageSize={pageSize}
        onPageSizeChange={handlePageSizeChange}
        currentPage={currentPage}
        totalPages={totalPages}
        onPrevPage={handlePrevPage}
        onNextPage={handleNextPage}
        dragSelectEnabled={dragSelectEnabled}
        onDragSelectEnabledChange={handleDragSelectEnabledChange}
        confirmRequired={confirmRequired}
        onConfirmRequiredChange={handleConfirmRequiredChange}
        loading={loading}
        showShortcuts={showShortcuts}
        onToggleShortcuts={handleToggleShortcuts}
        subfolderBarPinned={subfolderBarPinned}
        onToggleSubfolderBar={handleToggleSubfolderBar}
        hasSubfolders={subfolders.length > 0 || !!parentFolderPath}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        sortDir={sortDir}
        onSortDirChange={setSortDir}
        orderSelectMode={orderSelectMode}
        onOrderSelectModeChange={handleSetOrderSelectMode}
        orderedSelection={orderedSelection}
        onRenameByOrder={handleRenameByOrder}
        photoshopPath={photoshopPath}
        onSetPhotoshopPath={handleSetPhotoshopPath}
        onOpenInPhotoshop={handleOpenInPhotoshop}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        filteredCount={filteredImages.length}
        onMoveSelected={handleMoveSelected}
        isMoving={isMoving}
        onCopySelected={handleCopySelected}
        isCopying={isCopying}
        onExportPaths={handleExportPaths}
        onInvertSelection={handleInvertSelection}
        onSelectAllFiltered={handleSelectAllFiltered}
        aspectFilter={aspectFilter}
        onAspectFilterChange={setAspectFilter}
        autoReloadEnabled={autoReloadEnabled}
        onAutoReloadChange={handleAutoReloadChange}
        onBulkRename={handleOpenBulkRename}
        onNavigateFolder={handleNavigateFolder}
        aiScores={aiScores}
        scanning={scanning}
        scanProgress={scanProgress}
        scanStatus={scanStatus}
        onAIScan={handleAIScan}
        onClearAiScores={handleClearAiScores}
        profilesVersion={profilesVersion}
        onClearRefs={handleClearRefs}
        onUseSelectedAsRefs={handleUseSelectedAsRefs}
        activeCharacter={activeCharacter}
        onSetActiveCharacter={setActiveCharacter}
        driveSlot={
          <DriveButton
            cacheRoot={driveCacheRoot}
            manifest={driveManifest}
            summary={driveSummary}
            onDatasetOpened={(cacheRoot) => loadElectronFolder(cacheRoot, true, true)}
          />
        }
      />

      <SubfolderBar
        subfolders={subfolders}
        parentFolderPath={parentFolderPath}
        onNavigate={handleNavigateToFolder}
        onNavigateUp={handleNavigateUp}
        onNavigateForward={handleNavigateForward}
        hasForwardHistory={forwardHistory.length > 0}
        visible={subfolderBarVisible}
        hideFolderChips={viewMode === 'explorer' || images.length === 0}
        onContextMenu={handleFolderContextMenu}
        onCreateFolder={!browserMode ? handleCreateFolder : undefined}
        editingFolderPath={editingFolderPath}
        onRenameCommit={handleRenameFolderCommit}
        onRenameCancel={() => setEditingFolderPath(null)}
      />

      <ImageGrid
        ref={gridRef}
        cursorIndex={keyboardCursorIndex}
        images={pagedImages}
        selectedImages={selectedImages}
        lockedImages={lockedImages}
        onToggleImage={handleToggleImage}
        onToggleLock={handleToggleLock}
        onSetRangeSelected={handleSetRangeSelectedFinal}
        onShiftSelectRange={handleShiftSelectRange}
        onPreview={handleOpenPreview}
        dragSelectEnabled={dragSelectEnabled}
        previewSize={previewSize}
        imageFitMode={imageFitMode}
        loading={loading}
        isDeleting={isDeleting || isMoving}
        deleteProgress={isMoving ? moveProgress : deleteProgress}
        orderedSelection={orderedSelection}
        orderSelectMode={orderSelectMode}
        onContextMenu={handleContextMenu}
        onFolderContextMenu={handleFolderContextMenu}
        aiScores={aiScores}
        aiThreshold={aiThreshold}
        scanningPath={scanningPath}
        driveStatesByPath={driveStatesByPath}
        viewMode={viewMode}
        listDetail={listDetail}
        subfolders={subfolders}
        folderPreviews={folderPreviews}
        onFolderClick={handleFolderClick}
        editingFolderPath={editingFolderPath}
        onRenameCommit={handleRenameFolderCommit}
        onRenameCancel={() => setEditingFolderPath(null)}
        selectedFolders={selectedFolders}
        onFolderLongPress={handleFolderLongPress}
      />

      {previewImage && (
        <ImagePreviewModal
          image={previewImage}
          images={images}
          currentIndex={previewIndex}
          onClose={handleClosePreview}
          onNext={handleNextPreview}
          onPrev={handlePrevPreview}
          onGoTo={handleGoToPreview}
          onLock={handleToggleLock}
          onDelete={handleDeletePreview}
          onToggleSelect={() => handleToggleImage(previewImage.path)}
          selected={selectedImages.has(previewImage.path)}
          locked={lockedImages.has(previewImage.path)}
          onSaveCrop={handleSaveCrop}
          canCrop={!browserMode}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          danger={confirmDialog.danger !== false}
          onConfirm={handleConfirmYes}
          onCancel={handleConfirmNo}
        />
      )}

      {contextMenu && !browserMode && (
        <ContextMenu
          items={buildContextItems(contextMenu.image)}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={handleCloseContextMenu}
        />
      )}

      {folderMenu && !browserMode && (
        <ContextMenu
          items={buildFolderMenuItems(folderMenu.folder)}
          position={{ x: folderMenu.x, y: folderMenu.y }}
          onClose={handleCloseFolderMenu}
        />
      )}

      {metadataModal && (
        <MetadataModal
          imageName={metadataModal.imageName}
          metadata={metadataModal.metadata}
          onClose={() => setMetadataModal(null)}
        />
      )}

      {renameModal && (
        <RenameModal
          images={renameModal.images}
          onConfirm={handleConfirmBulkRename}
          onClose={() => setRenameModal(null)}
        />
      )}

      {autoCropModal && (
        <AutoCropModal
          count={autoCropModal.paths.length}
          running={autoCropRunning}
          progress={autoCropProgress}
          result={autoCropResult}
          onRun={handleAutoCropFace}
          onClose={handleCloseAutoCrop}
        />
      )}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        query={searchQuery}
        setQuery={setSearchQuery}
        actions={globalActions}
        currentPath={folderPath}
        lastFolderPath={lastFolderPath}
        subfolders={subfolders}
        parentFolderPath={parentFolderPath}
        recentFolders={recentFolders}
        onNavigateToFolder={handleNavigateToFolder}
        onNavigateUp={handleNavigateUp}
        onBrowseFolder={handleSelectFolder}
      />
    </div>
  );
}

export default App;
