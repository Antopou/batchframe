import React, { useState, useEffect, useCallback, useRef } from 'react';
import './ImagePreviewModal.css';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;

// Crop aspect presets. ratio = width / height in pixels; null = free-form.
const ASPECT_PRESETS = [
  { key: 'free', label: 'Free', ratio: null },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
  { key: '3:2', label: '3:2', ratio: 3 / 2 },
  { key: '2:3', label: '2:3', ratio: 2 / 3 },
];

const clampZoom = (z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function ImagePreviewModal({ image, images, currentIndex, onClose, onNext, onPrev, onLock, onDelete, onSaveCrop, canCrop }) {
  const zoomRef = useRef(1);
  const positionRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0 });
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const rectRef = useRef(null); // cached container rect (avoids per-event reflow)
  const pendingZoomRef = useRef(1); // latest zoom awaiting a state flush

  const [zoomDisplay, setZoomDisplay] = useState(1);
  const [smoothZoom, setSmoothZoom] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [imageSrc, setImageSrc] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // ── Crop state ────────────────────────────────────────────────
  const [cropMode, setCropMode] = useState(false);
  const [cropAspect, setCropAspect] = useState(null); // ratio number or null
  // Crop rect as fractions (0..1) of the natural image
  const [cropRect, setCropRect] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [saving, setSaving] = useState(false);
  const cropDragRef = useRef(null); // { handle, startPx, startRect, layout }

  const applyTransform = () => {
    if (!imageRef.current) return;
    const { x, y } = positionRef.current;
    const z = zoomRef.current;
    imageRef.current.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  };

  // One rAF per frame: write the transform and flush the % label state once,
  // so a burst of wheel events doesn't trigger a render + reflow each tick.
  const scheduleFrame = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      applyTransform();
      setZoomDisplay(pendingZoomRef.current);
    });
  }, []);

  const setZoom = useCallback((nextZoom, anchor, smooth = false) => {
    const z0 = zoomRef.current;
    const z1 = clampZoom(nextZoom);
    if (z1 === z0) return;

    // Anchor the point under the cursor (or center) while scaling.
    // Uses the cached rect — never reads layout on the hot path.
    const rect = rectRef.current;
    if (anchor && rect) {
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const dx = anchor.x - cx - positionRef.current.x;
      const dy = anchor.y - cy - positionRef.current.y;
      positionRef.current = {
        x: positionRef.current.x + dx * (1 - z1 / z0),
        y: positionRef.current.y + dy * (1 - z1 / z0),
      };
    }
    if (z1 <= 1) positionRef.current = { x: 0, y: 0 };

    zoomRef.current = z1;
    pendingZoomRef.current = z1;
    setSmoothZoom(smooth); // no-op re-render when value is unchanged
    scheduleFrame();
  }, [scheduleFrame]);

  const resetZoom = useCallback(() => {
    zoomRef.current = 1;
    pendingZoomRef.current = 1;
    positionRef.current = { x: 0, y: 0 };
    setSmoothZoom(true);
    scheduleFrame();
  }, [scheduleFrame]);

  // Reset zoom/crop when image changes
  useEffect(() => {
    zoomRef.current = 1;
    positionRef.current = { x: 0, y: 0 };
    setZoomDisplay(1);
    setSmoothZoom(false);
    setCropMode(false);
    applyTransform();
  }, [image?.path]);

  // Load image data when image changes
  useEffect(() => {
    if (!image) return;

    // Pixels already in memory (e.g. a just-made crop): show instantly, no shimmer
    if (image.previewSrc && image.previewSrc !== '') {
      setImageSrc(image.previewSrc);
      setIsLoading(false);
      return;
    }

    const loadImage = async () => {
      setImageSrc('');
      setIsLoading(true);

      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const minLoadTime = new Promise(resolve => setTimeout(resolve, 250));

      if (!window.electronAPI || !image.path) {
        await minLoadTime;
        setIsLoading(false);
        return;
      }

      try {
        const base64 = await window.electronAPI.getImageData(image.path);
        if (!base64) {
          await minLoadTime;
          setIsLoading(false);
          return;
        }

        const ext = (image.name || '').toLowerCase().split('.').pop();
        const mime = ext === 'png' ? 'image/png'
          : ext === 'gif' ? 'image/gif'
          : ext === 'webp' ? 'image/webp'
          : ext === 'bmp' ? 'image/bmp'
          : ext === 'svg' ? 'image/svg+xml'
          : 'image/jpeg';

        setImageSrc(`data:${mime};base64,${base64}`);
        await minLoadTime;
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to load preview image:', err);
        await minLoadTime;
        setIsLoading(false);
      }
    };

    loadImage();
  }, [image]);

  // Keep the container rect cached so the wheel path never forces a reflow
  useEffect(() => {
    const refresh = () => { rectRef.current = containerRef.current?.getBoundingClientRect() || null; };
    refresh();
    window.addEventListener('resize', refresh);
    return () => window.removeEventListener('resize', refresh);
  }, [image?.path, isLoading]);

  // ── Zoom via wheel (cursor-anchored, multiplicative for smoothness) ──
  const handleWheel = useCallback((e) => {
    if (cropMode) return;
    e.preventDefault();
    const rect = rectRef.current;
    const anchor = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null;
    const factor = Math.exp(-e.deltaY * 0.0022);
    setZoom(zoomRef.current * factor, anchor, false);
  }, [cropMode, setZoom]);

  // ── Pan (only when zoomed in and not cropping) ──
  const handleMouseDown = useCallback((e) => {
    if (cropMode) return;
    if (zoomRef.current > 1) {
      setIsDragging(true);
      setSmoothZoom(false);
      dragStartRef.current = {
        x: e.clientX - positionRef.current.x,
        y: e.clientY - positionRef.current.y,
      };
    }
  }, [cropMode]);

  const handleMouseMove = useCallback((e) => {
    if (isDragging) {
      positionRef.current = {
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      };
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          applyTransform();
        });
      }
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  // ── Crop geometry helpers ────────────────────────────────────
  // The rendered image box (object-fit: contain) within the container
  const getImageLayout = useCallback(() => {
    const container = containerRef.current;
    const img = imageRef.current;
    if (!container || !img || !img.naturalWidth) return null;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const natAspect = img.naturalWidth / img.naturalHeight;
    const contAspect = cw / ch;
    let width, height;
    if (natAspect > contAspect) {
      width = cw;
      height = cw / natAspect;
    } else {
      height = ch;
      width = ch * natAspect;
    }
    return { left: (cw - width) / 2, top: (ch - height) / 2, width, height, cw, ch };
  }, []);

  // Build a crop rect (fractions) of the largest area matching `ratio`, centered
  const fitCropToAspect = useCallback((ratio) => {
    const img = imageRef.current;
    // Free crop starts covering the whole image
    if (!ratio || !img || !img.naturalWidth) return { x: 0, y: 0, w: 1, h: 1 };
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    // fracW/fracH = ratio * natH / natW  (so pixel ratio equals `ratio`)
    let fracW = 1;
    let fracH = (natW / ratio) / natH;
    if (fracH > 1) {
      fracH = 1;
      fracW = (ratio * natH) / natW;
    }
    // Largest rect of this aspect that fits, centered
    return { x: (1 - fracW) / 2, y: (1 - fracH) / 2, w: fracW, h: fracH };
  }, []);

  const enterCrop = useCallback(() => {
    resetZoom();
    setCropMode(true);
    setCropAspect(null);
    setCropRect(fitCropToAspect(null));
  }, [resetZoom, fitCropToAspect]);

  const exitCrop = useCallback(() => setCropMode(false), []);

  const chooseAspect = useCallback((ratio) => {
    setCropAspect(ratio);
    setCropRect(fitCropToAspect(ratio));
  }, [fitCropToAspect]);

  // Pointer-driven move/resize of the crop rectangle
  const onCropPointerDown = useCallback((e, handle) => {
    e.preventDefault();
    e.stopPropagation();
    const layout = getImageLayout();
    if (!layout) return;
    cropDragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startRect: { ...cropRect },
      layout,
    };
  }, [cropRect, getImageLayout]);

  useEffect(() => {
    if (!cropMode) return;

    const onMove = (e) => {
      const drag = cropDragRef.current;
      if (!drag) return;
      const { handle, startX, startY, startRect, layout } = drag;
      const img = imageRef.current;
      const natW = img?.naturalWidth || 1;
      const natH = img?.naturalHeight || 1;
      // pointer delta in fraction-of-image space
      const dxF = (e.clientX - startX) / layout.width;
      const dyF = (e.clientY - startY) / layout.height;

      let { x, y, w, h } = startRect;

      if (handle === 'move') {
        x = clamp01(startRect.x + dxF);
        y = clamp01(startRect.y + dyF);
        if (x + w > 1) x = 1 - w;
        if (y + h > 1) y = 1 - h;
        setCropRect({ x, y, w, h });
        return;
      }

      // Corner resize. The opposite corner stays anchored.
      const right = startRect.x + startRect.w;
      const bottom = startRect.y + startRect.h;
      const signX = handle.includes('e') ? 1 : -1; // which way width grows
      const signY = handle.includes('s') ? 1 : -1; // which way height grows
      const ax = signX > 0 ? startRect.x : right;  // fixed x edge
      const ay = signY > 0 ? startRect.y : bottom;  // fixed y edge
      // dragged corner's target position (clamped into the image)
      const movingX = clamp01((handle.includes('e') ? right : startRect.x) + dxF);
      const movingY = clamp01((handle.includes('s') ? bottom : startRect.y) + dyF);

      if (cropAspect) {
        // fracW = a * fracH keeps the pixel ratio == cropAspect
        const a = (cropAspect * natH) / natW;
        const roomX = signX > 0 ? 1 - ax : ax;   // free space on the growing side
        const roomY = signY > 0 ? 1 - ay : ay;
        // Width driven by pointer, but capped so BOTH axes stay in bounds
        let W = Math.abs(movingX - ax);
        W = Math.min(W, roomX, a * roomY);
        W = Math.max(W, 0.02);
        const H = W / a;
        x = signX > 0 ? ax : ax - W;
        y = signY > 0 ? ay : ay - H;
        w = W;
        h = H;
      } else {
        x = Math.min(ax, movingX);
        y = Math.min(ay, movingY);
        w = Math.max(0.02, Math.abs(movingX - ax));
        h = Math.max(0.02, Math.abs(movingY - ay));
      }
      setCropRect({ x, y, w, h });
    };

    const onUp = () => { cropDragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [cropMode, cropAspect]);

  const applyCrop = useCallback(async () => {
    const img = imageRef.current;
    if (!img || !img.naturalWidth || !onSaveCrop || !image) return;
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const sx = Math.round(cropRect.x * natW);
    const sy = Math.round(cropRect.y * natH);
    const sw = Math.max(1, Math.round(cropRect.w * natW));
    const sh = Math.max(1, Math.round(cropRect.h * natH));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    const ext = (image.name || '').toLowerCase().split('.').pop();
    const isJpg = ext === 'jpg' || ext === 'jpeg';
    const dataUrl = isJpg
      ? canvas.toDataURL('image/jpeg', 0.95)
      : canvas.toDataURL('image/png');

    setSaving(true);
    try {
      const result = await onSaveCrop(image.path, dataUrl);
      if (result?.success) {
        // Exit crop mode; the parent swaps the preview to the new cropped file
        setCropMode(false);
      } else {
        // eslint-disable-next-line no-alert
        alert(`Could not save crop: ${result?.error || 'unknown error'}`);
      }
    } catch (err) {
      console.error('Crop save failed:', err);
      // eslint-disable-next-line no-alert
      alert(`Could not save crop: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [cropRect, onSaveCrop, image, onClose]);

  // ── Keyboard ─────────────────────────────────────────────────
  const handleKeydown = useCallback((e) => {
    if (cropMode) {
      if (e.key === 'Escape') { e.preventDefault(); setCropMode(false); }
      else if (e.key === 'Enter') { e.preventDefault(); applyCrop(); }
      return;
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      case 'ArrowLeft':
        e.preventDefault();
        onPrev();
        return;
      case 'ArrowRight':
        e.preventDefault();
        onNext();
        return;
      case '=':
      case '+':
        e.preventDefault();
        setZoom(zoomRef.current * 1.25, null, true);
        return;
      case '-':
        e.preventDefault();
        setZoom(zoomRef.current / 1.25, null, true);
        return;
      case '0':
        e.preventDefault();
        resetZoom();
        return;
      default:
        return;
    }
  }, [cropMode, applyCrop, onClose, onNext, onPrev, setZoom, resetZoom]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [handleKeydown]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  if (!image) return null;

  // Crop overlay geometry (in container px), derived on each render
  const layout = cropMode ? getImageLayout() : null;
  const cropBox = layout ? {
    left: layout.left + cropRect.x * layout.width,
    top: layout.top + cropRect.y * layout.height,
    width: cropRect.w * layout.width,
    height: cropRect.h * layout.height,
  } : null;

  return (
    <div className="preview-modal-overlay" onClick={cropMode ? undefined : onClose}>
      <div className="preview-modal-content" onClick={e => e.stopPropagation()}>
        <div className="preview-header">
          <div className="preview-info">
            <span className="preview-filename">{image.name}</span>
            <span className="preview-index">{currentIndex + 1} / {images.length}</span>
          </div>
          <button className="preview-close" onClick={onClose}>×</button>
        </div>

        <div
          ref={containerRef}
          className={`preview-image-container${cropMode ? ' cropping' : ''}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          style={{ cursor: cropMode ? 'default' : (zoomRef.current > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default') }}
        >
          {isLoading ? (
            <div className="preview-loading">
              <div className="preview-spinner" />
            </div>
          ) : (
            <img
              ref={imageRef}
              src={imageSrc}
              alt={image.name}
              className={`preview-image${smoothZoom && !isDragging ? ' smooth' : ''}`}
              draggable={false}
            />
          )}

          {cropMode && cropBox && (
            <div className="crop-layer">
              <div
                className="crop-box"
                style={{ left: cropBox.left, top: cropBox.top, width: cropBox.width, height: cropBox.height }}
                onMouseDown={(e) => onCropPointerDown(e, 'move')}
              >
                <div className="crop-third crop-third-v1" />
                <div className="crop-third crop-third-v2" />
                <div className="crop-third crop-third-h1" />
                <div className="crop-third crop-third-h2" />
                {['nw', 'ne', 'sw', 'se'].map(h => (
                  <div
                    key={h}
                    className={`crop-handle crop-handle-${h}`}
                    onMouseDown={(e) => onCropPointerDown(e, h)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {cropMode ? (
          <div className="preview-controls crop-controls">
            <div className="crop-aspects">
              {ASPECT_PRESETS.map(p => (
                <button
                  key={p.key}
                  className={`crop-aspect-btn${cropAspect === p.ratio ? ' active' : ''}`}
                  onClick={() => chooseAspect(p.ratio)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="crop-actions">
              <button className="crop-cancel-btn" onClick={exitCrop} disabled={saving}>Cancel</button>
              <button className="crop-apply-btn" onClick={applyCrop} disabled={saving}>
                {saving ? 'Saving…' : 'Apply Crop'}
              </button>
            </div>
          </div>
        ) : (
          <div className="preview-controls">
            <button
              className="preview-nav-btn"
              onClick={onPrev}
              disabled={currentIndex === 0}
              title="Previous image (←)"
            >
              ‹
            </button>

            <div className="preview-zoom-controls">
              <button
                onClick={() => setZoom(zoomRef.current / 1.25, null, true)}
                disabled={zoomDisplay <= MIN_ZOOM}
                title="Zoom out (-)"
              >
                −
              </button>
              <span className="zoom-level">{Math.round(zoomDisplay * 100)}%</span>
              <button
                onClick={() => setZoom(zoomRef.current * 1.25, null, true)}
                disabled={zoomDisplay >= MAX_ZOOM}
                title="Zoom in (+)"
              >
                +
              </button>
              <button onClick={resetZoom} title="Reset zoom (0)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
              {canCrop && (
                <button className="preview-crop-btn" onClick={enterCrop} title="Crop image">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
                    <path d="M18 22V8a2 2 0 0 0-2-2H2" />
                  </svg>
                  Crop
                </button>
              )}
            </div>

            <button
              className="preview-nav-btn"
              onClick={onNext}
              disabled={currentIndex === images.length - 1}
              title="Next image (→)"
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ImagePreviewModal;
