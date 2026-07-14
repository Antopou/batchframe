import React, { useCallback, useEffect, useRef, useState } from 'react';
import DriveIcon from './DriveIcon';
import DriveFolderPicker from './DriveFolderPicker';
import ContextMenu from './ContextMenu';
import ConfirmDialog from './ConfirmDialog';
import './DriveButton.css';

const LONG_PRESS_MS = 500;

// Minimal, icon-driven Drive control.
// Left click: sign-in (if not signed in) or open folder picker (if signed in).
// Right click / long-press: context menu (Push / Clear cache / Sign out).
// State overlays: green dot (connected), amber count pill (dirty), spinner ring (busy).
// Transient progress pill anchored under the button during pull/push.
function DriveButton({ cacheRoot, manifest, summary, onDatasetOpened }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [progress, setProgress] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [menu, setMenu] = useState(null); // { x, y }
  const [conflictDialog, setConflictDialog] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState(null);

  const btnRef = useRef(null);
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

  const refreshStatus = useCallback(async () => {
    if (!window.electronAPI?.drive) return;
    setStatus(await window.electronAPI.drive.status());
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    if (!window.electronAPI?.drive) return;
    window.electronAPI.drive.onProgress((p) => setProgress(p));
    return () => window.electronAPI.drive.removeProgressListeners();
  }, []);

  useEffect(() => {
    if (progress?.phase === 'done') {
      const t = setTimeout(() => setProgress(null), 1500);
      return () => clearTimeout(t);
    }
  }, [progress]);

  // Auto-clear transient error messages.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  // ── Handlers ───────────────────────────────────────────────
  const doSignIn = useCallback(async () => {
    setSigningIn(true);
    setError(null);
    try {
      const r = await window.electronAPI.drive.signIn();
      if (!r.success) throw new Error(r.error || 'Sign-in failed');
      await refreshStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setSigningIn(false);
    }
  }, [refreshStatus]);

  const doSignOut = useCallback(async () => {
    setError(null);
    await window.electronAPI.drive.signOut();
    await refreshStatus();
  }, [refreshStatus]);

  const doPush = useCallback(async ({ force = false } = {}) => {
    if (!cacheRoot) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.electronAPI.drive.push({ cacheRoot, force });
      if (!r.success) {
        if (r.conflicts) setConflictDialog({ conflicts: r.conflicts });
        else setError(r.error || 'Push failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [cacheRoot]);

  const doPullFirst = useCallback(async () => {
    if (!manifest) return;
    setConflictDialog(null);
    setBusy(true);
    setError(null);
    setProgress({ phase: 'listing' });
    try {
      const r = await window.electronAPI.drive.pull({
        driveFolderId: manifest.driveFolderId,
        datasetName: manifest.datasetName,
      });
      if (!r.success) throw new Error(r.error || 'Pull failed');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [manifest]);

  const doClear = useCallback(async () => {
    if (!cacheRoot) return;
    setConfirmClear(false);
    setBusy(true);
    setError(null);
    try {
      const r = await window.electronAPI.drive.clearCache({ cacheRoot, keepManifest: true });
      if (!r.ok) {
        setError(r.error === 'unsynced-changes' ? 'Push first — unsynced edits exist.' : (r.error || 'Clear failed'));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [cacheRoot]);

  const openMenuAtRect = useCallback((rect) => {
    setMenu({ x: rect.left, y: rect.bottom + 6 });
  }, []);

  // ── Click handlers ─────────────────────────────────────────
  const handleClick = useCallback((e) => {
    if (longPressFired.current) {
      longPressFired.current = false;
      e.preventDefault();
      return;
    }
    if (!status) return;
    if (!status.configured) return; // tooltip covers this
    if (!status.signedIn) { doSignIn(); return; }
    setShowPicker(true);
  }, [status, doSignIn]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) openMenuAtRect(rect);
  }, [openMenuAtRect]);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    longPressFired.current = false;
    const rect = e.currentTarget.getBoundingClientRect();
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      openMenuAtRect(rect);
    }, LONG_PRESS_MS);
  }, [openMenuAtRect]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePicked = useCallback(async ({ id, name }) => {
    setShowPicker(false);
    setBusy(true);
    setError(null);
    setProgress({ phase: 'listing' });
    try {
      const r = await window.electronAPI.drive.pull({ driveFolderId: id, datasetName: name });
      if (!r.success) throw new Error(r.error || 'Pull failed');
      onDatasetOpened?.(r.cacheRoot);
    } catch (e) {
      setError(e.message);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }, [onDatasetOpened]);

  // ── Derived UI state ───────────────────────────────────────
  if (!window.electronAPI?.drive) return null;

  const dirty = summary?.dirty || 0;
  const stateClass = [
    'drive-btn',
    !status?.configured && 'unconfigured',
    status?.signedIn && 'connected',
    dirty > 0 && 'has-changes',
    (busy || signingIn || progress) && 'busy',
    menu && 'menu-open',
  ].filter(Boolean).join(' ');

  const tooltip = !status
    ? 'Google Drive'
    : !status.configured
      ? 'Set CLIENT_ID in src/drive/config.js'
      : !status.signedIn
        ? 'Sign in to Google Drive'
        : cacheRoot
          ? `Drive · ${manifest?.datasetName || ''}${dirty ? ` · ${dirty} unsynced` : ''}`
          : 'Open dataset from Drive';

  const menuItems = [];
  if (status?.signedIn) {
    if (cacheRoot && manifest?.datasetName) {
      menuItems.push({ label: `Dataset: ${manifest.datasetName}`, disabled: true });
      menuItems.push({ separator: true });
    }
    menuItems.push({
      label: `Push to Drive${dirty ? ` (${dirty})` : ''}`,
      disabled: !cacheRoot || dirty === 0 || busy,
      onClick: () => doPush(),
    });
    menuItems.push({
      label: 'Clear local cache',
      disabled: !cacheRoot || busy,
      onClick: () => setConfirmClear(true),
    });
    menuItems.push({
      label: 'Change dataset…',
      disabled: busy,
      onClick: () => setShowPicker(true),
    });
    menuItems.push({ separator: true });
    menuItems.push({ label: 'Sign out', onClick: doSignOut });
  }

  return (
    <>
      <button
        ref={btnRef}
        className={stateClass}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        onMouseUp={cancelLongPress}
        onMouseLeave={cancelLongPress}
        title={tooltip}
      >
        <span className="drive-btn-icon"><DriveIcon size={14} /></span>
        {dirty > 0 && status?.signedIn && (
          <span className="drive-btn-badge">{dirty > 99 ? '99+' : dirty}</span>
        )}
      </button>

      {progress && <ProgressPill progress={progress} />}

      {error && <ErrorPill message={error} onDismiss={() => setError(null)} />}

      {showPicker && (
        <DriveFolderPicker
          onSelect={handlePicked}
          onClose={() => setShowPicker(false)}
        />
      )}

      {menu && (
        <ContextMenu
          items={menuItems}
          position={menu}
          onClose={() => setMenu(null)}
        />
      )}

      {conflictDialog && (
        <div className="dialog-backdrop" onClick={() => setConflictDialog(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="dialog-title">Drive has newer changes</div>
            <div className="dialog-message">
              {conflictDialog.conflicts.length} file{conflictDialog.conflicts.length === 1 ? '' : 's'} changed on Drive since your last pull:
              <ul className="drive-conflict-list">
                {conflictDialog.conflicts.slice(0, 8).map((c, i) => (
                  <li key={i}>
                    <span className="drive-conflict-reason">{c.reason}</span>
                    <span className="drive-conflict-name"> {c.relPath || c.remoteName || c.fileId}</span>
                  </li>
                ))}
                {conflictDialog.conflicts.length > 8 && (
                  <li>… and {conflictDialog.conflicts.length - 8} more</li>
                )}
              </ul>
            </div>
            <div className="dialog-actions">
              <button className="dialog-btn cancel" onClick={() => setConflictDialog(null)}>Cancel</button>
              <button className="dialog-btn confirm-primary" onClick={doPullFirst}>Pull first</button>
              <button
                className="dialog-btn confirm-danger"
                onClick={() => { setConflictDialog(null); doPush({ force: true }); }}
              >
                Force push
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear local cache?"
          message="Removes downloaded files from disk. Manifest is kept so re-opening is fast. Any unsynced edits will block this."
          confirmLabel="Clear"
          danger
          onConfirm={doClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </>
  );
}

// Inline chip rendered next to the Drive icon in the toolbar row.
function ProgressPill({ progress }) {
  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : null;
  return (
    <div className="drive-pill drive-pill-progress">
      <span className="drive-pill-label">{labelForPhase(progress.phase)}</span>
      {progress.total > 0 && (
        <span className="drive-pill-count">{progress.current}/{progress.total}</span>
      )}
      {pct != null && (
        <span className="drive-pill-bar">
          <span className="drive-pill-fill" style={{ width: `${pct}%` }} />
        </span>
      )}
    </div>
  );
}

function ErrorPill({ message, onDismiss }) {
  return (
    <div className="drive-pill drive-pill-error" onClick={onDismiss} title="Click to dismiss">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
      </svg>
      <span className="drive-pill-label">{message}</span>
    </div>
  );
}

function labelForPhase(phase) {
  switch (phase) {
    case 'listing': return 'Listing…';
    case 'downloading': return 'Downloading';
    case 'pushing': return 'Uploading';
    case 'done': return 'Done';
    default: return phase || '';
  }
}

export default DriveButton;
