import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import './App.css';
import Controls from './components/Controls';
import ImageGrid from './components/ImageGrid';
import SubfolderBar from './components/SubfolderBar';
import ImagePreviewModal from './components/ImagePreviewModal';
import ConfirmDialog from './components/ConfirmDialog';
import NoticeDialog from './components/NoticeDialog';
import ContextMenu from './components/ContextMenu';
import MetadataModal from './components/MetadataModal';
import TextPreviewModal from './components/TextPreviewModal';
import RenameModal from './components/RenameModal';
import AutoCropModal from './components/AutoCropModal';

import DriveButton from './components/DriveButton';
import DriveDestinationPicker from './components/DriveDestinationPicker';
import LocalDestinationPicker from './components/LocalDestinationPicker';
import RemoteButton from './components/RemoteButton';
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

  const undoStack           = useRef([]);
  const autoScrollBottom    = useRef(false);
  const folderPathRef       = useRef(null);
  const [initialRoot] = useState(() => localStorage.getItem('batchframe-root-folder') || '');
  const rootFolderPathRef   = useRef(initialRoot);
  const keyboardAnchorRef   = useRef(null);
  const keyboardSnapshotRef = useRef(null);
  const keyboardCursorRef   = useRef(null);
  const [keyboardCursorIndex, setKeyboardCursorIndex] = useState(null);
  const [isShiftDown, setIsShiftDown] = useState(false);
  const cursorTimeoutRef = useRef(null);

  // Smooth spacebar page-scroll animation state
  const scrollAnim = useRef({ target: 0, raf: null, minStep: 0 });

  // Delete operation state
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });

  // Sort state
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  // Custom order (Cluster / Shuffle). When non-null, overrides sortBy for images.
  // clusterAssignments: { [path]: clusterId } — drives per-tile badges/colors.
  const [customOrder, setCustomOrder] = useState(null);
  const [clusterAssignments, setClusterAssignments] = useState(null);

  // Clear custom order (and cluster metadata) whenever the user changes sort.
  const sortBySignatureRef = useRef(`${sortBy}|${sortDir}`);
  useEffect(() => {
    const sig = `${sortBy}|${sortDir}`;
    if (sortBySignatureRef.current !== sig) {
      sortBySignatureRef.current = sig;
      setCustomOrder(null);
      setClusterAssignments(null);
    }
  }, [sortBy, sortDir]);

  // Order-select state
  const [orderSelectMode, setOrderSelectMode] = useState(false);
  const [orderedSelection, setOrderedSelection] = useState([]);

  // Photoshop state
  const [photoshopPath, setPhotoshopPath] = useState(() => localStorage.getItem('photoshopPath') || '');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Command Palette


  // Drive folder picker for move/copy destinations (replaces native folder dialog when in Drive live mode)
  const [drivePickAction, setDrivePickAction] = useState(null);

  // In-app folder picker for AI flows (Find Source's "edited folder" prompt).
  // Promise-based so callers can `await pickSourceFolder()`.
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const sourcePickerResolveRef = useRef(null);
  const pickSourceFolder = useCallback(() => new Promise((resolve) => {
    sourcePickerResolveRef.current = resolve;
    setSourcePickerOpen(true);
  }), []);
  const handleSourcePickSelected = useCallback((destPath) => {
    setSourcePickerOpen(false);
    const r = sourcePickerResolveRef.current;
    sourcePickerResolveRef.current = null;
    r?.(destPath);
  }, []);
  const handleSourcePickClose = useCallback(() => {
    setSourcePickerOpen(false);
    const r = sourcePickerResolveRef.current;
    sourcePickerResolveRef.current = null;
    r?.(null);
  }, []);

  // Move state
  const [isMoving, setIsMoving] = useState(false);
  const [moveProgress, setMoveProgress] = useState({ current: 0, total: 0 });
  const lastTargetRef = useRef({ base: null, target: null });

  // Auto-reload state
  const [autoReloadEnabled, setAutoReloadEnabled] = useState(() => localStorage.getItem('autoReloadEnabled') === 'true');

  // Context menu state
  const [contextMenu, setContextMenu]     = useState(null); // { x, y, image } | null
  const [metadataModal, setMetadataModal] = useState(null); // { imageName, metadata } | null
  const [textModal, setTextModal]         = useState(null); // { fileName, text } | null
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

  // File type filter state
  const [showNonImages, setShowNonImages] = useState(() => localStorage.getItem('showNonImages') === 'true');

  // AI scan state
  const [aiScores, setAiScores]           = useState({});
  const [aiThreshold, setAiThreshold]     = useState(0.80);
  const [scanning, setScanning]           = useState(false);
  // Which AI action is currently running, for per-button spinner outline.
  // 'source' | 'cluster' | 'dupes' | 'scan' | null
  const [activeAiAction, setActiveAiAction] = useState(null);
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

  // Live Drive mode: folderPath is a drive:// URI and edits go straight to
  // Drive. driveLiveRequest is bumped by Cmd+Shift+D to open the live picker;
  // driveLabelsRef maps drive:// paths to display names for the breadcrumb.
  const [driveLiveRequest, setDriveLiveRequest] = useState(0);
  const driveLabelsRef = useRef(new Map(JSON.parse(localStorage.getItem('batchframe-drive-labels') || '[]')));
  const setDriveLabel = useCallback((path, name) => {
    driveLabelsRef.current.set(path, name);
    localStorage.setItem('batchframe-drive-labels', JSON.stringify([...driveLabelsRef.current.entries()]));
  }, []);

  const isDriveLive = !!folderPath && folderPath.startsWith('drive://');
  const folderLabel = isDriveLive
    ? (driveLabelsRef.current.get(folderPath) || 'Drive folder')
    : null;

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
      if (!cacheRoot || !folderPath) return;
      if (cacheRoot === folderPath || folderPath.startsWith(cacheRoot + '/') || folderPath.startsWith(cacheRoot + '\\')) {
        load();
      }
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
    if (window.electronAPI.onCopyProgress) {
      window.electronAPI.onCopyProgress((data) => setCopyProgress(data));
    }

    return () => {
      window.electronAPI.removeDeleteListeners();
      if (window.electronAPI.removeMoveListeners) window.electronAPI.removeMoveListeners();
      if (window.electronAPI.removeCopyListeners) window.electronAPI.removeCopyListeners();
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
    if (customOrder && customOrder.length) {
      const orderMap = new Map(customOrder.map((p, i) => [p, i]));
      const known = [];
      const unknown = [];
      for (const img of images) {
        if (orderMap.has(img.path)) known.push(img); else unknown.push(img);
      }
      known.sort((a, b) => orderMap.get(a.path) - orderMap.get(b.path));
      return [...known, ...unknown];
    }
    if (sortBy === 'none') return images;
    return [...images].sort((a, b) => {
      let v = 0;
      if (sortBy === 'name') {
        v = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortBy === 'date') {
        v = (a.mtime || 0) - (b.mtime || 0);
        if (v === 0) v = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortBy === 'size') {
        v = (a.size  || 0) - (b.size  || 0);
        if (v === 0) v = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }
      return sortDir === 'asc' ? v : -v;
    });
  }, [images, sortBy, sortDir, customOrder]);

  const sortedSubfolders = useMemo(() => {
    if (sortBy === 'none') return subfolders;
    return [...subfolders].sort((a, b) => {
      let v = 0;
      if (sortBy === 'name') {
        v = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortBy === 'date') {
        v = (a.mtime || 0) - (b.mtime || 0);
        if (v === 0) v = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortBy === 'size') {
        v = (a.size  || 0) - (b.size  || 0);
        if (v === 0) v = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }
      return sortDir === 'asc' ? v : -v;
    });
  }, [subfolders, sortBy, sortDir]);

  const filteredSubfolders = useMemo(() => {
    let result = sortedSubfolders;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(sf => sf.name.toLowerCase().includes(q));
    }
    return result;
  }, [sortedSubfolders, searchQuery]);

  // ── Search + aspect filter ──────────────────────────────────────
  const filteredImages = useMemo(() => {
    let result = sortedImages;
    
    // Only allow showing non-images in 'explorer' view. 
    // In 'grid' or 'list' views, force hide txt/zip/torrent files.
    const actuallyShowNonImages = viewMode === 'explorer' ? showNonImages : false;
    
    if (!actuallyShowNonImages) {
      result = result.filter(img => {
        const ext = (img.name || '').split('.').pop().toLowerCase();
        return !['safetensors', 'zip', 'txt', 'torrent', 'ckpt', 'pt'].includes(ext);
      });
    }
    
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
  }, [sortedImages, searchQuery, aspectFilter, showNonImages, viewMode]);

  const filteredImagesRef = useRef(filteredImages);
  const subfoldersRef = useRef(filteredSubfolders);
  useEffect(() => { filteredImagesRef.current = filteredImages; }, [filteredImages]);
  useEffect(() => { subfoldersRef.current = filteredSubfolders; }, [filteredSubfolders]);
  useEffect(() => { folderPathRef.current = folderPath; }, [folderPath]);

  // Redundant useEffect removed. Anchor/snapshot logic is managed synchronously in click/keyboard handlers.

  // O(1) path → index lookup, rebuilt only when the filtered list changes.
  const pathToIndex = useMemo(() => {
    const m = new Map();
    for (let i = 0; i < filteredImages.length; i++) m.set(filteredImages[i].path, i);
    return m;
  }, [filteredImages]);

  // ── Follow scanning position during AI scan ────────────────────
  // Uses gridRef.scrollToIndex (handles both list and grid geometry). If the
  // scanning image is on another page, switch to that page first — otherwise
  // the visual indicator gets left behind on a page you're not looking at.
  useEffect(() => {
    if (!scanning || !scanningPath) return;
    const index = pathToIndex.get(scanningPath);
    if (index === undefined) return;

    const targetPage = Math.floor(index / pageSize) + 1;
    if (targetPage !== currentPage) {
      setCurrentPage(targetPage);
      return; // effect re-fires once page state updates, then scrolls below
    }

    const localIndex = index - (currentPage - 1) * pageSize;
    // Defer to next frame so ImageGrid finishes rendering the new page slice
    // before we ask it to scroll to a specific index. Follow-mode has a wide
    // dead zone and smooth-scrolls — feels less jumpy during a fast scan.
    requestAnimationFrame(() => {
      const g = gridRef.current;
      if (g?.scrollToIndexFollow) g.scrollToIndexFollow(localIndex);
      else g?.scrollToIndex(localIndex);
    });
  }, [scanningPath, scanning, pathToIndex, currentPage, pageSize]);

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

  // ── Custom notice helper (in-app alert replacement) ─────────────
  // variant: 'info' | 'success' | 'error'. Accepts either
  //   showNotice('message')  or  showNotice({ title, message, variant, okLabel })
  const [noticeDialog, setNoticeDialog] = useState(null);
  const noticeResolveRef = useRef(null);
  const showNotice = useCallback((arg) => {
    const cfg = typeof arg === 'string' ? { message: arg } : (arg || {});
    return new Promise((resolve) => {
      noticeResolveRef.current = resolve;
      setNoticeDialog({
        title:    cfg.title    || null,
        message:  cfg.message  || '',
        variant:  cfg.variant  || 'info',
        okLabel:  cfg.okLabel  || 'OK',
      });
    });
  }, []);
  const handleNoticeClose = useCallback(() => {
    setNoticeDialog(null);
    const r = noticeResolveRef.current;
    noticeResolveRef.current = null;
    r?.();
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

    if (pathToLoad !== folderPathRef.current) {
      if (folderPathRef.current && window.electronAPI.emptyTrash) {
        window.electronAPI.emptyTrash(folderPathRef.current);
      }
      undoStack.current = [];
    }

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

      // Remember display names for drive:// paths (ids aren't readable).
      if (pathToLoad.startsWith('drive://')) {
        if (folderInfo.name) setDriveLabel(pathToLoad, folderInfo.name);
        for (const sf of folderInfo.subfolders || []) {
          setDriveLabel(sf.path, sf.name);
        }
      }

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

  // Live Drive open: no pull — the drive:// URI itself becomes the workspace.
  const handleOpenLive = useCallback(({ id, name }) => {
    const livePath = `drive://${id}`;
    setDriveLabel(livePath, name);
    loadElectronFolder(livePath, true, true);
  }, [loadElectronFolder]);

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
  const handleOpenPreview = useCallback(async (image, index) => {
    if (image.name?.toLowerCase().endsWith('.txt')) {
      const result = await window.electronAPI.getTextFile(image.path);
      if (result.success) {
        setTextModal({ fileName: image.name, text: result.text, filePath: image.path });
      } else {
        console.error(`Failed to read text file: ${result.error}`);
      }
      return;
    }

    setPreviewImage(image);
    setPreviewIndex(index);
    setKeyboardCursorIndex(null); // Hide cursor outline
    if (cursorTimeoutRef.current) clearTimeout(cursorTimeoutRef.current);
    setSelectedImages(prev => {
      if (prev.has(image.path)) {
        const next = new Set(prev);
        next.delete(image.path);
        return next;
      }
      return prev;
    });
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
      showNotice({ title: 'Delete failed', message: 'Check console for details.', variant: 'error' });
    }
  }, [previewImage, previewIndex, pagedImages, lockedImages, confirmRequired,
      showConfirm, browserMode, handleClosePreview]);

  useEffect(() => {
    const handleGlobalKeyDown = async (e) => {
      if (e.key === 'Shift') setIsShiftDown(true);
      
      if (e.key.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        if (undoStack.current.length > 0) {
          const lastOp = undoStack.current.pop();
          try {
            await lastOp.reverse();
          } catch (err) {
            console.error('Undo failed', err);
            showNotice({ title: 'Undo failed', message: err.message, variant: 'error' });
          }
        }
      }
    };
    const handleGlobalKeyUp = (e) => {
      if (e.key === 'Shift') setIsShiftDown(false);
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('keyup', handleGlobalKeyUp);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('keyup', handleGlobalKeyUp);
    };
  }, []);

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

  // ── LAN remote access: broadcast state + accept remote intents ────
  const pagedImagesRef = useRef([]);
  useEffect(() => { pagedImagesRef.current = pagedImages; }, [pagedImages]);

  const [lanRunning, setLanRunning] = useState(false);
  useEffect(() => {
    if (!window.electronAPI?.lan) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await window.electronAPI.lan.status();
        if (!cancelled) setLanRunning(!!s?.running);
      } catch { /* handler missing — main not yet reloaded */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!lanRunning || !window.electronAPI?.lan) return;
    window.electronAPI.lan.pushState({
      folderPath,
      subfolders,
      parentFolderPath,
      images: pagedImages,
      previewIndex,
      previewPath: previewImage?.path || null,
      selected: Array.from(selectedImages),
    }).catch(() => {});
  }, [lanRunning, folderPath, subfolders, parentFolderPath, pagedImages, previewIndex, previewImage, selectedImages]);

  useEffect(() => {
    if (!window.electronAPI?.lan) return;
    const handler = ({ intent, payload }) => {
      switch (intent) {
        case 'nav-folder':
          if (payload?.path) handleNavigateToFolder(payload.path);
          break;
        case 'nav-up':
          handleNavigateUp();
          break;
        case 'open-preview': {
          const list = pagedImagesRef.current || [];
          let idx = -1;
          if (typeof payload?.index === 'number') idx = payload.index;
          else if (payload?.path) idx = list.findIndex(i => i.path === payload.path);
          if (idx >= 0 && idx < list.length) handleOpenPreview(list[idx], idx);
          break;
        }
        case 'close-preview':
          handleClosePreview();
          break;
        case 'next-preview':
          handleNextPreview();
          break;
        case 'prev-preview':
          handlePrevPreview();
          break;
        case 'goto-preview':
          if (typeof payload?.index === 'number') handleGoToPreview(payload.index);
          break;
        default:
      }
    };
    window.electronAPI.lan.onIntent(handler);
    return () => window.electronAPI.lan.removeIntentListeners();
  }, [handleNavigateToFolder, handleNavigateUp, handleOpenPreview, handleClosePreview, handleNextPreview, handlePrevPreview, handleGoToPreview]);

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
      setKeyboardCursorIndex(null); // Hide cursor outline on mouse click
      if (cursorTimeoutRef.current) clearTimeout(cursorTimeoutRef.current);
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

  const handleEmptyContextMenu = useCallback((e) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, empty: true });
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
    if (isDriveLive) return; // Photoshop would edit a temp copy, not Drive
    if (!photoshopPath || selectedImages.size === 0) return;
    window.electronAPI.openInApp([...selectedImages], photoshopPath);
  }, [photoshopPath, selectedImages, isDriveLive]);

  // ── Move selected to folder ────────────────────────────────────
  const performMoveToDest = useCallback(async (dest) => {
    if (!dest || dest === folderPath) return;
    lastTargetRef.current = { base: folderPath, target: dest };
    const movableImages = images.filter(img => selectedImages.has(img.path) && !lockedImages.has(img.path)).map(i => i.path);
    const movableFolders = Array.from(selectedFolders);
    const movable = [...movableImages, ...movableFolders];
    if (movable.length === 0) return;
    const proceed = confirmRequired
      ? await showConfirm('Move', `Move ${movable.length} item${movable.length > 1 ? 's' : ''} to:\n${dest}`, 'Move', false)
      : true;
    if (!proceed) return;
    setIsMoving(true);
    setMoveProgress({ current: 0, total: movable.length });
    try {
      const result = await window.electronAPI.moveImages(movable, dest);
      const movedSet = new Set(result.moved);
      
      undoStack.current.push({
        name: 'Move',
        reverse: async () => {
          const reversePaths = result.moved.map(p => {
             const slashIdx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
             const basename = p.substring(slashIdx + 1);
             const separator = dest.endsWith('/') || dest.endsWith('\\') ? '' : '/';
             return dest + separator + basename;
          });
          await window.electronAPI.moveImages(reversePaths, folderPath);
          await loadElectronFolder(folderPath, false);
        }
      });

      setImages(prev => prev.filter(img => !movedSet.has(img.path)));
      setSubfolders(prev => prev.filter(f => !movedSet.has(f.path)));
      setSelectedImages(new Set());
      setSelectedFolders(new Set());
      if (result.failed && result.failed.length > 0) {
        console.error('Some moves failed:', result.failed);
      }
    } catch (err) {
      console.error('Move failed:', err);
    } finally {
      setIsMoving(false);
      setMoveProgress({ current: 0, total: 0 });
    }
  }, [selectedImages, selectedFolders, images, lockedImages, folderPath, confirmRequired, showConfirm]);

  const handleMoveSelected = useCallback(async () => {
    if (!window.electronAPI || (selectedImages.size === 0 && selectedFolders.size === 0)) return;
    setDrivePickAction('move');
  }, [selectedImages, selectedFolders]);

  // ── Copy selected to folder ────────────────────────────────────
  const performCopyToDest = useCallback(async (dest) => {
    lastTargetRef.current = { base: folderPath, target: dest };
    const filePaths = [...selectedImages, ...selectedFolders].filter(p => !lockedImages.has(p));
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
  }, [selectedImages, selectedFolders, lockedImages, folderPath]);

  const handleCopySelected = useCallback(async () => {
    if (!window.electronAPI || (selectedImages.size === 0 && selectedFolders.size === 0)) return;
    setDrivePickAction('copy');
  }, [selectedImages, selectedFolders]);

  const handleDrivePickCreateFolder = useCallback(async ({ parentId, name }) => {
    try {
      const r = await window.electronAPI.drive.createFolder({ parentId, name });
      if (!r.success) throw new Error(r.error || 'Failed to create folder');
      return r.folder;
    } catch (e) {
      console.error('Create folder failed:', e);
      return null;
    }
  }, []);

  const handleDrivePickSelected = useCallback(async ({ id, name }) => {
    const action = drivePickAction;
    setDrivePickAction(null);
    if (!action || !id) return;
    const dest = `drive://${id}`;
    setDriveLabel(dest, name);
    if (action === 'move') await performMoveToDest(dest);
    else if (action === 'copy') await performCopyToDest(dest);
    else if (action === 'open') {
      await loadElectronFolder(dest, true, true);
    }
  }, [drivePickAction, performMoveToDest, performCopyToDest, loadElectronFolder]);

  const handleLocalPickSelected = useCallback(async (destPath) => {
    const action = drivePickAction;
    setDrivePickAction(null);
    if (!action || !destPath) return;
    lastTargetRef.current = { base: folderPath, target: destPath };
    if (action === 'move') await performMoveToDest(destPath);
    else if (action === 'copy') await performCopyToDest(destPath);
    else if (action === 'open') {
      await loadElectronFolder(destPath, true, true);
    }
  }, [drivePickAction, folderPath, performMoveToDest, performCopyToDest, loadElectronFolder]);

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

  const handleConfirmBulkRename = useCallback(async (renames) => {
    if (!renameModal) return;
    setRenameModal(null);
    try {
      await window.electronAPI.renameImages(renames);
      
      undoStack.current.push({
        name: 'Rename',
        reverse: async () => {
          const reverseRenames = renames.map(r => {
             const slashIdx = Math.max(r.oldPath.lastIndexOf('/'), r.oldPath.lastIndexOf('\\'));
             const dir = r.oldPath.substring(0, slashIdx);
             const oldBaseName = r.oldPath.substring(slashIdx + 1);
             const separator = dir ? '/' : '';
             return {
               oldPath: dir + separator + r.newName,
               newName: oldBaseName
             };
          });
          await window.electronAPI.renameImages(reverseRenames);
          await loadElectronFolder(folderPath, false);
        }
      });

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
    setActiveAiAction('scan');
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
      showNotice({ title: 'AI scan failed', message: err.message, variant: 'error' });
    } finally {
      window.electronAPI.removeScanListeners();
      setScanningPath(null);
      setScanStatus('');
      setScanning(false);
      setScanProgress({ done: 0, total: 0 });
      setActiveAiAction(null);
    }
  }, []);

  const handleClearAiScores = useCallback(() => {
    setAiScores({});
    setAiThreshold(0);
    setSelectedImages(new Set());
  }, []);

  // ── AI duplicate check ──────────────────────────────────────────
  const handleFindDuplicates = useCallback(async () => {
    const paths = filteredImagesRef.current.map(i => i.path);
    if (paths.length === 0) return;

    setScanning(true);
    setActiveAiAction('dupes');
    setScanProgress({ done: 0, total: paths.length });
    setSelectedImages(new Set());

    window.electronAPI.onScanProgress((data) => {
      if (data.type === 'status') {
        setScanStatus(data.text);
      } else if (data.type === 'scanning') {
        setScanStatus('');
        setScanningPath(data.path);
      }
    });

    try {
      const clusters = await window.electronAPI.findDuplicates(paths);
      if (clusters && clusters.length > 0) {
        const newSelected = new Set();
        clusters.forEach(cluster => {
          // Skip the first image (keep it), select the rest for deletion
          for (let i = 1; i < cluster.length; i++) {
            newSelected.add(cluster[i]);
          }
        });
        setSelectedImages(newSelected);
        showNotice({
          title: 'Find Dupes complete',
          message: `Found ${clusters.length} duplicate groups.\n${newSelected.size} duplicate images have been selected for deletion.`,
          variant: 'success',
        });
      } else {
        showNotice({ title: 'Find Dupes', message: 'No duplicates found.' });
      }
    } catch (err) {
      console.error('Find duplicates failed:', err);
      showNotice({ title: 'Find Dupes failed', message: err.message, variant: 'error' });
    } finally {
      window.electronAPI.removeScanListeners();
      setScanningPath(null);
      setScanStatus('');
      setScanning(false);
      setScanProgress({ done: 0, total: 0 });
      setActiveAiAction(null);
    }
  }, []);

  // ── Find Source: match edited images back to their raw sources ──
  // Current folder = raws. User picks the edited folder. Script hashes
  // both, matches each edited to its nearest raw (dhash + Hamming), and
  // the unmatched raws (no edit corresponds to them) get selected so the
  // user can delete/move them via the existing controls.
  const handleFindSource = useCallback(async () => {
    const rawImages = filteredImagesRef.current;
    if (rawImages.length === 0) {
      showNotice({ title: 'Find Source', message: 'No raw images in the current view.' });
      return;
    }
    const editedFolder = await pickSourceFolder();
    if (!editedFolder) return;

    const edits = await window.electronAPI.getImages(editedFolder);
    if (!edits || edits.length === 0) {
      showNotice({ title: 'Find Source', message: 'No images found in the edited folder.' });
      return;
    }

    const rawPaths    = rawImages.map(i => i.path);
    const editedPaths = edits.map(i => i.path);
    const threshold   = 8;

    setScanning(true);
    setActiveAiAction('source');
    setScanProgress({ done: 0, total: rawPaths.length + editedPaths.length });
    setSelectedImages(new Set());

    window.electronAPI.onScanProgress((data) => {
      if (data.type === 'status') {
        setScanStatus(data.text);
      } else if (data.type === 'scanning') {
        setScanStatus('');
        setScanningPath(data.path);
      }
    });

    try {
      const report = await window.electronAPI.findSourceMatch(editedPaths, rawPaths, threshold);
      const discardSet = new Set(report.discardRaws || []);
      setSelectedImages(discardSet);
      const s = report.stats || {};
      showNotice({
        title: 'Find Source complete',
        variant: 'success',
        message:
          `Edits:            ${s.editCount ?? edits.length}\n` +
          `Raws:             ${s.rawCount ?? rawImages.length}\n` +
          `Matched:          ${s.matched ?? 0}\n` +
          `Unmatched edits:  ${s.unmatched ?? 0}\n` +
          `Raws to keep:     ${s.keep ?? 0}\n` +
          `Raws to discard:  ${s.discard ?? 0}  ← selected in the grid`,
      });
    } catch (err) {
      console.error('Find source failed:', err);
      showNotice({ title: 'Find Source failed', message: err.message, variant: 'error' });
    } finally {
      window.electronAPI.removeScanListeners();
      setScanningPath(null);
      setScanStatus('');
      setScanning(false);
      setScanProgress({ done: 0, total: 0 });
      setActiveAiAction(null);
    }
  }, [pickSourceFolder]);

  // ── Cluster: group current view by visual similarity (CLIP + KMeans) ──
  // Reorders the grid so same-cluster images sit adjacent. Cluster badge/tint
  // is painted per-tile by ImageGrid → ImageCard.
  const handleCluster = useCallback(async () => {
    const current = filteredImagesRef.current;
    if (!current || current.length < 6) {
      showNotice({ title: 'Cluster', message: 'Need at least 6 images to cluster.' });
      return;
    }
    const paths = current.map(i => i.path);

    setScanning(true);
    setActiveAiAction('cluster');
    setScanProgress({ done: 0, total: paths.length });

    window.electronAPI.onScanProgress((data) => {
      if (data.type === 'status') {
        setScanStatus(data.text);
      } else if (data.type === 'scanning') {
        setScanStatus('');
        setScanningPath(data.path);
      }
    });

    try {
      const result = await window.electronAPI.clusterImages(paths, null);
      const clusterMap = result?.clusters || {};
      const order = result?.clusterOrder || [];
      // Build custom order: iterate clusters largest→smallest, within each keep
      // the original order from the current view.
      const buckets = new Map();
      for (const img of current) {
        const cid = clusterMap[img.path];
        if (cid === undefined) continue;
        if (!buckets.has(cid)) buckets.set(cid, []);
        buckets.get(cid).push(img.path);
      }
      const nextOrder = [];
      for (const cid of order) {
        const b = buckets.get(cid);
        if (b) nextOrder.push(...b);
      }
      // Any leftover (shouldn't happen) appended.
      for (const [cid, b] of buckets) {
        if (!order.includes(cid)) nextOrder.push(...b);
      }
      setCustomOrder(nextOrder);
      setClusterAssignments(clusterMap);
      const s = result?.stats || {};
      showNotice({
        title: 'Cluster complete',
        variant: 'success',
        message: `Clustered ${s.numImages ?? paths.length} images into ${s.numClusters ?? '?'} groups.\nScroll to review — same-cluster tiles sit together.`,
      });
    } catch (err) {
      console.error('Cluster failed:', err);
      showNotice({ title: 'Cluster failed', message: err.message, variant: 'error' });
    } finally {
      window.electronAPI.removeScanListeners();
      setScanningPath(null);
      setScanStatus('');
      setScanning(false);
      setScanProgress({ done: 0, total: 0 });
      setActiveAiAction(null);
    }
  }, []);

  // ── Shuffle: randomize current view to remove position bias ──
  const handleShuffle = useCallback(() => {
    const current = filteredImagesRef.current;
    if (!current || current.length < 2) return;

    const shuffleArr = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    };

    // If clusters exist, shuffle the ORDER OF CLUSTERS but keep each
    // cluster's members together.
    if (clusterAssignments) {
      const buckets = new Map();
      for (const img of current) {
        const cid = clusterAssignments[img.path] ?? '__none__';
        if (!buckets.has(cid)) buckets.set(cid, []);
        buckets.get(cid).push(img.path);
      }
      const keys = Array.from(buckets.keys());
      shuffleArr(keys);
      const paths = [];
      for (const k of keys) paths.push(...buckets.get(k));
      setCustomOrder(paths);
      // Keep clusterAssignments so the per-tile badges & sticky header
      // stay visible after a group-shuffle.
      return;
    }

    // No clusters — plain per-image shuffle.
    const paths = current.map(i => i.path);
    shuffleArr(paths);
    setCustomOrder(paths);
    setClusterAssignments(null);
  }, [clusterAssignments]);

  const handleAddToRefs = useCallback(async (imagePaths) => {
    if (!window.electronAPI?.addToRefs || !activeCharacter) return;
    await window.electronAPI.addToRefs({ imagePaths, character: activeCharacter });
    setProfilesVersion(v => v + 1);
  }, [activeCharacter]);

  // Toolbar shortcut: add the current selection as references in one click
  const handleUseSelectedAsRefs = useCallback(() => {
    if (isDriveLive) return; // refs are copied on the local filesystem
    if (selectedImages.size === 0) return;
    handleAddToRefs([...selectedImages]);
  }, [selectedImages, handleAddToRefs, isDriveLive]);

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

  // ── Drag and Drop ───────────────────────────────────────────────
  const handleAppDragOver = useCallback((e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleAppDrop = useCallback(async (e) => {
    e.preventDefault();
    if (!folderPath) return;
    
    // Check if it's external files
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const paths = Array.from(e.dataTransfer.files).map(f => f.path).filter(Boolean);
      if (paths.length > 0) {
        setIsCopying(true);
        setCopyProgress({ current: 0, total: paths.length });
        try {
          await window.electronAPI.copyImages(paths, folderPath);
        } catch (err) {
          console.error(err);
        } finally {
          setIsCopying(false);
          setCopyProgress({ current: 0, total: 0 });
          if (!autoReloadEnabled) loadElectronFolder(folderPath);
        }
      }
    }
  }, [folderPath, autoReloadEnabled, loadElectronFolder]);

  const handleDropOnFolder = useCallback(async (e, folder) => {
    e.preventDefault();
    e.stopPropagation();
    
    const internalData = e.dataTransfer.getData('application/x-batchframe-images');
    if (internalData) {
      try {
        const paths = JSON.parse(internalData);
        if (paths.length > 0) {
          setIsMoving(true);
          setMoveProgress({ current: 0, total: paths.length });
          await window.electronAPI.moveImages(paths, folder.path);
          handleDeselectAll();
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsMoving(false);
        setMoveProgress({ current: 0, total: 0 });
        if (!autoReloadEnabled) loadElectronFolder(folderPath);
      }
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const paths = Array.from(e.dataTransfer.files).map(f => f.path).filter(Boolean);
      if (paths.length > 0) {
        setIsCopying(true);
        setCopyProgress({ current: 0, total: paths.length });
        try {
          await window.electronAPI.copyImages(paths, folder.path);
        } catch (err) {
          console.error(err);
        } finally {
          setIsCopying(false);
          setCopyProgress({ current: 0, total: 0 });
          if (!autoReloadEnabled) loadElectronFolder(folderPath);
        }
      }
    }
  }, [folderPath, autoReloadEnabled, loadElectronFolder, handleDeselectAll]);

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
          const deleteResult = await window.electronAPI.softDeleteImages(safeImages.map(img => img.path));
          if (deleteResult && deleteResult.success) {
            undoStack.current.push({
              name: 'Delete',
              reverse: async () => {
                await window.electronAPI.restoreImages(deleteResult.trashInfos);
                await loadElectronFolder(folderPath, false);
              }
            });
            setImages(prev => prev.filter(img => !selectedImages.has(img.path)));
          } else {
            console.error('Delete failed:', deleteResult?.error);
            showNotice({ title: 'Delete failed', message: `Failed to delete some images: ${deleteResult?.error}`, variant: 'error' });
          }
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
      showNotice({ title: 'Delete failed', message: 'Check console for details.', variant: 'error' });
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



  // ── Keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {


      // Terminal-style folder open picker
      if ((e.key === 'o' || e.key === 'O') && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        setDrivePickAction('open');
        return;
      }

      // Open a Drive folder LIVE (edits apply to Drive directly).
      // Must be tested before the plain Cmd+D branch below, which doesn't
      // exclude shift and would otherwise swallow the chord.
      if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        setDriveLiveRequest((n) => n + 1);
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

      // Other modals also own the keyboard
      if (confirmDialog || renameModal || autoCropModal || metadataModal || drivePickAction || textModal) return;

      if (e.key === 'Escape') {

        handleDeselectAll();
        return;
      }

      const navigateSelection = (delta, extend = false, forceReset = false) => {
        const currentSubfolders = subfoldersRef.current || [];
        const currentFiltered = filteredImagesRef.current || [];
        const allItems = [
          ...currentSubfolders.map(f => ({ type: 'folder', path: f.path })),
          ...currentFiltered.map(img => ({ type: 'image', path: img.path }))
        ];
        if (allItems.length === 0) return;

        const totalSelected = selectedImages.size + selectedFolders.size;
        let currentIndex = keyboardCursorRef.current !== null ? keyboardCursorRef.current : -1;
        
        // If forceReset is true, forget the old cursor and start from the beginning/end
        if (forceReset) {
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
        gridRef.current?.scrollToIndex(nextIndex);
        if (totalSelected > 1) {
          setKeyboardCursorIndex(nextIndex); // Show cursor for pre-selection
          if (cursorTimeoutRef.current) clearTimeout(cursorTimeoutRef.current);
          cursorTimeoutRef.current = setTimeout(() => {
            setKeyboardCursorIndex(null);
          }, 1500);
        } else {
          setKeyboardCursorIndex(null); // Hide cursor when moving single selection
        }

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
            if (!item) continue;
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
      } else if (e.key === 'ArrowLeft' && e.altKey) {
        e.preventDefault();
        handleNavigateFolder(-1);
      } else if (e.key === 'ArrowRight' && e.altKey) {
        e.preventDefault();
        handleNavigateFolder(1);
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const cols = gridRef.current?.getCols?.() || 1;
        let delta = 0;
        if (e.key === 'ArrowRight') delta = 1;
        else if (e.key === 'ArrowLeft') delta = -1;
        else if (e.key === 'ArrowDown') delta = cols;
        else if (e.key === 'ArrowUp') delta = -cols;
        
        navigateSelection(delta, e.shiftKey);
      } else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSelectAll();
      } else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (selectedImages.size > 0 || selectedFolders.size > 0) handleCopySelected();
      } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (selectedImages.size > 0 || selectedFolders.size > 0) handleMoveSelected();
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
          const idx = order.indexOf(prev);
          const next = e.shiftKey
            ? order[(idx - 1 + order.length) % order.length]
            : order[(idx + 1) % order.length];
          localStorage.setItem('viewMode', next);
          return next;
        });
      } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) {
          setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
          setSortBy(prev => {
            const order = ['none', 'name', 'date', 'size'];
            const idx = order.indexOf(prev);
            return order[(idx + 1) % order.length];
          });
        }
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
        navigateSelection(e.shiftKey ? -1 : 1, false, true);
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
  }, [handleDeleteSelected, handleKeepSelected, handleLockSelected, handleUnlockSelected, handleDeselectAll, handleSelectAll, handleNavigateFolder, handleCopySelected, handleMoveSelected, handleOpenBulkRename, handleUseSelectedAsRefs, handleOpenInPhotoshop, handleInvertSelection, selectedImages, previewImage, viewMode, selectedFolders, handleOpenLastFolder, handleNavigateToFolder, handleNavigateUp, handleNavigateForward, handleOpenPreview, confirmDialog, renameModal, autoCropModal, metadataModal]);

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
  const buildContextItems = (image, empty = false) => {
    if (empty) {
      return [
        {
          label: (dragSelectEnabled ? '✓ ' : '\u00A0\u00A0') + 'Drag Select',
          onClick: () => handleDragSelectEnabledChange(!dragSelectEnabled)
        },
        { separator: true },
        {
          label: (autoReloadEnabled ? '✓ ' : '\u00A0\u00A0') + 'Auto-Reload Folder',
          onClick: () => {
            const next = !autoReloadEnabled;
            setAutoReloadEnabled(next);
            localStorage.setItem('autoReloadEnabled', next ? 'true' : 'false');
          }
        },
        {
          label: (!confirmRequired ? '✓ ' : '\u00A0\u00A0') + 'Disable Notifications',
          onClick: () => handleConfirmRequiredChange(!confirmRequired)
        },
        { separator: true },
        {
          label: (showNonImages ? '✓ ' : '\u00A0\u00A0') + 'Show non-image files',
          onClick: () => {
            const val = !showNonImages;
            setShowNonImages(val);
            localStorage.setItem('showNonImages', val);
          }
        }
      ];
    }
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
    <div 
      className="App"
      onDragOver={handleAppDragOver}
      onDrop={handleAppDrop}
    >
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
        folderLabel={folderLabel}
        driveLive={isDriveLive}
        lastFolderPath={lastFolderPath}
        recentFolders={recentFolders}
        onOpenLastFolder={handleOpenLastFolder}
        onSelectFolder={handleSelectFolder}
        onFolderPathEdit={handleFolderPathEdit}
        selectedCount={selectedImages.size + selectedFolders.size}
        totalCount={filteredImages.length + filteredSubfolders.length}
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
        filteredCount={filteredImages.length + filteredSubfolders.length}
        onMoveSelected={handleMoveSelected}
        isMoving={isMoving}
        onCopySelected={handleCopySelected}
        isCopying={isCopying}
        driveLabels={driveLabelsRef.current}
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
        onFindDuplicates={handleFindDuplicates}
        onFindSource={handleFindSource}
        onCluster={handleCluster}
        onShuffle={handleShuffle}
        activeAiAction={activeAiAction}
        customOrderActive={!!customOrder}
        onClearOrder={() => { setCustomOrder(null); setClusterAssignments(null); }}
        onClearAiScores={handleClearAiScores}
        profilesVersion={profilesVersion}
        onClearRefs={handleClearRefs}
        onUseSelectedAsRefs={handleUseSelectedAsRefs}
        activeCharacter={activeCharacter}
        onSetActiveCharacter={setActiveCharacter}
        driveSlot={
          <>
            <DriveButton
              localPath={isDriveLive ? null : folderPath}
              cacheRoot={driveCacheRoot}
              manifest={driveManifest}
              summary={driveSummary}
              onDatasetOpened={(cacheRoot) => loadElectronFolder(cacheRoot, true, true)}
              liveRequest={driveLiveRequest}
              onOpenLive={handleOpenLive}
              liveActive={isDriveLive}
            />
            <RemoteButton />
          </>
        }
      />

      <SubfolderBar
        subfolders={filteredSubfolders}
        parentFolderPath={parentFolderPath}
        currentFolder={folderPath}
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
        onDropOnFolder={handleDropOnFolder}
      />

      <ImageGrid
        ref={gridRef}
        cursorIndex={isShiftDown ? keyboardCursorRef.current : keyboardCursorIndex}
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
        isDeleting={isDeleting || isMoving || isCopying}
        deleteProgress={isCopying ? copyProgress : (isMoving ? moveProgress : deleteProgress)}
        actionText={isCopying ? "Copying" : (isMoving ? "Moving" : "Deleting")}
        orderedSelection={orderedSelection}
        orderSelectMode={orderSelectMode}
        onContextMenu={handleContextMenu}
        onEmptyContextMenu={handleEmptyContextMenu}
        onFolderContextMenu={handleFolderContextMenu}
        aiScores={aiScores}
        aiThreshold={aiThreshold}
        scanningPath={scanningPath}
        driveStatesByPath={driveStatesByPath}
        viewMode={viewMode}
        listDetail={listDetail}
        subfolders={filteredSubfolders}
        folderPreviews={folderPreviews}
        onFolderClick={handleFolderClick}
        editingFolderPath={editingFolderPath}
        onRenameCommit={handleRenameFolderCommit}
        onRenameCancel={() => setEditingFolderPath(null)}
        selectedFolders={selectedFolders}
        onFolderLongPress={handleFolderLongPress}
        clusterAssignments={clusterAssignments}
      />

      {previewImage && (
        <ImagePreviewModal
          image={previewImage}
          images={pagedImages}
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
          showNotice={showNotice}
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

      {noticeDialog && (
        <NoticeDialog
          title={noticeDialog.title}
          message={noticeDialog.message}
          variant={noticeDialog.variant}
          okLabel={noticeDialog.okLabel}
          onClose={handleNoticeClose}
        />
      )}

      {contextMenu && !browserMode && (
        <ContextMenu
          items={buildContextItems(contextMenu.image, contextMenu.empty)}
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

      {textModal && (
        <TextPreviewModal
          fileName={textModal.fileName}
          text={textModal.text}
          filePath={textModal.filePath}
          onClose={() => setTextModal(null)}
        />
      )}

      {renameModal && (
        <RenameModal
          images={renameModal.images}
          allImages={images}
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
      {drivePickAction && (
        isDriveLive ? (
          <DriveDestinationPicker
            action={drivePickAction}
            sourceFolderId={folderPath ? folderPath.replace(/^drive:\/\//, '').split('/').filter(Boolean).pop() : null}
            onSelect={handleDrivePickSelected}
            onCreateFolder={handleDrivePickCreateFolder}
            onClose={() => setDrivePickAction(null)}
          />
        ) : (
          <LocalDestinationPicker
            action={drivePickAction}
            startPath={
              (lastTargetRef.current.base === folderPath && lastTargetRef.current.target
                ? lastTargetRef.current.target
                : folderPath) || (lastFolderPath && !lastFolderPath.startsWith('drive://') ? lastFolderPath : '')
            }
            sourcePath={folderPath}
            onSelect={handleLocalPickSelected}
            onClose={() => setDrivePickAction(null)}
          />
        )
      )}

      {sourcePickerOpen && (
        <LocalDestinationPicker
          action="open"
          startPath={folderPath && !folderPath.startsWith('drive://') ? folderPath : (lastFolderPath && !lastFolderPath.startsWith('drive://') ? lastFolderPath : '')}
          sourcePath={folderPath}
          onSelect={handleSourcePickSelected}
          onClose={handleSourcePickClose}
        />
      )}

    </div>
  );
}

export default App;
