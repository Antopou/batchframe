import React, { useCallback, useEffect, useRef, useState } from 'react';
import DriveIcon from './DriveIcon';
import CloudSyncIcon from './CloudSyncIcon';
import DriveFolderPicker from './DriveFolderPicker';
import ContextMenu from './ContextMenu';
import ConfirmDialog from './ConfirmDialog';
import SyncDiffModal from './SyncDiffModal';
import './DriveButton.css';

const LONG_PRESS_MS = 500;

// Minimal, icon-driven Drive control.
// Left click: sign-in (if not signed in) or open folder picker (if signed in).
// Right click / long-press: context menu (Push / Clear cache / Sign out).
// State overlays: green dot (connected), amber count pill (dirty), spinner ring (busy).
// Transient progress pill anchored under the button during pull/push.
// liveRequest (a counter, bumped by Cmd+Shift+D) opens the picker in live
// mode; a picked folder is confirmed and handed to onOpenLive({ id, name }).
function DriveButton({ localPath, cacheRoot, manifest, summary, onDatasetOpened, liveRequest, onOpenLive, liveActive }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [progress, setProgress] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState('normal'); // 'normal' | 'live'
  const [menu, setMenu] = useState(null); // { x, y }
  const [conflictDialog, setConflictDialog] = useState(null);
  const [reviewPush, setReviewPush] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmLive, setConfirmLive] = useState(null); // { id, name } | null
  const [error, setError] = useState(null);
  const [autoOpenSync, setAutoOpenSync] = useState(false);

  const btnRef = useRef(null);
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

  const syncDirection = useRef('up');

  const refreshStatus = useCallback(async () => {
    if (!window.electronAPI?.drive) return;
    setStatus(await window.electronAPI.drive.status());
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    if (!window.electronAPI?.drive) return;
    window.electronAPI.drive.onProgress((p) => {
      if (p.phase === 'pushing') syncDirection.current = 'up';
      else if (p.phase === 'pulling' || p.phase === 'downloading' || p.phase === 'listing') syncDirection.current = 'down';
      setProgress(p);
    });
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

  // Auto-open sync panel after pushNew completes and manifest is loaded
  useEffect(() => {
    if (autoOpenSync && manifest && status?.configured) {
      setAutoOpenSync(false);
      setTimeout(() => setReviewPush(true), 100);
    }
  }, [autoOpenSync, manifest, status?.configured]);

  // Cmd+Shift+D: open the picker in live mode, signing in first if needed.
  // Reads status fresh so a stale prop can't route us wrong.
  useEffect(() => {
    if (!liveRequest || !window.electronAPI?.drive) return;
    let cancelled = false;
    (async () => {
      const st = await window.electronAPI.drive.status();
      if (cancelled) return;
      setStatus(st);
      if (!st?.configured) {
        setError('Set GOOGLE_CLIENT_ID in .env to use Drive');
        return;
      }
      if (!st.signedIn) {
        setSigningIn(true);
        try {
          const r = await window.electronAPI.drive.signIn();
          if (!r.success) throw new Error(r.error || 'Sign-in failed');
          if (cancelled) return;
          setStatus(await window.electronAPI.drive.status());
        } catch (e) {
          if (!cancelled) setError(e.message);
          return;
        } finally {
          if (!cancelled) setSigningIn(false);
        }
      }
      if (!cancelled) {
        setPickerMode('live');
        setShowPicker(true);
      }
    })();
    return () => { cancelled = true; };
  }, [liveRequest]);

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
    if (!cacheRoot || !manifest) return;
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
  }, [cacheRoot, manifest]);

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
    setConfirmClear(false);
    setBusy(true);
    setError(null);
    try {
      const r = await window.electronAPI.drive.clearAllCache();
      if (!r.ok) {
        setError(r.error === 'unsynced-changes' ? 'Push first — unsynced edits exist.' : (r.error || 'Clear failed'));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const openMenuAtRect = useCallback((rect) => {
    setMenu({ x: rect.left, y: rect.bottom + 6 });
  }, []);

  // ── Click handlers ─────────────────────────────────────────
  const handleClick = useCallback(async (e) => {
    if (longPressFired.current) {
      longPressFired.current = false;
      e.preventDefault();
      return;
    }
    if (!status) return;
    if (!status.configured) return; // tooltip covers this
    if (!status.signedIn) { doSignIn(); return; }
    
    const dirtyCount = summary?.dirty || 0;
    if (dirtyCount > 0) {
      setBusy(true);
      try {
        await window.electronAPI.drive.refreshManifest({ cacheRoot });
      } catch (err) {
        console.error(err);
      } finally {
        setBusy(false);
        setReviewPush(true);
      }
    } else {
      setPickerMode('normal');
      setShowPicker(true);
    }
  }, [status, doSignIn, summary?.dirty, cacheRoot]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    if (!status?.signedIn) return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) openMenuAtRect(rect);
  }, [openMenuAtRect, status]);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (!status?.signedIn) return;
    longPressFired.current = false;
    const rect = e.currentTarget.getBoundingClientRect();
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      openMenuAtRect(rect);
    }, LONG_PRESS_MS);
  }, [openMenuAtRect, status]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePicked = useCallback(async ({ id, name }) => {
    setShowPicker(false);
    if (pickerMode === 'live') {
      // No pull — confirm, then the app opens drive://<id> as the workspace.
      setConfirmLive({ id, name });
      return;
    }
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
  }, [onDatasetOpened, pickerMode]);

  const handleCreateFolder = useCallback(async ({ parentId, name }) => {
    setBusy(true);
    try {
      const r = await window.electronAPI.drive.createFolder({ parentId, name });
      if (!r.success) throw new Error(r.error || 'Failed to create folder');
      return r.folder;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const handleLinkDataset = useCallback(async ({ driveFolderId, datasetName }) => {
    setShowPicker(false);
    setBusy(true);
    setError(null);
    setProgress({ phase: 'creating' });
    try {
      const r = await window.electronAPI.drive.linkDataset({
        localPath,
        driveFolderId,
        datasetName
      });
      if (!r.success) throw new Error(r.error || 'Link failed');
      onDatasetOpened?.(r.cacheRoot);
      setAutoOpenSync(true);
    } catch (e) {
      setError(e.message);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }, [localPath, onDatasetOpened]);

  // ── Derived UI state ───────────────────────────────────────
  if (!window.electronAPI?.drive) return null;

  const dirty = summary?.dirty || 0;
  let badgeCount = dirty;
  if (progress && progress.phase === 'pushing' && progress.total > 0) {
    badgeCount = Math.max(0, progress.total - (progress.current || 0));
  }

  const stateClass = [
    'drive-btn',
    !status?.configured && 'unconfigured',
    status?.signedIn && 'connected',
    dirty > 0 && 'has-changes',
    (busy || signingIn || progress) && 'busy',
    menu && 'menu-open',
    liveActive && 'live',
  ].filter(Boolean).join(' ');

  const tooltip = !status
    ? 'Google Drive'
    : !status.configured
      ? 'Set CLIENT_ID in src/drive/config.js'
      : !status.signedIn
        ? 'Sign in to Google Drive'
        : liveActive
          ? 'LIVE — edits apply directly to Drive'
          : cacheRoot
            ? `Drive · ${manifest?.datasetName || ''}${dirty ? ` · ${dirty} unsynced` : ''}`
            : 'Open folder from Drive';

  const menuItems = [];
  if (status?.signedIn) {
    // Removed Folder label as requested
    menuItems.push({
      label: `Push to Drive${dirty ? ` (${dirty})` : ''}`,
      disabled: !cacheRoot || busy,
      onClick: async () => {
        setBusy(true);
        try {
          await window.electronAPI.drive.refreshManifest({ cacheRoot });
        } catch (err) {
          console.error(err);
        } finally {
          setBusy(false);
          setReviewPush(true);
        }
      },
    });
    menuItems.push({
      label: 'Pull from Drive',
      disabled: !cacheRoot || busy,
      onClick: doPullFirst,
    });
    menuItems.push({
      label: 'Clear Data',
      disabled: busy,
      onClick: () => setConfirmClear(true),
    });
    menuItems.push({
      label: 'Change folder…',
      disabled: busy,
      onClick: () => { setPickerMode('normal'); setShowPicker(true); },
    });
    menuItems.push({
      label: 'Open live folder…',
      disabled: busy,
      onClick: () => { setPickerMode('live'); setShowPicker(true); },
    });
    menuItems.push({ separator: true });
    menuItems.push({ label: 'Sign out', danger: true, onClick: doSignOut });
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
        <span className={progress ? "drive-btn-icon drive-icon-syncing" : "drive-btn-icon"}>
          {progress ? <CloudSyncIcon size={14} color="#22d3ee" direction={syncDirection.current} /> : <DriveIcon size={14} />}
        </span>
        {liveActive && status?.signedIn ? (
          <span className="drive-btn-badge drive-btn-badge-live">LIVE</span>
        ) : badgeCount > 0 && status?.signedIn ? (
          <span className={`drive-btn-badge ${progress ? 'syncing' : ''}`.trim()}>{badgeCount > 99 ? '99+' : badgeCount}</span>
        ) : null}
      </button>

      {error && <ErrorPill message={error} onDismiss={() => setError(null)} />}

      {showPicker && (
        <DriveFolderPicker
          localPath={pickerMode === 'live' ? null : localPath}
          mode={pickerMode}
          onSelect={handlePicked}
          onCreateFolder={handleCreateFolder}
          onLinkDataset={handleLinkDataset}
          onClose={() => setShowPicker(false)}
        />
      )}

      {confirmLive && (
        <ConfirmDialog
          title={`Open "${confirmLive.name}" live?`}
          message="Every edit — crop, rename, move, delete — applies directly to your Drive as you make it. Deletes go to Drive's trash. Nothing is downloaded up front."
          confirmLabel="Open Live"
          danger
          onConfirm={() => {
            const picked = confirmLive;
            setConfirmLive(null);
            onOpenLive?.(picked);
          }}
          onCancel={() => setConfirmLive(null)}
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
        <div className="drive-picker-overlay" onClick={() => setConflictDialog(null)}>
          <div className="drive-picker" onClick={(e) => e.stopPropagation()}>
            <div className="terminal-omnibar">
              <div className="terminal-prompt">
                <span className="terminal-root">~</span>
                <span className="terminal-sep">/</span>
                <span className="terminal-dir">Drive Conflict</span>
                <span className="terminal-arrow">❯</span>
              </div>
            </div>
            
            <div className="drive-picker-body">
              <div style={{ padding: '12px 16px', color: '#9a9aa2', fontSize: '13px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                {conflictDialog.conflicts.length} file{conflictDialog.conflicts.length === 1 ? '' : 's'} changed on Drive since your last pull:
              </div>
              <div className="sync-diff-list">
                {conflictDialog.conflicts.slice(0, 8).map((c, i) => {
                  let badge = '[~]';
                  let colorClass = 'diff-mod';
                  if (c.reason === 'removed' || c.reason === 'trashed') {
                    badge = '[-]';
                    colorClass = 'diff-del';
                  } else if (c.reason === 'new-on-drive') {
                    badge = '[+]';
                    colorClass = 'diff-new';
                  }
                  return (
                    <div key={i} className="sync-diff-item">
                      <span className={`sync-diff-icon ${colorClass}`}>{badge}</span>
                      <span className="drive-picker-name" style={{ color: '#e6e6e8' }}>
                        {c.relPath || c.remoteName || c.fileId}
                      </span>
                    </div>
                  );
                })}
                {conflictDialog.conflicts.length > 8 && (
                  <div className="sync-diff-item" style={{ color: '#6a6a72' }}>
                    … and {conflictDialog.conflicts.length - 8} more
                  </div>
                )}
              </div>
            </div>

            <div className="drive-picker-footer">
              <div className="drive-picker-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button className="btn-terminal action-cancel" onClick={() => setConflictDialog(null)}>[ cancel ]</button>
                <button className="btn-terminal action-push" onClick={doPullFirst}>[ pull first ]</button>
                <button
                  className="btn-terminal"
                  style={{ color: 'var(--red)' }}
                  onClick={() => { setConflictDialog(null); doPush({ force: true }); }}
                >
                  [ force push ]
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear Data?"
          message="Removes all downloaded Drive files from your disk to save space. Manifests are kept so re-opening is fast. Any unsynced edits will block this."
          confirmLabel="Clear All"
          danger
          onConfirm={doClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      {reviewPush && (
        <SyncDiffModal
          manifest={manifest}
          cacheRoot={cacheRoot}
          onConfirm={() => {
            setReviewPush(false);
            doPush();
          }}
          onCancel={() => setReviewPush(false)}
          onChangeDataset={() => {
            setReviewPush(false);
            setShowPicker(true);
          }}
        />
      )}
    </>
  );
}

// Removed ProgressPill component

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
