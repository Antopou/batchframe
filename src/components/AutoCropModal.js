import React, { useState } from 'react';
import './AutoCropModal.css';
import { ASPECT_PRESETS } from '../utils/faceCrop';

const ASPECT_KEY = 'autoCropAspect';

function AutoCropModal({ count, running, progress, result, onRun, onClose }) {
  // Restore the last-used aspect (stored by key, since ratio may be null).
  const [aspectKey, setAspectKey] = useState(() => localStorage.getItem(ASPECT_KEY) || '1:1');

  const chosen = ASPECT_PRESETS.find(p => p.key === aspectKey) || ASPECT_PRESETS[1];

  const run = () => {
    localStorage.setItem(ASPECT_KEY, chosen.key);
    onRun(chosen.ratio);
  };

  const pct = progress && progress.total
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="autocrop-overlay" onClick={running ? undefined : onClose}>
      <div className="autocrop-modal" onClick={e => e.stopPropagation()}>
        <div className="autocrop-header">
          <span>Auto-crop to face · {count} image{count !== 1 ? 's' : ''}</span>
          {!running && <button className="autocrop-close" onClick={onClose}>×</button>}
        </div>

        {result ? (
          <div className="autocrop-body">
            <div className="autocrop-summary">
              <div className="autocrop-summary-line ok">✓ {result.cropped} cropped</div>
              {result.skipped > 0 && (
                <div className="autocrop-summary-line muted">— {result.skipped} skipped (no face)</div>
              )}
              {result.failed > 0 && (
                <div className="autocrop-summary-line bad">✕ {result.failed} failed</div>
              )}
              {result.error && <div className="autocrop-summary-line bad">{result.error}</div>}
            </div>
          </div>
        ) : running ? (
          <div className="autocrop-body">
            <div className="autocrop-status">{progress?.text || 'Working…'}</div>
            <div className="autocrop-progressbar">
              <div className="autocrop-progressbar-fill" style={{ width: `${pct}%` }} />
            </div>
            {progress?.total > 0 && (
              <div className="autocrop-progress-count">{progress.current} / {progress.total}</div>
            )}
          </div>
        ) : (
          <div className="autocrop-body">
            <div className="autocrop-label">Aspect ratio</div>
            <div className="autocrop-aspects">
              {ASPECT_PRESETS.map(p => (
                <button
                  key={p.key}
                  className={`autocrop-aspect-btn${p.key === chosen.key ? ' active' : ''}`}
                  onClick={() => setAspectKey(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="autocrop-note">
              Each image is cropped centered on its detected head and saved in place.
              Locked images are skipped.
            </div>
          </div>
        )}

        <div className="autocrop-footer">
          {result ? (
            <button className="btn-modern success sm" onClick={onClose}>Done</button>
          ) : (
            <>
              <button className="btn-modern ghost sm" onClick={onClose} disabled={running}>Cancel</button>
              <button className="btn-modern success sm" onClick={run} disabled={running}>
                {running ? 'Cropping…' : `Crop ${count} image${count !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AutoCropModal;
