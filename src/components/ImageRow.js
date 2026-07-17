import React, { memo, useEffect, useRef, useState } from 'react';
import './ImageRow.css';

const imageCache = new Map();

function ImageRow({
  image, imageIndex, isSelected, isLocked, onCardClick, onToggleLock,
  onDragMouseDown, onDragMouseEnter, onPreview,
  orderNumber, orderSelectMode, onContextMenu,
  aiScore, aiCharacter, aiHit, isScanning, driveState, onDragStartImage,
  detail = 'thumb',
}) {
  const [src, setSrc] = useState(image.previewSrc || '');
  const [imageError, setImageError] = useState(false);
  const wantThumb = detail !== 'plain';

  useEffect(() => {
    if (!wantThumb) { setSrc(''); return; }
    let cancelled = false;
    const cacheKey = image.mtime != null ? `${image.path}::${image.mtime}` : image.path;
    const load = async () => {
      setImageError(false);
      if (image.previewSrc) { setSrc(image.previewSrc); return; }
      if (!window.electronAPI || !image.path) { setSrc(''); return; }
      const cached = imageCache.get(cacheKey);
      if (cached) { setSrc(cached); return; }
      try {
        const base64 = await window.electronAPI.getImageData(image.path);
        if (!base64 || cancelled) return;
        const ext = (image.name || '').toLowerCase().split('.').pop();
        const mime = ext === 'png' ? 'image/png'
          : ext === 'gif' ? 'image/gif'
          : ext === 'webp' ? 'image/webp'
          : ext === 'bmp' ? 'image/bmp'
          : ext === 'svg' ? 'image/svg+xml'
          : 'image/jpeg';
        const dataUrl = `data:${mime};base64,${base64}`;
        if (imageCache.size >= 500) imageCache.delete(imageCache.keys().next().value);
        imageCache.set(cacheKey, dataUrl);
        setSrc(dataUrl);
      } catch (err) {
        if (!cancelled) console.error('Failed to load image:', err);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [image.path, image.previewSrc, image.name, image.mtime, wantThumb]);

  const handleClick = (e) => {
    if (e.detail === 2) onPreview(image, imageIndex);
    else onCardClick(image.path, imageIndex, e.shiftKey);
  };
  const handleMouseDown = (e) => onDragMouseDown && onDragMouseDown(image.path, imageIndex, isSelected, e.button);
  const handleMouseEnter = () => onDragMouseEnter && onDragMouseEnter(image.path, imageIndex);
  const handleContextMenu = (e) => { e.preventDefault(); if (onContextMenu) onContextMenu(e, image); };
  const handleLockClick = (e) => { e.stopPropagation(); if (onToggleLock) onToggleLock(image.path); };

  const sizeKB = image.size ? (image.size >= 1024 * 1024
    ? (image.size / 1024 / 1024).toFixed(1) + ' MB'
    : Math.round(image.size / 1024) + ' KB') : '';

  return (
    <div
      data-path={image.path}
      className={`image-row ${detail === 'plain' ? 'plain' : 'thumb'} ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''} ${isScanning ? 'scanning' : ''}`}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onContextMenu={handleContextMenu}
      title={image.name}
    >
      {wantThumb ? (
        <div className="image-row-thumb">
          {src && !imageError
            ? <img src={src} alt={image.name} loading="lazy" decoding="async" onError={() => setImageError(true)} />
            : <div className="image-row-thumb-placeholder" />
          }
          {driveState && driveState !== 'clean' && (
            <div className={`drive-state-dot drive-state-${driveState}`} title={`Drive: ${driveState}`} />
          )}
          {orderSelectMode && orderNumber != null && (
            <div className="image-row-order">{orderNumber}</div>
          )}
        </div>
      ) : (
        <div className="image-row-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="9" cy="9" r="1.5"/>
            <path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L4 21"/>
          </svg>
          {driveState && driveState !== 'clean' && (
            <div className={`drive-state-dot drive-state-${driveState}`} title={`Drive: ${driveState}`} />
          )}
        </div>
      )}

      <div className="image-row-main">
        <div className="image-row-name">{image.name}</div>
        {wantThumb && (
          <div className="image-row-meta">
            {image.width && image.height && <span>{image.width}×{image.height}</span>}
            {sizeKB && <span>{sizeKB}</span>}
            {aiScore != null && (
              <span className={`image-row-ai${aiHit ? ' hit' : ''}`}>
                {aiCharacter && <span className="image-row-ai-char">{aiCharacter}</span>}
                {Math.round(aiScore * 100)}%
              </span>
            )}
          </div>
        )}
      </div>

      <div className="image-row-actions">
        {isLocked && (
          <button className="image-row-lock" onClick={handleLockClick} title="Unlock">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </button>
        )}
        <span className={`image-row-check${isSelected ? ' checked' : ''}`}>
          {isSelected && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
        </span>
      </div>
    </div>
  );
}

export default memo(ImageRow);
