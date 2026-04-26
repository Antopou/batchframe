import React, { useState, useEffect, useCallback, useRef } from 'react';
import './ImagePreviewModal.css';

function ImagePreviewModal({ image, images, currentIndex, onClose, onNext, onPrev, onLock, onDelete }) {
  const zoomRef = useRef(1);
  const positionRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0 });
  const imageRef = useRef(null);
  const rafRef = useRef(null);

  const [zoomDisplay, setZoomDisplay] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [imageSrc, setImageSrc] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const updateImageTransform = () => {
    if (imageRef.current) {
      const { x, y } = positionRef.current;
      const z = zoomRef.current;
      imageRef.current.style.transform = `scale(${z}) translate(${x / z}px, ${y / z}px)`;
    }
  };

  // Reset zoom and position when image changes
  useEffect(() => {
    zoomRef.current = 1;
    positionRef.current = { x: 0, y: 0 };
    setZoomDisplay(1);
    updateImageTransform();
  }, [image?.path]);

  // Load image data when image changes
  useEffect(() => {
    if (!image) return;

    const loadImage = async () => {
      setImageSrc('');
      setIsLoading(true);

      // Defer so the browser paints the shimmer before the heavy load blocks the thread
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const minLoadTime = new Promise(resolve => setTimeout(resolve, 250));

      if (image.previewSrc && image.previewSrc !== '') {
        setImageSrc(image.previewSrc);
        await minLoadTime;
        setIsLoading(false);
        return;
      }

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

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    zoomRef.current = Math.max(0.5, Math.min(3, zoomRef.current + delta));
    setZoomDisplay(zoomRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(updateImageTransform);
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (zoomRef.current > 1) {
      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX - positionRef.current.x,
        y: e.clientY - positionRef.current.y
      };
    }
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (isDragging) {
      positionRef.current = {
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      };
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateImageTransform);
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleKeydown = useCallback((e) => {
    switch(e.key) {
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
        zoomRef.current = Math.min(3, zoomRef.current + 0.1);
        setZoomDisplay(zoomRef.current);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(updateImageTransform);
        return;
      case '-':
        e.preventDefault();
        zoomRef.current = Math.max(0.5, zoomRef.current - 0.1);
        setZoomDisplay(zoomRef.current);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(updateImageTransform);
        return;
      case '0':
        e.preventDefault();
        zoomRef.current = 1;
        positionRef.current = { x: 0, y: 0 };
        setZoomDisplay(1);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(updateImageTransform);
        return;
    }
  }, [onClose, onNext, onPrev]);

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

  return (
    <div className="preview-modal-overlay" onClick={onClose}>
      <div className="preview-modal-content" onClick={e => e.stopPropagation()}>
        <div className="preview-header">
          <div className="preview-info">
            <span className="preview-filename">{image.name}</span>
            <span className="preview-index">{currentIndex + 1} / {images.length}</span>
          </div>
          <button className="preview-close" onClick={onClose}>×</button>
        </div>

        <div
          className="preview-image-container"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          style={{ cursor: zoomRef.current > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
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
              className="preview-image"
              style={{
                cursor: zoomRef.current > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
              }}
              draggable={false}
            />
          )}
        </div>

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
              onClick={() => {
                zoomRef.current = Math.max(0.5, zoomRef.current - 0.1);
                setZoomDisplay(zoomRef.current);
                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(updateImageTransform);
              }}
              disabled={zoomRef.current <= 0.5}
              title="Zoom out (-)"
            >
              −
            </button>
            <span className="zoom-level">{Math.round(zoomDisplay * 100)}%</span>
            <button
              onClick={() => {
                zoomRef.current = Math.min(3, zoomRef.current + 0.1);
                setZoomDisplay(zoomRef.current);
                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(updateImageTransform);
              }}
              disabled={zoomRef.current >= 3}
              title="Zoom in (+)"
            >
              +
            </button>
            <button
              onClick={() => {
                zoomRef.current = 1;
                positionRef.current = { x: 0, y: 0 };
                setZoomDisplay(1);
                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(updateImageTransform);
              }}
              title="Reset zoom (0)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
            </button>
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
      </div>
    </div>
  );
}

export default ImagePreviewModal;
