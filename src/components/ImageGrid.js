import React, { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import './ImageGrid.css';
import ImageCard from './ImageCard';

const ITEM_HEIGHT = 200; // adjust this value based on your image card height
const BUFFER_SIZE = 10; // adjust this value based on your performance needs

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
}, ref) {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const viewportRef = useRef(null);
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

  const gridStyle = useMemo(() => ({
    gridTemplateColumns: `repeat(auto-fill, minmax(${previewSize}px, 1fr))`,
    gap: '10px',
  }), [previewSize]);

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

  const visibleGrid = useMemo(() => images.map((image, index) => (
    <ImageCard
      key={image.path}
      image={image}
      imageIndex={index}
      isSelected={selectedImages.has(image.path)}
      isLocked={lockedImages.has(image.path)}
      isAnchor={index === anchorIndex}
      onCardClick={handleCardClick}
      onToggleLock={onToggleLock}
      onDragMouseDown={dragSelectEnabled ? handleCardMouseDown : undefined}
      onDragMouseEnter={dragSelectEnabled ? handleCardMouseEnter : undefined}
      onPreview={onPreview}
      size={previewSize}
      imageFitMode={imageFitMode}
      orderNumber={orderMap.get(image.path) ?? null}
      orderSelectMode={orderSelectMode}
      onContextMenu={onContextMenu}
      aiScore={aiScores?.[image.path]?.score}
      aiCharacter={aiScores?.[image.path]?.character}
      aiHit={aiScores && aiThreshold != null && (aiScores[image.path]?.score ?? -1) >= aiThreshold}
      isScanning={image.path === scanningPath}
    />
  )), [images, selectedImages, lockedImages, anchorIndex, handleCardClick, onToggleLock, dragSelectEnabled, handleCardMouseDown, handleCardMouseEnter, onPreview, previewSize, imageFitMode, orderMap, orderSelectMode, onContextMenu, aiScores, aiThreshold, scanningPath]);

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
    <div ref={viewportRef} className={`image-grid-viewport${isDragging ? ' selecting' : ''}`}>
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
      <div
        className="image-grid"
        style={gridStyle}
      >
        {visibleGrid}
      </div>
    </div>
  );
});

export default ImageGrid;
