import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './DriveFolderPicker.css';

const ROOT = { id: 'root', name: 'My Drive' };

// Destination picker for move/copy of Drive files. Visual + keyboard model
// mirror DriveFolderPicker's open panel — same prompt, same navigation.
// Only the confirm button label differs.
function DriveDestinationPicker({ action, sourceFolderId, onSelect, onCreateFolder, onClose }) {
  const [crumbs, setCrumbs] = useState([ROOT]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [focusIndex, setFocusIndex] = useState(-1);
  const searchRef = useRef(null);
  const bodyRef = useRef(null);

  const current = crumbs[crumbs.length - 1];

  const load = useCallback(async (folderId) => {
    setLoading(true);
    setError(null);
    try {
      const r = await window.electronAPI.drive.listFolder(folderId);
      if (!r.success) throw new Error(r.error || 'Failed to list folder');
      setFolders(r.folders || []);
    } catch (e) {
      setError(e.message);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(current.id); }, [current.id, load]);

  useEffect(() => {
    setQuery('');
    setFocusIndex(-1);
  }, [current.id]);

  const focusPrompt = useCallback(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active !== searchRef.current) return;
    searchRef.current?.focus();
  }, []);

  useEffect(() => { focusPrompt(); }, [current.id, loading, focusPrompt]);

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, query]);

  useEffect(() => {
    if (focusIndex >= filteredFolders.length) setFocusIndex(filteredFolders.length - 1);
  }, [filteredFolders.length, focusIndex]);

  const isSameAsSource = sourceFolderId && current.id === sourceFolderId;
  const canChoose = current.id !== 'root' && !isSameAsSource;
  const folderToCreate = query.trim();
  const exactMatchExists = folders.some((f) => f.name.toLowerCase() === folderToCreate.toLowerCase());
  const showCreateOption = !!onCreateFolder && folderToCreate.length > 0 && !exactMatchExists && current.id !== 'root';

  function openFolder(f) {
    setCrumbs((c) => [...c, { id: f.id, name: f.name }]);
  }

  function goTo(idx) {
    setCrumbs((c) => c.slice(0, idx + 1));
  }

  const chooseCurrent = useCallback(() => {
    if (!canChoose) return;
    onSelect({ id: current.id, name: current.name });
  }, [canChoose, current, onSelect]);

  const handleCreateAndEnter = useCallback(async (name) => {
    if (!onCreateFolder) return;
    setCreating(true);
    try {
      const created = await onCreateFolder({ parentId: current.id, name });
      if (created) {
        setQuery('');
        setCrumbs((c) => [...c, { id: created.id, name: created.name }]);
      }
    } finally {
      setCreating(false);
    }
  }, [onCreateFolder, current.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        if (canChoose) {
          e.preventDefault();
          chooseCurrent();
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex((i) => Math.min((i < 0 ? -1 : i) + 1, filteredFolders.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex((i) => Math.max(i - 1, -1));
      } else if (e.key === 'Enter') {
        if (focusIndex >= 0 && filteredFolders[focusIndex]) {
          e.preventDefault();
          openFolder(filteredFolders[focusIndex]);
        } else if (folderToCreate) {
          e.preventDefault();
          const exactMatch = folders.find((f) => f.name.toLowerCase() === folderToCreate.toLowerCase());
          if (exactMatch) openFolder(exactMatch);
          else if (showCreateOption) handleCreateAndEnter(folderToCreate);
        } else if (!query && focusIndex === -1 && canChoose) {
          e.preventDefault();
          chooseCurrent();
        }
      } else if (e.key === 'Backspace' && !query && crumbs.length > 1) {
        e.preventDefault();
        goTo(crumbs.length - 2);
      } else if (e.key === 'Tab') {
        if (query && filteredFolders.length > 0) {
          e.preventDefault();
          const target = focusIndex >= 0 ? filteredFolders[focusIndex] : filteredFolders[0];
          setQuery(target.name);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, filteredFolders, focusIndex, query, folderToCreate, folders, showCreateOption,
      canChoose, chooseCurrent, handleCreateAndEnter, crumbs.length]);

  useEffect(() => {
    if (focusIndex < 0 || !bodyRef.current) return;
    const el = bodyRef.current.querySelector(`.drive-picker-row[data-idx="${focusIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  const nothingHere = !loading && folders.length === 0;

  return (
    <div className="drive-picker-overlay" onClick={onClose}>
      <div
        className="drive-picker"
        onClick={(e) => {
          e.stopPropagation();
          if (e.target.closest('.drive-picker-actions')) return;
          searchRef.current?.focus();
        }}
      >
        <div className="terminal-omnibar">
          <div className="terminal-prompt">
            <span className="terminal-root">~</span>
            {crumbs.length > 2 && (
              <>
                <span className="terminal-sep">/</span>
                <span className="terminal-dir">...</span>
              </>
            )}
            {crumbs.slice(-2).map((c, i) => (
              <React.Fragment key={`${c.id}-${i}`}>
                <span className="terminal-sep">/</span>
                <span className="terminal-dir" title={c.name}>{c.name}</span>
              </React.Fragment>
            ))}
            <span className="terminal-arrow">❯</span>
          </div>

          <input
            ref={searchRef}
            type="text"
            className="terminal-input"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setFocusIndex(-1); }}
          />
          {query && (
            <button className="drive-picker-search-clear" onClick={() => setQuery('')} title="Clear (Esc)">×</button>
          )}
        </div>

        <div className="drive-picker-body" ref={bodyRef}>
          {error && <div className="drive-picker-error">{error}</div>}
          {(loading || creating) && (
            <div className="terminal-loader">
              <span className="terminal-loader-text"></span>
            </div>
          )}

          {nothingHere && !showCreateOption && (
            <div className="drive-picker-empty">
              <div className="drive-picker-empty-code">
                <span className="empty-comment">
                  {query ? `// 0 matches for "${query}"` : `// directory is empty`}
                </span>
                <span className="empty-blinker">_</span>
              </div>
            </div>
          )}

          {!loading && showCreateOption && (
            <div
              className="drive-picker-row create-new"
              onClick={() => handleCreateAndEnter(folderToCreate)}
              title="Create this folder and navigate into it"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '4px', paddingBottom: '4px' }}
            >
              <span className="drive-picker-icon folder-icon" aria-hidden style={{ color: 'var(--accent)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </span>
              <span className="drive-picker-name" style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.8)' }}>
                Create <strong style={{ color: 'var(--accent)', fontStyle: 'normal' }}>"{folderToCreate}"</strong> here…
              </span>
            </div>
          )}

          {!loading && filteredFolders.map((f, idx) => {
            const isSource = sourceFolderId && f.id === sourceFolderId;
            return (
              <div
                key={f.id}
                data-idx={idx}
                className={`drive-picker-row folder${idx === focusIndex ? ' focused' : ''}${query ? ' matched' : ''}`}
                onDoubleClick={() => openFolder(f)}
                onClick={() => openFolder(f)}
                title="Click to open"
                style={isSource ? { opacity: 0.55 } : undefined}
              >
                <span className="drive-picker-icon folder-icon" aria-hidden>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                  </svg>
                </span>
                <span className="drive-picker-name">{f.name}</span>
              </div>
            );
          })}
        </div>

        <div className="drive-picker-footer">
          <div className="drive-picker-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button className="btn-terminal action-cancel" onClick={onClose}>[ cancel ]</button>
            <button
              className="btn-terminal action-push"
              disabled={!canChoose}
              onClick={chooseCurrent}
              title={
                isSameAsSource
                  ? 'Destination equals source'
                  : !canChoose
                    ? 'Pick a subfolder'
                    : `${action === 'move' ? 'Move' : 'Copy'} into ${current.name} (Cmd/Ctrl + Enter)`
              }
            >
              {action === 'move' ? '[ move here ]' : '[ copy here ]'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DriveDestinationPicker;
