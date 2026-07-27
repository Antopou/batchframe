import React, { useEffect, useState, useRef, memo } from 'react';
import './ImageCard.css';

const imageCache = new Map();

function ImageCard({ image, imageIndex, isSelected, isLocked, isAnchor, onCardClick, onToggleLock, onDragMouseDown, onDragMouseEnter, onPreview, size, imageFitMode, orderNumber, orderSelectMode, onContextMenu, aiScore, aiCharacter, aiHit, isScanning, driveState, onDragStartImage }) {
  const [src, setSrc] = useState(image.previewSrc || '');
  const [imageError, setImageError] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [naturalSize, setNaturalSize] = useState(null);
  const [dragReady, setDragReady] = useState(false);
  
  const prevSrcRef  = useRef('');
  const isFirstLoad = useRef(true);
  const lastClickTimeRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const cacheKey = image.mtime != null ? `${image.path}::${image.mtime}` : image.path;

    const load = async () => {
      setImageError(false);
      if (image.previewSrc) {
        setSrc(image.previewSrc);
        prevSrcRef.current = image.previewSrc;
        isFirstLoad.current = false;
        return;
      }
      if (!window.electronAPI || !image.path) { setSrc(''); return; }

      const cached = imageCache.get(cacheKey);
      if (cached) {
        setSrc(cached);
        prevSrcRef.current = cached;
        isFirstLoad.current = false;
        return;
      }

      // If we already showed an image, this is a mtime-change update — dim old, don't shimmer
      const isUpdate = !isFirstLoad.current && !!prevSrcRef.current;
      if (isUpdate) setIsUpdating(true);

      try {
        // 'thumb' is a hint for Drive-backed paths (serves a small thumbnail
        // as a full data: URI); local paths ignore it and return bare base64.
        const base64 = await window.electronAPI.getImageData(image.path, 'thumb');
        if (!base64 || cancelled) return;

        const ext = (image.name || '').toLowerCase().split('.').pop();
        const mime = ext === 'png' ? 'image/png'
          : ext === 'gif' ? 'image/gif'
          : ext === 'webp' ? 'image/webp'
          : ext === 'bmp' ? 'image/bmp'
          : ext === 'svg' ? 'image/svg+xml'
          : 'image/jpeg';

        const dataUrl = base64.startsWith('data:') ? base64 : `data:${mime};base64,${base64}`;
        if (imageCache.size >= 500) {
          imageCache.delete(imageCache.keys().next().value);
        }
        imageCache.set(cacheKey, dataUrl);
        setSrc(dataUrl);
        prevSrcRef.current = dataUrl;
        isFirstLoad.current = false;
      } catch (err) {
        if (!cancelled) console.error('Failed to load image:', err);
      } finally {
        if (!cancelled) setIsUpdating(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [image.path, image.previewSrc, image.name, image.mtime]);

  const handleClick = (event) => {
    const now = Date.now();
    const timeSinceLastClick = now - lastClickTimeRef.current;

    // Check if it's a native double click or our custom timer double click
    if (event.detail >= 2 || timeSinceLastClick < 400) {
      onPreview(image, imageIndex);
      lastClickTimeRef.current = 0; // Reset so triple click doesn't trigger again
    } else {
      onCardClick(image.path, imageIndex, event.shiftKey);
      lastClickTimeRef.current = now;
    }
  };

  const handleMouseDown = (event) => {
    if (!onDragMouseDown) return;
    onDragMouseDown(image.path, imageIndex, isSelected, event.button);
  };

  const handleMouseEnter = () => {
    if (!onDragMouseEnter) return;
    onDragMouseEnter(image.path, imageIndex);
  };

  const handleLockClick = (event) => {
    event.stopPropagation();
    if (onToggleLock) {
      onToggleLock(image.path);
    }
  };

  const handleImageError = () => {
    setImageError(true);
  };

  const handleRetryLoad = () => {
    setImageError(false);
    if (image.path) {
      imageCache.delete(image.path);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    if (onContextMenu) onContextMenu(e, image);
  };

  const handleImageLoad = (e) => {
    if (e.target.naturalWidth && e.target.naturalHeight) {
      setNaturalSize({ width: e.target.naturalWidth, height: e.target.naturalHeight });
    }
  };

  const displayWidth = image.width || naturalSize?.width;
  const displayHeight = image.height || naturalSize?.height;

  const ext = (image.name || '').toLowerCase().split('.').pop();
  const isNonImage = ['safetensors', 'zip', 'txt', 'torrent', 'ckpt', 'pt'].includes(ext);

  return (
    <div
      data-path={image.path}
      className={`image-card ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''} ${isAnchor ? 'cursor' : ''} ${imageFitMode === 'contain' ? 'fit-contain' : 'fit-cover'} ${isUpdating ? 'updating' : ''} ${isScanning ? 'scanning' : ''} ${isNonImage ? 'is-non-image' : ''}`}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onContextMenu={handleContextMenu}
      title={`${image.name}${isLocked ? ' (locked)' : ''}`}
    >
      {isNonImage ? (
        <div className="non-image-placeholder">
          <div className="non-image-ext">{ext}</div>
        </div>
      ) : !src ? (
        <div className="image-loading-placeholder">
        </div>
      ) : imageError ? (
        <div className="image-error-placeholder" onClick={handleRetryLoad}>
          <div className="error-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div className="error-text">Click to retry</div>
        </div>
      ) : (
        <img 
          src={src} 
          alt={image.name} 
          loading="lazy" 
          decoding="async" 
          onError={handleImageError}
          onLoad={handleImageLoad}
        />
      )}
      <div className="image-card-overlay">
        <div className="checkbox">
          {isSelected && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
        </div>
        {orderSelectMode && orderNumber != null && (
          <div className="order-badge">{orderNumber}</div>
        )}
        {isLocked && (
          <div className="lock-indicator" onClick={handleLockClick} title="Click to unlock">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
        )}
      </div>
      {aiScore != null && (
        <div className={`ai-score-badge${aiHit ? ' ai-hit' : ''}`} title={`AI similarity: ${(aiScore * 100).toFixed(1)}%${aiCharacter ? ` (${aiCharacter})` : ''}`}>
          {aiCharacter && <span className="ai-badge-char">{aiCharacter}</span>}
          {Math.round(aiScore * 100)}%
        </div>
      )}
      {displayWidth && displayHeight && (
        <div className="dimension-badge">{displayWidth}×{displayHeight}</div>
      )}
      {driveState && driveState !== 'clean' && (
        <div className={`drive-state-dot drive-state-${driveState}`} title={`Drive: ${driveState}`} />
      )}
      <div className="image-card-name">{image.name}</div>
    </div>
  );
}

export default memo(ImageCard);
