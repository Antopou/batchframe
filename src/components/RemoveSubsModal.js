import React, { useState } from 'react';
import './RemoveBgModal.css';

const SAVE_MODE_KEY = 'removeSubsSaveMode';
const AREA_KEY = 'removeSubsArea';
const FILL_KEY = 'removeSubsFill';

function RemoveSubsModal({ count, running, progress, result, onRun, onClose }) {
  const [saveMode, setSaveMode] = useState(() => localStorage.getItem(SAVE_MODE_KEY) || 'copy');
  const [area, setArea] = useState(() => localStorage.getItem(AREA_KEY) || 'bottom');
  const [fill, setFill] = useState(() => localStorage.getItem(FILL_KEY) || 'reference');

  const run = () => {
    localStorage.setItem(SAVE_MODE_KEY, saveMode);
    localStorage.setItem(AREA_KEY, area);
    localStorage.setItem(FILL_KEY, fill);
    onRun(saveMode, area, fill);
  };

  const pct = progress && progress.total
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="removebg-overlay" onClick={running ? undefined : onClose}>
      <div className="removebg-modal" onClick={e => e.stopPropagation()}>
        <div className="removebg-header">
          <span>Remove subtitles · {count} image{count !== 1 ? 's' : ''}</span>
          {!running && <button className="removebg-close" onClick={onClose}>×</button>}
        </div>

        {result ? (
          <div className="removebg-body">
            <div className="removebg-summary">
              <div className="removebg-summary-line ok">✓ {result.written} cleaned</div>
              {result.written > 0 && (
                <div className="removebg-summary-line">
                  — {result.fromRef || 0} from a nearby frame · {result.written - (result.fromRef || 0)} by AI
                </div>
              )}
              {result.skipped > 0 && (
                <div className="removebg-summary-line">— {result.skipped} had no subtitles (left alone)</div>
              )}
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
            <div className="removebg-label">Search area</div>
            <div className="removebg-modes">
              <button
                className={`removebg-mode-btn${area === 'bottom' ? ' active' : ''}`}
                onClick={() => setArea('bottom')}
              >
                Bottom only
              </button>
              <button
                className={`removebg-mode-btn${area === 'all' ? ' active' : ''}`}
                onClick={() => setArea('all')}
              >
                Whole image
              </button>
            </div>
            <div className="removebg-note">
              {area === 'bottom'
                ? 'Only lettering in the lower part of the frame is painted out, so signs and titles elsewhere in the scene survive.'
                : 'Every line of text found is painted out — including signs and titles that are part of the scene.'}
            </div>

            <div className="removebg-label">Fill with</div>
            <div className="removebg-modes">
              <button
                className={`removebg-mode-btn${fill === 'reference' ? ' active' : ''}`}
                onClick={() => setFill('reference')}
              >
                Nearby frame
              </button>
              <button
                className={`removebg-mode-btn${fill === 'ai' ? ' active' : ''}`}
                onClick={() => setFill('ai')}
              >
                AI only
              </button>
            </div>
            <div className="removebg-note">
              {fill === 'reference'
                ? 'Looks at the frames either side for the same shot without lettering there, and patches in its real pixels — the donor only has to be similar, the seam is blended. Falls back to the AI fill when no neighbour matches.'
                : 'Always paints the area in with the AI model, ignoring neighbouring frames.'}
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
            <div className={`removebg-note${saveMode === 'overwrite' ? ' warn' : ''}`}>
              {saveMode === 'copy'
                ? 'Saved as name_nosub next to each original, in the same format.'
                : 'Each original is replaced by its cleaned version, in the same format.'}
              {' '}Images with no subtitles are left completely untouched. Locked images are skipped.
            </div>
          </div>
        )}

        <div className="removebg-footer">
          {result ? (
            <button className="btn-modern success sm" onClick={onClose}>Done</button>
          ) : (
            <>
              <button className="btn-modern ghost sm" onClick={onClose} disabled={running}>Cancel</button>
              <button className="btn-modern success sm" onClick={run} disabled={running}>
                {running ? 'Cleaning…' : `Clean ${count} image${count !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default RemoveSubsModal;
