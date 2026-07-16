import React, { useEffect, useRef } from 'react';
import './ConfirmDialog.css';

// Danger icon (trash)
const TrashIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18"/>
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
    <line x1="10" x2="10" y1="11" y2="17"/>
    <line x1="14" x2="14" y1="11" y2="17"/>
  </svg>
);

// Info icon
const InfoIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" x2="12" y1="8" y2="12"/>
    <line x1="12" x2="12.01" y1="16" y2="16"/>
  </svg>
);

function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger = true, onConfirm, onCancel }) {
  const confirmButtonRef = useRef(null);

  useEffect(() => {
    // Focus confirm button immediately for keyboard accessibility
    if (confirmButtonRef.current) {
      confirmButtonRef.current.focus();
    }

    const handler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onConfirm, onCancel]);

  return (
    <div className="drive-picker-overlay" onMouseDown={onCancel}>
      <div className="drive-picker" onMouseDown={(e) => e.stopPropagation()}>
        <div className="terminal-omnibar">
          <div className="terminal-prompt">
            <span className="terminal-root">~</span>
            <span className="terminal-sep">/</span>
            <span className="terminal-dir">{danger ? 'Danger' : 'Confirm'}</span>
            <span className="terminal-arrow">❯</span>
          </div>
        </div>
        
        <div className="drive-picker-body">
          <div style={{ padding: '24px 20px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div className={`dialog-icon-wrap ${danger ? 'danger' : 'info'}`} style={{ flexShrink: 0, marginTop: '2px' }}>
              {danger ? <TrashIcon /> : <InfoIcon />}
            </div>
            <div>
              {title && <div style={{ fontSize: '15px', fontWeight: '600', color: '#e6e6e8', marginBottom: '8px' }}>{title}</div>}
              <div style={{ fontSize: '13px', color: '#9a9aa2', lineHeight: '1.5' }}>{message}</div>
            </div>
          </div>
        </div>

        <div className="drive-picker-footer">
          <div className="drive-picker-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button className="btn-terminal action-cancel" onClick={onCancel}>
              [ cancel ]
            </button>
            <button
              ref={confirmButtonRef}
              className="btn-terminal action-push"
              style={danger ? { color: 'var(--red)' } : {}}
              onClick={onConfirm}
            >
              [ {confirmLabel.toLowerCase()} ]
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
