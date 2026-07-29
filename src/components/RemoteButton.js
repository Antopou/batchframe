import React, { useCallback, useEffect, useState } from 'react';

function MobileButton() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [clients, setClients] = useState(0);

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
    } finally {
      setBusy(false);
    }
  }, []);

  const handleCopy = useCallback(() => {
    if (info?.url) navigator.clipboard?.writeText(info.url).catch(() => {});
  }, [info]);

  return (
    <>
      <button
        className={`sync-button${info ? ' active' : ''}`}
        onClick={() => setOpen(true)}
        title={info ? `Mobile ${clients} client(s)` : 'Enable mobile companion'}
        type="button"
        style={{
          background: info ? 'rgba(46, 204, 113, 0.15)' : 'transparent',
          border: `1px solid ${info ? 'rgba(46, 204, 113, 0.6)' : 'rgba(255,255,255,0.15)'}`,
          color: 'inherit',
          padding: '6px 10px',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
          <line x1="12" y1="18" x2="12" y2="18" />
        </svg>
        <span>Mobile{info ? ` · ${clients}` : ''}</span>
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
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1e1e22', color: '#eee', borderRadius: 10, padding: 24,
              minWidth: 320, maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>Mobile companion</h3>
            <p style={{ fontSize: 13, color: '#aaa', marginTop: 0 }}>
              Phone on same Wi-Fi opens URL, mirrors this window's folder + preview.
            </p>

            {!info && (
              <button onClick={handleStart} disabled={busy}
                style={{ padding: '10px 16px', background: '#2ecc71', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', width: '100%' }}>
                {busy ? 'Starting…' : 'Start server'}
              </button>
            )}

            {info && (
              <>
                {info.qrDataUrl && (
                  <div style={{ textAlign: 'center', margin: '12px 0' }}>
                    <img src={info.qrDataUrl} alt="QR" style={{ width: 220, height: 220, borderRadius: 8, background: '#fff', padding: 8 }} />
                  </div>
                )}
                <div style={{ background: '#111', padding: '8px 10px', borderRadius: 6, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', marginBottom: 8 }}>
                  {info.url}
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button onClick={handleCopy} style={{ flex: 1, padding: '8px', background: '#333', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>Copy URL</button>
                  <button onClick={handleStop} disabled={busy} style={{ flex: 1, padding: '8px', background: '#c0392b', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>
                    {busy ? '…' : 'Stop'}
                  </button>
                </div>
                <div style={{ fontSize: 12, color: '#888', textAlign: 'center' }}>
                  {clients} connected client{clients === 1 ? '' : 's'}
                </div>
              </>
            )}

            <button onClick={() => setOpen(false)}
              style={{ marginTop: 12, width: '100%', padding: 8, background: 'transparent', border: '1px solid #444', borderRadius: 6, color: '#aaa', cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default MobileButton;
