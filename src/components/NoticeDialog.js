import React, { useEffect, useRef } from 'react';
import './ConfirmDialog.css';

const InfoIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" x2="12" y1="8" y2="12"/>
    <line x1="12" x2="12.01" y1="16" y2="16"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
);

const ErrorIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
);

function NoticeDialog({ title, message, variant = 'info', okLabel = 'OK', onClose }) {
  const okButtonRef = useRef(null);

  useEffect(() => {
    if (okButtonRef.current) okButtonRef.current.focus();

    const handler = (e) => {
      if (e.repeat) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const iconClass = variant === 'error' ? 'danger' : variant === 'success' ? 'success' : 'info';
  const Icon = variant === 'error' ? ErrorIcon : variant === 'success' ? CheckIcon : InfoIcon;

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog-box notice-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className={`dialog-icon-wrap ${iconClass}`}>
          <Icon />
        </div>
        {title && <div className="dialog-title">{title}</div>}
        <div className="dialog-message">{message}</div>
        <div className="dialog-actions">
          <button
            ref={okButtonRef}
            className="dialog-btn confirm-primary notice-ok"
            onClick={onClose}
          >
            {okLabel}
          </button>
        </div>
        <div className="dialog-hint">Enter or Esc to close</div>
      </div>
    </div>
  );
}

export default NoticeDialog;
