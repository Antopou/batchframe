import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import './ImageGrid.css';
import ImageCard from './ImageCard';
import ImageRow from './ImageRow';

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
  orderedSelection,
  orderSelectMode,
  onContextMenu,
  aiScores,
  aiThreshold,
  scanningPath,
  driveStatesByPath,
  viewMode = 'grid',
  listDetail = 'thumb',
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

  useImperativeHandle(ref, () => ({
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

  const showGrid = !loading && images.length > 0;

  // Measure the viewport (height + inner content width) so we can window rows.
  // useLayoutEffect + ResizeObserver so sizes are set before the first paint.
  useLayoutEffect(() => {
    if (!showGrid) return;
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
  }, [showGrid]);

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
      setAnchorIndex(imageIndex);
      onToggleImage(imagePath);
    }
  }, [dragSelectEnabled, onToggleImage, onShiftSelectRange, anchorIndex, orderSelectMode]);

  const orderMap = useMemo(() => {
    const m = new Map();
    if (orderedSelection) orderedSelection.forEach((p, i) => m.set(p, i + 1));
    return m;
  }, [orderedSelection]);

  // ── Windowing geometry ──────────────────────────────────────────
  // Grid: square cards (aspect-ratio: 1/1), so row height == column width.
  // List: fixed row height, one column.
  const isList = viewMode === 'list';
  const isPlain = isList && listDetail === 'plain';
  const LIST_ROW_H = isPlain ? 32 : 56;
  const LIST_GAP = isPlain ? 2 : 6;
  const gridCols = Math.max(1, Math.floor((gridW + GAP) / (previewSize + GAP)));
  const gridColW = gridW > 0 ? (gridW - (gridCols - 1) * GAP) / gridCols : previewSize;

  const cols = isList ? 1 : gridCols;
  const rowH = isList ? LIST_ROW_H + LIST_GAP : gridColW + GAP;
  const gapForMode = isList ? LIST_GAP : GAP;
  const totalRows = Math.ceil(images.length / cols);
  const totalHeight = Math.max(0, totalRows * rowH - gapForMode);

  const startRow = Math.max(0, Math.floor(scrollTop / rowH) - BUFFER_ROWS);
  const endRow = Math.min(totalRows - 1, Math.ceil((scrollTop + viewportH) / rowH) + BUFFER_ROWS);
  const startIndex = startRow * cols;
  const endIndex = Math.min(images.length, (endRow + 1) * cols);
  const offsetY = startRow * rowH;

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
    const image = images[index];
    if (!image) continue;
    const common = {
      key: image.path,
      image,
      imageIndex: index,
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
    };
    visibleCards.push(
      isList
        ? <ImageRow {...common} detail={listDetail} />
        : <ImageCard {...common} isAnchor={index === anchorIndex} size={previewSize} imageFitMode={imageFitMode} />
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

  if (images.length === 0) {
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
    >
      {isDeleting && (
        <div className="delete-overlay">
          <div className="delete-indicator">
            <div className="delete-spinner"></div>
            <div className="delete-text">
              {deleteProgress && deleteProgress.total > 0
                ? `Deleting ${deleteProgress.current} / ${deleteProgress.total} images...`
                : 'Deleting images...'}
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
