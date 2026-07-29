import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import './ImageGrid.css';
import ImageCard from './ImageCard';
import ImageRow from './ImageRow';
import FolderThumbnail from './FolderThumbnail';

// Grid geometry — must match the viewport padding in ImageGrid.css
// (.image-grid-viewport { padding: 16px 20px }) and the gap below, so the
// windowing math lines up with what the browser actually lays out.
const GAP = 10;
const PAD_H = 40; // 20px left + 20px right
const BUFFER_ROWS = 4; // extra rows rendered above/below the viewport

const ImageGrid = forwardRef(function ImageGrid({
  images,
  selectedImages,
  lockedImages,
  onToggleImage,
  onToggleLock,
  onSetRangeSelected,
  onShiftSelectRange,
  onPreview,
  dragSelectEnabled,
  previewSize,
  imageFitMode,
  loading,
  isDeleting,
  deleteProgress,
  actionText = 'Deleting',
  orderedSelection,
  orderSelectMode,
  onContextMenu,
  onFolderContextMenu,
  aiScores,
  aiThreshold,
  scanningPath,
  driveStatesByPath,
  viewMode = 'grid',
  listDetail = 'thumb',
  subfolders = [],
  folderPreviews,
  onFolderClick,
  editingFolderPath,
  onRenameCommit,
  onRenameCancel,
  selectedFolders,
  onFolderLongPress,
  cursorIndex,
  onDropOnFolder,
  onEmptyContextMenu,
  clusterAssignments,
}, ref) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [gridW, setGridW] = useState(0);
  const viewportRef = useRef(null);
  const scrollRaf = useRef(null);
  const [anchorIndex, setAnchorIndex] = useState(null);
  const dragRef = useRef({ active: false, startIndex: -1, mode: 'select', snapshot: null, moved: false });
  const [isDragging, setIsDragging] = useState(false);
  const selectedImagesRef = useRef(selectedImages);
  const colsRef = useRef(1);
  const rowHRef = useRef(0);
  const gapRef = useRef(0);

  useImperativeHandle(ref, () => ({
    scrollToIndex(index) {
      if (!viewportRef.current || index < 0) return;
      const vp = viewportRef.current;
      const cols = colsRef.current;
      const rowH = rowHRef.current;
      const gap = gapRef.current;
      const padV = 16;
      
      const row = Math.floor(index / cols);
      const rowTop = padV + row * rowH;
      const itemHeight = rowH - gap;
      const rowBot = rowTop + itemHeight;
      
      const { scrollTop, clientHeight } = vp;
      
      // If the item is below the viewport, scroll down just enough
      if (rowBot > scrollTop + clientHeight) {
        vp.scrollTo({ top: rowBot - clientHeight + gap });
      } 
      // If the item is above the viewport, scroll up just enough
      else if (rowTop < scrollTop) {
        vp.scrollTo({ top: Math.max(0, rowTop - padV) });
      }
    },
    scrollToTop() {
      if (viewportRef.current) viewportRef.current.scrollTop = 0;
    },
    scrollToBottom() {
      if (viewportRef.current) viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    },
    isNearBottom(threshold = 300) {
      if (!viewportRef.current) return true;
      const vp = viewportRef.current;
      return vp.scrollHeight - vp.scrollTop - vp.clientHeight < threshold;
    },
    getViewport() {
      return viewportRef.current;
    },
    scrollBy(options) {
      if (viewportRef.current && typeof viewportRef.current.scrollBy === 'function') {
        viewportRef.current.scrollBy(options);
      }
    },
    getCols() {
      return colsRef.current;
    }
  }));

  useEffect(() => {
    selectedImagesRef.current = selectedImages;
  }, [selectedImages]);

  useEffect(() => {
    const handleMouseUp = () => {
      if (dragRef.current.active) {
        dragRef.current.active = false;
        setIsDragging(false);
      }
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // Explorer view: merge subfolders + images into a single windowed grid.
  // Otherwise entries contain only images (folders live in SubfolderBar).
  const isExplorer = viewMode === 'explorer';
  const folderCount = isExplorer ? subfolders.length : 0;
  const entries = useMemo(() => {
    if (isExplorer) {
      return [
        ...subfolders.map((f) => ({ kind: 'folder', folder: f })),
        ...images.map((img) => ({ kind: 'image', image: img })),
      ];
    }
    return images.map((img) => ({ kind: 'image', image: img }));
  }, [isExplorer, subfolders, images]);

  const showEmptyFolders = !loading && images.length === 0 && subfolders.length > 0 && !isExplorer;
  const showGrid = !loading && entries.length > 0;

  // Measure the viewport (height + inner content width) so we can window rows.
  useLayoutEffect(() => {
    if (!showGrid && !showEmptyFolders) return;
    const vp = viewportRef.current;
    if (!vp) return;
    const measure = () => {
      setViewportH(vp.clientHeight);
      setGridW(vp.clientWidth - PAD_H);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [showGrid, showEmptyFolders]);

  const handleScroll = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || scrollRaf.current != null) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = null;
      setScrollTop(vp.scrollTop);
    });
  }, []);

  const handleCardMouseDown = useCallback((imagePath, imageIndex, isSelected, mouseButton) => {
    if (!dragSelectEnabled || mouseButton !== 0) return;
    const mode = isSelected ? 'deselect' : 'select';
    const snapshot = new Set(selectedImagesRef.current);
    dragRef.current = { active: true, startIndex: imageIndex, mode, snapshot, moved: false };
    setIsDragging(true);
  }, [dragSelectEnabled]);

  const handleCardMouseEnter = useCallback((imagePath, imageIndex) => {
    const ds = dragRef.current;
    if (!dragSelectEnabled || !ds.active) return;
    if (imageIndex !== ds.startIndex) ds.moved = true;
    onSetRangeSelected(ds.startIndex, imageIndex, ds.mode, ds.snapshot);
  }, [dragSelectEnabled, onSetRangeSelected]);

  const handleCardClick = useCallback((imagePath, imageIndex, shiftKey) => {
    if (dragSelectEnabled && dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    if (orderSelectMode) {
      onToggleImage(imagePath);
      return;
    }
    if (shiftKey && anchorIndex !== null) {
      onShiftSelectRange(anchorIndex, imageIndex);
    } else {
      onToggleImage(imagePath);
      if (!selectedImagesRef.current.has(imagePath)) {
        setAnchorIndex(imageIndex);
      }
    }
  }, [dragSelectEnabled, onToggleImage, onShiftSelectRange, anchorIndex, orderSelectMode]);

  const orderMap = useMemo(() => {
    const m = new Map();
    if (orderedSelection) orderedSelection.forEach((p, i) => m.set(p, i + 1));
    return m;
  }, [orderedSelection]);

  // Per-cluster image counts — used by the sticky header to show group size.
  const clusterCounts = useMemo(() => {
    if (!clusterAssignments) return null;
    const counts = new Map();
    for (const img of images) {
      const cid = clusterAssignments[img.path];
      if (cid == null) continue;
      counts.set(cid, (counts.get(cid) || 0) + 1);
    }
    return counts;
  }, [clusterAssignments, images]);

  // ── Windowing geometry ──────────────────────────────────────────
  const isList = viewMode === 'list';
  const isPlain = isList && listDetail === 'plain';
  const LIST_ROW_H = isPlain ? 32 : 56;
  const LIST_GAP = isPlain ? 2 : 6;
  const gridCols = Math.max(1, Math.floor((gridW + GAP) / (previewSize + GAP)));
  const gridColW = gridW > 0 ? (gridW - (gridCols - 1) * GAP) / gridCols : previewSize;

  const cols = isList ? 1 : gridCols;
  colsRef.current = cols;
  const rowH = isList ? LIST_ROW_H + LIST_GAP : gridColW + GAP;
  rowHRef.current = rowH;
  const gapForMode = isList ? LIST_GAP : GAP;
  gapRef.current = gapForMode;
  const totalRows = Math.ceil(entries.length / cols);
  const totalHeight = Math.max(0, totalRows * rowH - gapForMode);

  const startRow = Math.max(0, Math.floor(scrollTop / rowH) - BUFFER_ROWS);
  const endRow = Math.min(totalRows - 1, Math.ceil((scrollTop + viewportH) / rowH) + BUFFER_ROWS);
  const startIndex = startRow * cols;
  const endIndex = Math.min(entries.length, (endRow + 1) * cols);
  const offsetY = startRow * rowH;

  // Sticky header: which cluster is dominant at the current scroll position?
  // Peek at the first image entry near the top of the viewport (accounting for
  // buffer rows).
  const currentClusterId = useMemo(() => {
    if (!clusterAssignments) return null;
    const topRow = Math.max(0, Math.floor(scrollTop / rowH));
    const peek = topRow * cols;
    for (let i = peek; i < entries.length; i++) {
      const e = entries[i];
      if (e && e.kind === 'image') {
        const cid = clusterAssignments[e.image.path];
        return cid == null ? null : cid;
      }
    }
    return null;
  }, [clusterAssignments, scrollTop, rowH, cols, entries]);

  const gridStyle = useMemo(() => ({
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gap: `${gapForMode}px`,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    transform: `translateY(${offsetY}px)`,
  }), [cols, offsetY, gapForMode]);

  const visibleCards = [];
  for (let index = startIndex; index < endIndex; index++) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.kind === 'folder') {
      const f = entry.folder;
      const preview = folderPreviews?.get?.(f.path) || [];
      visibleCards.push(
        <FolderThumbnail
          key={`folder:${f.path}`}
          folder={f}
          preview={preview}
          onClick={onFolderClick}
          onContextMenu={onFolderContextMenu}
          isEditing={editingFolderPath === f.path}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
          isSelected={selectedFolders && selectedFolders.has(f.path)}
          onLongPress={onFolderLongPress}
          onDropOnFolder={onDropOnFolder}
        />
      );
      continue;
    }
    const image = entry.image;
    const imageIndex = index - folderCount;
    const common = {
      key: image.path,
      image,
      imageIndex,
      isSelected: selectedImages.has(image.path),
      isLocked: lockedImages.has(image.path),
      onCardClick: handleCardClick,
      onToggleLock,
      onDragMouseDown: dragSelectEnabled ? handleCardMouseDown : undefined,
      onDragMouseEnter: dragSelectEnabled ? handleCardMouseEnter : undefined,
      onPreview,
      orderNumber: orderMap.get(image.path) ?? null,
      orderSelectMode,
      onContextMenu,
      aiScore: aiScores?.[image.path]?.score,
      aiCharacter: aiScores?.[image.path]?.character,
      aiHit: aiScores && aiThreshold != null && (aiScores[image.path]?.score ?? -1) >= aiThreshold,
      isScanning: image.path === scanningPath,
      driveState: driveStatesByPath?.[image.path] || null,
      clusterId: clusterAssignments ? clusterAssignments[image.path] : null,
    };

    const isCursor = cursorIndex !== undefined && cursorIndex !== null && imageIndex === (cursorIndex - folderCount);

    visibleCards.push(
      isList
        ? <ImageRow {...common} detail={listDetail} />
        : <ImageCard {...common} isAnchor={isCursor} size={previewSize} imageFitMode={imageFitMode} />
    );
  }

  if (loading) {
    return (
      <div className="loading-state">
        <div className="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    );
  }

  // Empty images but has subfolders → show folder tiles instead of placeholder.
  if (showEmptyFolders) {
    return (
      <div
        ref={viewportRef}
        className="image-grid-viewport"
        onScroll={handleScroll}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget || e.target.classList.contains('image-grid')) {
            onEmptyContextMenu?.(e);
          }
        }}
      >
        <div
          className="image-grid"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${previewSize}px, 1fr))`,
            gap: `${GAP}px`,
          }}
        >
          {subfolders.map((f) => (
            <FolderThumbnail
              key={`folder-empty:${f.path}`}
              folder={f}
              preview={folderPreviews?.get?.(f.path) || []}
              onClick={onFolderClick}
              onContextMenu={onFolderContextMenu}
            />
          ))}
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2"/>
            <circle cx="9" cy="9" r="2"/>
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
          </svg>
        </div>
        <h3>No images loaded</h3>
        <p>Select a folder to get started.</p>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={`image-grid-viewport${isDragging ? ' selecting' : ''}`}
      onScroll={handleScroll}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget || e.target.classList.contains('image-grid')) {
          onEmptyContextMenu?.(e);
        }
      }}
    >
      {currentClusterId != null && clusterCounts && (
        <div className="cluster-sticky-header" data-cluster={currentClusterId}>
          <span className="cluster-dot" style={{ background: `hsl(${(currentClusterId * 47) % 360}, 62%, 55%)` }} />
          Cluster {currentClusterId + 1}
          <span className="cluster-count">· {clusterCounts.get(currentClusterId) ?? 0} images</span>
        </div>
      )}
      {isDeleting && (
        <div className="delete-overlay">
          <div className="delete-indicator">
            <div className="delete-spinner"></div>
            <div className="delete-text">
              {deleteProgress && deleteProgress.total > 0
                ? `${actionText} ${deleteProgress.current} / ${deleteProgress.total} images...`
                : `${actionText} images...`}
            </div>
            {deleteProgress && deleteProgress.total > 0 && (
              <div className="delete-progress-bar-container">
                <div
                  className="delete-progress-bar-fill"
                  style={{ width: `${(deleteProgress.current / deleteProgress.total) * 100}%` }}
                ></div>
              </div>
            )}
          </div>
        </div>
      )}
      <div style={{ height: totalHeight, position: 'relative', width: '100%' }}>
        <div className="image-grid" style={gridStyle}>
          {visibleCards}
        </div>
      </div>
    </div>
  );
});

export default ImageGrid;
