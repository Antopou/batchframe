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
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div className="dialog-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className={`dialog-icon-wrap ${danger ? 'danger' : 'info'}`}>
          {danger ? <TrashIcon /> : <InfoIcon />}
        </div>
        {title && <div className="dialog-title">{title}</div>}
        <div className="dialog-message">{message}</div>
        <div className="dialog-actions">
          <button className="dialog-btn cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            className={`dialog-btn ${danger ? 'confirm-danger' : 'confirm-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
        <div className="dialog-hint">Enter to confirm · Esc to cancel</div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
