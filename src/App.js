import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import './App.css';
import Controls from './components/Controls';
import ImageGrid from './components/ImageGrid';
import SubfolderBar from './components/SubfolderBar';
import ImagePreviewModal from './components/ImagePreviewModal';
import ConfirmDialog from './components/ConfirmDialog';
import ContextMenu from './components/ContextMenu';
import MetadataModal from './components/MetadataModal';

const LAST_FOLDER_KEY = 'images-selector-last-folder';
const CONFIRM_REQUIRED_KEY = 'images-selector-confirm-required';
const PREVIEW_MIN = 80;
const PREVIEW_MAX = 300;
const PREVIEW_STEP = 12;

function clamp(value) {
  return Math.max(PREVIEW_MIN, Math.min(PREVIEW_MAX, value));
}

function App() {
  const fileInputRef = useRef(null);
  const gridRef = useRef(null);

  const [folderPath, setFolderPath] = useState('');
  const [images, setImages] = useState([]);
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [previewSize, setPreviewSize] = useState(150);
  const [imageFitMode, setImageFitMode] = useState('contain');
  const [dragSelectEnabled, setDragSelectEnabled] = useState(true);
  const [pageSize, setPageSize] = useState(300);
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

  // Lock functionality state
  const [lockedImages, setLockedImages] = useState(new Set());

  // Subfolder navigation state
  const [subfolders, setSubfolders] = useState([]);
  const [parentFolderPath, setParentFolderPath] = useState(null);

  // Subfolder bar visibility state
  const [subfolderBarVisible, setSubfolderBarVisible] = useState(true);
  const [subfolderBarPinned, setSubfolderBarPinned] = useState(true);
  const lastSubfolderScrollY = useRef(0);

  // Recent folders state
  const [recentFolders, setRecentFolders] = useState([]);
  const [showRecentFolders, setShowRecentFolders] = useState(false);

  // Preview modal state
  const [previewImage, setPreviewImage] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  // Help state
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Spacebar scrolling state
  const [spacebarPressed, setSpacebarPressed] = useState(false);
  const scrollIntervalRef = useRef(null);

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

  // Move state
  const [isMoving, setIsMoving] = useState(false);
  const [moveProgress, setMoveProgress] = useState({ current: 0, total: 0 });

  // Auto-reload state
  const [autoReloadEnabled, setAutoReloadEnabled] = useState(() => localStorage.getItem('autoReloadEnabled') === 'true');

  // Context menu state
  const [contextMenu, setContextMenu]     = useState(null); // { x, y, image } | null
  const [metadataModal, setMetadataModal] = useState(null); // { imageName, metadata } | null

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
    const savedRecent = localStorage.getItem('images-selector-recent-folders');
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

  // ── Search filter ───────────────────────────────────────────────
  const filteredImages = useMemo(() => {
    if (!searchQuery.trim()) return sortedImages;
    const q = searchQuery.toLowerCase();
    return sortedImages.filter(img => img.name.toLowerCase().includes(q));
  }, [sortedImages, searchQuery]);

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

  // ── Folder loading ──────────────────────────────────────────────
  const loadElectronFolder = useCallback(async (pathToLoad, persist = true) => {
    if (!pathToLoad) return;
    setFolderPath(pathToLoad);
    setLoading(true);
    try {
      const [list, folderInfo] = await Promise.all([
        window.electronAPI.getImages(pathToLoad),
        window.electronAPI.getSubfolders(pathToLoad),
      ]);
      setImages(list.map((img) => ({ ...img, previewSrc: '', source: 'electron' })));
      setSubfolders(folderInfo.subfolders);
      setParentFolderPath(folderInfo.parentPath);
      setSubfolderBarVisible(true);
      setSelectedImages(new Set());
      setLockedImages(new Set());
      setCurrentPage(1);
      if (persist) {
        localStorage.setItem(LAST_FOLDER_KEY, pathToLoad);
        setLastFolderPath(pathToLoad);
        
        // Update recent folders
        setRecentFolders((prev) => {
          const updated = [pathToLoad, ...prev.filter((f) => f !== pathToLoad)].slice(0, 10);
          localStorage.setItem('images-selector-recent-folders', JSON.stringify(updated));
          return updated;
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial folder from CLI arg (e.g. `app.exe C:\images\foo`)
  useEffect(() => {
    if (!window.electronAPI?.onInitialFolder) return;
    window.electronAPI.onInitialFolder((folder) => {
      if (folder) loadElectronFolder(folder, true);
    });
  }, [loadElectronFolder]);

  const handleSelectFolder = useCallback(async () => {
    if (window.electronAPI) {
      try {
        const path = await window.electronAPI.selectFolder();
        if (!path) return;
        await loadElectronFolder(path, true);
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
      await loadElectronFolder(lastFolderPath, true);
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
    setLockedImages(new Set());
    setCurrentPage(1);
  }, []);

  const handleFolderPathEdit = useCallback(async (newPath) => {
    if (!newPath || !window.electronAPI) return;
    await loadElectronFolder(newPath, true);
    setShowRecentFolders(false);
  }, [loadElectronFolder]);

  const handleRecentFolderClick = useCallback((folder) => {
    setFolderPath(folder);
    setShowRecentFolders(false);
    loadElectronFolder(folder, true);
  }, [loadElectronFolder]);

  // ── Preview modal functions ─────────────────────────────
  const handleOpenPreview = useCallback((image, index) => {
    setPreviewImage(image);
    setPreviewIndex(index);
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

  const handleDeselectAll = useCallback(() => setSelectedImages(new Set()), []);

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

  // ── Auto-reload toggle ─────────────────────────────────────────
  const handleAutoReloadChange = useCallback((enabled) => {
    setAutoReloadEnabled(enabled);
    localStorage.setItem('autoReloadEnabled', String(enabled));
  }, []);

  // ── Range select (Shift+Click) ────────────────────────────────
  const handleShiftSelectRange = useCallback((startIdx, endIdx) => {
    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);
    setSelectedImages((prev) => {
      const next = new Set(prev);
      pagedImages.slice(min, max + 1).forEach((img) => next.add(img.path));
      return next;
    });
  }, [pagedImages]);

  // ── Range select (drag — Google Drive style) ──────────────────
  const handleSetRangeSelectedFinal = useCallback((startIdx, endIdx, mode, snapshot) => {
    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);
    const next = new Set(snapshot);
    pagedImages.slice(min, max + 1).forEach((img) => {
      if (mode === 'select') next.add(img.path);
      else next.delete(img.path);
    });
    setSelectedImages(next);
  }, [pagedImages]);

  // ── Delete selected ─────────────────────────────────────────────
  const handleDeleteSelected = useCallback(async () => {
    if (selectedImages.size === 0) return;
    const imageList = selectedImages.size === images.length ? images : images.filter(img => selectedImages.has(img.path));
    const safeImages = imageList.filter(img => !lockedImages.has(img.path));
    if (safeImages.length === 0) return;
    const proceed = confirmRequired ? await showConfirm('Delete', `Permanently delete ${safeImages.length} image${safeImages.length > 1 ? 's' : ''}?`) : true;
    if (!proceed) return;
    
    // Find the index of the last selected image to determine where to scroll
    const selectedIndices = Array.from(selectedImages).map(path => images.findIndex(img => img.path === path)).sort((a, b) => a - b);
    const lastSelectedIndex = selectedIndices[selectedIndices.length - 1];
    
    setIsDeleting(true);
    setDeleteProgress({ current: 0, total: safeImages.length });
    try {
      if (browserMode) {
        // Browser mode - just remove from state
        await new Promise(resolve => setTimeout(resolve, 300)); // Simulate operation
        setImages(prev => prev.filter(img => !selectedImages.has(img.path)));
      } else {
        // Electron mode - delete files
        await window.electronAPI.deleteImages(safeImages.map(img => img.path));
        setImages(prev => prev.filter(img => !selectedImages.has(img.path)));
      }
      setSelectedImages(new Set());
      
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
  }, [selectedImages, images, lockedImages, confirmRequired, showConfirm, browserMode, previewSize]);

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
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (e.shiftKey) handleKeepSelected(); else handleDeleteSelected();
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (e.shiftKey) handleUnlockSelected(); else handleLockSelected();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (!previewImage) handleDeselectAll();
      } else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSelectAll();
      } else if (e.key === ' ') {
        e.preventDefault();
        
        // Smooth, controllable scrolling
        const scrollStep = () => {
          const grid = gridRef.current;
          if (grid) {
            const viewport = grid.getViewport();
            if (viewport) {
              // Moderate scroll amount for control
              viewport.scrollTop += e.shiftKey ? -80 : 80;
            }
          }
        };
        
        scrollStep(); // Scroll immediately
        // Continue scrolling while key is held - smooth and controllable
        if (!spacebarPressed) {
          setSpacebarPressed(true);
          const interval = setInterval(scrollStep, 60); // ~16 FPS for smooth control
          scrollIntervalRef.current = interval;
        }
      }
    };
    window.addEventListener('keydown', handler);
    
    const keyupHandler = (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        setSpacebarPressed(false);
        if (scrollIntervalRef.current) {
          clearInterval(scrollIntervalRef.current);
          scrollIntervalRef.current = null;
        }
      }
    };
    window.addEventListener('keyup', keyupHandler);
    
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', keyupHandler);
    };
  }, [handleDeleteSelected, handleKeepSelected, handleLockSelected, handleUnlockSelected, handleDeselectAll, handleSelectAll, spacebarPressed, previewImage]);

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
      <header className={`App-header ${headerVisible ? 'header-visible' : 'header-hidden'}`}>
        <img src="/app_icon.png" alt="App Icon" className="header-icon" />
        <h1>Image Dataset Selector</h1>
        <div className="header-divider" />
        <p>Select images for your training dataset</p>
      </header>

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
        selectedCount={selectedImages.size}
        totalCount={images.length}
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
        hasSubfolders={subfolders.length > 0}
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
        autoReloadEnabled={autoReloadEnabled}
        onAutoReloadChange={handleAutoReloadChange}
      />

      <SubfolderBar
        subfolders={subfolders}
        parentFolderPath={parentFolderPath}
        onNavigate={loadElectronFolder}
        visible={subfolderBarVisible}
      />

      <ImageGrid
        ref={gridRef}
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
      />

      {previewImage && (
        <ImagePreviewModal
          image={previewImage}
          images={images}
          currentIndex={previewIndex}
          onClose={handleClosePreview}
          onNext={handleNextPreview}
          onPrev={handlePrevPreview}
          onLock={handleToggleLock}
          onDelete={handleDeleteSelected}
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

      {metadataModal && (
        <MetadataModal
          imageName={metadataModal.imageName}
          metadata={metadataModal.metadata}
          onClose={() => setMetadataModal(null)}
        />
      )}
    </div>
  );
}

export default App;
