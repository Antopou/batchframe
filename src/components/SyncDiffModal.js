import React from 'react';
import './SyncDiffModal.css';

// GitHub-style modal that displays files pending a push to Drive.
export default function SyncDiffModal({ manifest, onConfirm, onCancel }) {
  const news = [];
  const modifieds = [];
  const deleteds = [];
  const renameds = [];

  for (const [relPath, entry] of Object.entries(manifest?.files || {})) {
    if (entry.state === 'new') news.push(relPath);
    else if (entry.state === 'modified') modifieds.push(relPath);
    else if (entry.state === 'deleted') deleteds.push(relPath);
    else if (entry.state === 'renamed') renameds.push({ from: entry.renamedFrom, to: relPath });
  }

  const total = news.length + modifieds.length + deleteds.length + renameds.length;

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="sync-diff-modal dialog-box" onClick={e => e.stopPropagation()}>
        <div className="sync-diff-header">
          <div className="dialog-title">Review Changes</div>
          <div className="sync-diff-subtitle">{total} pending change{total !== 1 ? 's' : ''}</div>
        </div>

        <div className="sync-diff-body">
          {total === 0 ? (
            <div className="sync-diff-empty">No changes to push.</div>
          ) : (
            <ul className="sync-diff-list">
              {news.map(path => (
                <li key={path} className="diff-item diff-new">
                  <span className="diff-icon">+</span>
                  <span className="diff-path">{path}</span>
                </li>
              ))}
              {modifieds.map(path => (
                <li key={path} className="diff-item diff-modified">
                  <span className="diff-icon">~</span>
                  <span className="diff-path">{path}</span>
                </li>
              ))}
              {renameds.map(r => (
                <li key={r.to} className="diff-item diff-renamed">
                  <span className="diff-icon">R</span>
                  <span className="diff-path">{r.from} <span className="diff-arrow">→</span> {r.to}</span>
                </li>
              ))}
              {deleteds.map(path => (
                <li key={path} className="diff-item diff-deleted">
                  <span className="diff-icon">-</span>
                  <span className="diff-path">{path}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="dialog-actions sync-diff-actions">
          <button className="dialog-btn cancel" onClick={onCancel}>Cancel</button>
          <button className="dialog-btn confirm-primary" disabled={total === 0} onClick={onConfirm}>
            Confirm Push
          </button>
        </div>
      </div>
    </div>
  );
}
