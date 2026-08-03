import React, { useState } from 'react';
import './RemoveBgModal.css';

const SAVE_MODE_KEY = 'removeBgSaveMode';
const BACKGROUND_KEY = 'removeBgBackground';
const QUALITY_KEY = 'removeBgQuality';

function RemoveBgModal({ count, running, progress, result, onRun, onClose }) {
  // Restore the last-used save mode; copy is the safe default.
  const [saveMode, setSaveMode] = useState(() => localStorage.getItem(SAVE_MODE_KEY) || 'copy');
  const [background, setBackground] = useState(() => localStorage.getItem(BACKGROUND_KEY) || 'white');
  const [quality, setQuality] = useState(() => localStorage.getItem(QUALITY_KEY) || 'fast');

  const run = () => {
    localStorage.setItem(SAVE_MODE_KEY, saveMode);
    localStorage.setItem(BACKGROUND_KEY, background);
    localStorage.setItem(QUALITY_KEY, quality);
    onRun(saveMode, background, quality);
  };

  const pct = progress && progress.total
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="removebg-overlay" onClick={running ? undefined : onClose}>
      <div className="removebg-modal" onClick={e => e.stopPropagation()}>
        <div className="removebg-header">
          <span>Remove background · {count} image{count !== 1 ? 's' : ''}</span>
          {!running && <button className="removebg-close" onClick={onClose}>×</button>}
        </div>

        {result ? (
          <div className="removebg-body">
            <div className="removebg-summary">
              <div className="removebg-summary-line ok">✓ {result.written} cut out</div>
              {result.failed > 0 && (
                <div className="removebg-summary-line bad">✕ {result.failed} failed</div>
              )}
              {result.error && <div className="removebg-summary-line bad">{result.error}</div>}
            </div>
          </div>
        ) : running ? (
          <div className="removebg-body">
            <div className="removebg-status">{progress?.text || 'Working…'}</div>
            <div className="removebg-progressbar">
              <div className="removebg-progressbar-fill" style={{ width: `${pct}%` }} />
            </div>
            {progress?.total > 0 && (
              <div className="removebg-progress-count">{progress.current} / {progress.total}</div>
            )}
          </div>
        ) : (
          <div className="removebg-body">
            <div className="removebg-label">Background</div>
            <div className="removebg-modes">
              <button
                className={`removebg-mode-btn${background === 'white' ? ' active' : ''}`}
                onClick={() => setBackground('white')}
              >
                White
              </button>
              <button
                className={`removebg-mode-btn${background === 'transparent' ? ' active' : ''}`}
                onClick={() => setBackground('transparent')}
              >
                Transparent
              </button>
            </div>

            <div className="removebg-label">Quality</div>
            <div className="removebg-modes">
              <button
                className={`removebg-mode-btn${quality === 'fast' ? ' active' : ''}`}
                onClick={() => setQuality('fast')}
              >
                Fast
              </button>
              <button
                className={`removebg-mode-btn${quality === 'best' ? ' active' : ''}`}
                onClick={() => setQuality('best')}
              >
                Best
              </button>
            </div>
            <div className="removebg-note">
              {quality === 'fast'
                ? 'Anime segmenter, about a second per image. Occasionally leaves a piece of scenery attached to the character.'
                : 'Adds a second model that vetoes leftover scenery — noticeably cleaner, but about 20 seconds per image and a one-time 490 MB download.'}
            </div>

            <div className="removebg-label">Save mode</div>
            <div className="removebg-modes">
              <button
                className={`removebg-mode-btn${saveMode === 'copy' ? ' active' : ''}`}
                onClick={() => setSaveMode('copy')}
              >
                Save as copy
              </button>
              <button
                className={`removebg-mode-btn${saveMode === 'overwrite' ? ' active' : ''}`}
                onClick={() => setSaveMode('overwrite')}
              >
                Overwrite
              </button>
            </div>
            {saveMode === 'copy' ? (
              <div className="removebg-note">
                Saved as <code>name_cutout</code> next to each original, keeping its
                format{background === 'transparent'
                  ? ' where that format can hold transparency — a .jpg cut-out becomes .png.'
                  : ' — a .jpg stays a .jpg.'} Locked images are skipped.
              </div>
            ) : (
              <div className="removebg-note warn">
                Each original is replaced by its cut-out, keeping its format.
                {background === 'transparent'
                  ? ' A .jpg cannot hold transparency, so it is replaced by a .png and the .jpg is deleted.'
                  : ''} Locked images are skipped.
              </div>
            )}
          </div>
        )}

        <div className="removebg-footer">
          {result ? (
            <button className="btn-modern success sm" onClick={onClose}>Done</button>
          ) : (
            <>
              <button className="btn-modern ghost sm" onClick={onClose} disabled={running}>Cancel</button>
              <button className="btn-modern success sm" onClick={run} disabled={running}>
                {running ? 'Removing…' : `Remove from ${count} image${count !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default RemoveBgModal;
