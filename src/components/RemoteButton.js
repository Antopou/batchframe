import React, { useCallback, useEffect, useState, useRef } from 'react';

function RemoteButton() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [clients, setClients] = useState(0);
  const modalRef = useRef(null);

  useEffect(() => {
    if (open && modalRef.current) {
      // Focus the modal container so Tab presses start from inside the modal
      modalRef.current.focus();
    }
  }, [open, info]);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.lan) return;
    try {
      const s = await window.electronAPI.lan.status();
      if (s?.running) {
        setInfo((prev) => ({ ...(prev || {}), url: s.url, ip: s.ip, port: s.port }));
        setClients(s.clients || 0);
      } else {
        setInfo(null);
        setClients(0);
      }
    } catch { /* main not reloaded yet */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const handleStart = useCallback(async () => {
    if (!window.electronAPI?.lan) return;
    setBusy(true);
    try {
      const r = await window.electronAPI.lan.start();
      if (r?.success) setInfo({ url: r.url, ip: r.ip, port: r.port, qrDataUrl: r.qrDataUrl });
      else alert('Failed: ' + (r?.error || 'unknown'));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleStop = useCallback(async () => {
    if (!window.electronAPI?.lan) return;
    setBusy(true);
    try {
      await window.electronAPI.lan.stop();
      setInfo(null);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleCopy = useCallback(() => {
    if (info?.url) navigator.clipboard?.writeText(info.url).catch(() => {});
  }, [info]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Tab') {
        e.stopPropagation();
        if (!modalRef.current) return;
        
        const focusable = modalRef.current.querySelectorAll('button:not([disabled])');
        if (focusable.length === 0) return;
        
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        
        if (e.shiftKey) {
          // If shift-tabbing from first element (or modal container), jump to last
          if (document.activeElement === first || document.activeElement === modalRef.current) {
            e.preventDefault();
            last.focus();
          }
        } else {
          // If tabbing from last element, jump to first
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      } else if (e.key === 'Enter') {
        // If the server is not running, Enter starts it.
        // If it IS running, we do nothing and let the browser's default behavior 
        // trigger the click on the focused button.
        if (!info && !busy) {
          e.preventDefault();
          e.stopPropagation();
          handleStart();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, info, busy, handleStart]);

  return (
    <>
      <button
        className={`drive-btn${info ? ' connected' : ''}`}
        onClick={() => setOpen(true)}
        title={info ? `Remote access (B) · ${clients} device${clients === 1 ? '' : 's'} connected` : 'Enable remote access (B)'}
        type="button"
        style={info ? { width: 'auto', padding: '0 10px', gap: 6 } : undefined}
      >
        <span className="drive-btn-icon" style={info ? { color: '#2ecc71' } : {}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
        </span>
        {info ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: '#2ecc71', whiteSpace: 'nowrap' }}>
            {clients} connected
          </span>
        ) : null}
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          }}
        >
          <div
            ref={modalRef}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1e1e22', color: '#eee', borderRadius: 10, padding: 24,
              minWidth: 320, maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
              outline: 'none'
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>Remote access</h3>
            <p style={{ fontSize: 13, color: '#aaa', marginTop: 0, marginBottom: 20 }}>
              Any device on the same Wi-Fi opens this URL and mirrors this window's folder + preview.
            </p>

            {!info && (
              <button className="remote-action-btn" onClick={handleStart} disabled={busy}
                style={{ padding: '10px 16px', background: '#2ecc71', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', width: '100%' }}>
                {busy ? 'Starting…' : 'Start server'}
              </button>
            )}

            {info && (
              <>
                {info.qrDataUrl && (
                  <div style={{ textAlign: 'center', margin: '12px 0' }}>
                    <img src={info.qrDataUrl} alt="Connection QR code" style={{ width: 220, height: 220, borderRadius: 8, background: '#fff', padding: 8 }} />
                  </div>
                )}
                <div style={{ background: '#111', padding: '8px 10px', borderRadius: 6, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', marginBottom: 8 }}>
                  {info.url}
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button className="remote-action-btn" onClick={handleCopy} style={{ flex: 1, padding: '8px', background: '#333', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>Copy URL</button>
                  <button className="remote-action-btn" onClick={handleStop} disabled={busy} style={{ flex: 1, padding: '8px', background: '#c0392b', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>
                    {busy ? '…' : 'Stop'}
                  </button>
                </div>
                <div style={{ fontSize: 12, color: '#888', textAlign: 'center' }}>
                  {clients} connected device{clients === 1 ? '' : 's'}
                </div>
              </>
            )}

            <button className="remote-action-btn" onClick={() => setOpen(false)}
              style={{ marginTop: 12, width: '100%', padding: 8, background: 'transparent', border: '1px solid #444', borderRadius: 6, color: '#aaa', cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default RemoteButton;
