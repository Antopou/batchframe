import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './DriveFolderPicker.css';
import ContextMenu from './ContextMenu';

// Destination picker for move/copy of local files. Mirrors DriveFolderPicker's
// open-panel look: `~ / <last dirs> ❯` prompt, folder-only list, keyboard
// navigation. Backspace at the top prepends the parent folder (from the
// getSubfolders response) so users can walk up past the start folder.
function LocalDestinationPicker({ action, startPath, sourcePath, onSelect, onClose }) {
  const initialCrumbs = useMemo(() => [{ name: basename(startPath), path: startPath }], [startPath]);
  const [crumbs, setCrumbs] = useState(initialCrumbs);
  const [folders, setFolders] = useState([]);
  const [parentPath, setParentPath] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [focusIndex, setFocusIndex] = useState(-1);
  const searchRef = useRef(null);
  const bodyRef = useRef(null);

  // Right-click "Show images" toggle. Default: folder-only.
  // Persisted in localStorage so the preference sticks across picker sessions.
  const SHOW_IMAGES_KEY = 'batchframe:picker:showImages';
  const [showImages, setShowImages] = useState(() => {
    try { return localStorage.getItem(SHOW_IMAGES_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SHOW_IMAGES_KEY, showImages ? '1' : '0'); } catch {}
  }, [showImages]);
  const [folderImages, setFolderImages] = useState([]);
  const [ctxMenu, setCtxMenu] = useState(null);

  const current = crumbs[crumbs.length - 1];
  const currentPath = current.path;

  const load = useCallback(async (folderPath) => {
    setLoading(true);
    setError(null);
    try {
      const r = await window.electronAPI.getSubfolders(folderPath);
      let list = (r?.subfolders || []).slice().sort((a, b) => a.name.localeCompare(b.name));
      if (action === 'open') {
        list = list.filter(f => !f.name.startsWith('.'));
      }
      setFolders(list);
      setParentPath(r?.parentPath || null);
      if (!folderPath && r?.resolvedPath) {
        setCrumbs([{ name: basename(r.resolvedPath), path: r.resolvedPath }]);
      }
    } catch (e) {
      setError(e.message);
      setFolders([]);
      setParentPath(null);
    } finally {
      setLoading(false);
    }
  }, [action]);

  useEffect(() => { load(currentPath); }, [currentPath, load]);

  // Load images for the current folder only when "Show images" is toggled on.
  useEffect(() => {
    if (!showImages) { setFolderImages([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const list = await window.electronAPI.getImages(currentPath);
        if (!cancelled) setFolderImages(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setFolderImages([]);
      }
    })();
    return () => { cancelled = true; };
  }, [showImages, currentPath]);

  useEffect(() => {
    setQuery('');
    setFocusIndex(-1);
  }, [currentPath]);

  const focusPrompt = useCallback(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active !== searchRef.current) return;
    searchRef.current?.focus();
  }, []);

  useEffect(() => { focusPrompt(); }, [currentPath, loading, focusPrompt]);

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, query]);

  useEffect(() => {
    if (focusIndex >= filteredFolders.length) setFocusIndex(filteredFolders.length - 1);
  }, [filteredFolders.length, focusIndex]);

  const isSameAsSource = sourcePath && currentPath === sourcePath;
  const canChoose = action === 'open' || !isSameAsSource;
  const folderToCreate = query.trim();
  const exactMatchExists = folders.some((f) => f.name.toLowerCase() === folderToCreate.toLowerCase());
  const showCreateOption = folderToCreate.length > 0 && !exactMatchExists && !hasBadNameChars(folderToCreate);

  function openFolder(f) {
    setCrumbs((c) => [...c, { name: f.name, path: f.path }]);
  }

  function goTo(idx) {
    setCrumbs((c) => c.slice(0, idx + 1));
  }

  function goUp() {
    if (crumbs.length > 1) {
      setCrumbs((c) => c.slice(0, -1));
    } else if (parentPath) {
      setCrumbs([{ name: basename(parentPath), path: parentPath }]);
    }
  }

  const chooseCurrent = useCallback(() => {
    if (!canChoose) return;
    onSelect(currentPath);
  }, [canChoose, currentPath, onSelect]);

  const handleCreateAndEnter = useCallback(async (name) => {
    setCreating(true);
    try {
      const r = await window.electronAPI.createFolder(currentPath, name);
      if (r?.success && r.path) {
        setQuery('');
        setCrumbs((c) => [...c, { name, path: r.path }]);
      } else if (r?.error) {
        setError(r.error);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }, [currentPath]);

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
      } else if (e.key === 'Backspace' && !query) {
        if (crumbs.length > 1 || parentPath) {
          e.preventDefault();
          goUp();
        }
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
      canChoose, chooseCurrent, handleCreateAndEnter, crumbs.length, parentPath]);

  useEffect(() => {
    if (focusIndex < 0 || !bodyRef.current) return;
    const el = bodyRef.current.querySelector(`.drive-picker-row[data-idx="${focusIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  const nothingHere = !loading && folders.length === 0 && (!showImages || folderImages.length === 0);

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
              <React.Fragment key={`${c.path}-${i}`}>
                <span className="terminal-sep">/</span>
                <span className="terminal-dir" title={c.path}>{c.name}</span>
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

        <div
          className="drive-picker-body"
          ref={bodyRef}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCtxMenu({ x: e.clientX, y: e.clientY });
          }}
        >
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
            const isSource = sourcePath && f.path === sourcePath;
            return (
              <div
                key={f.path}
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

          {!loading && showImages && folderImages.map((img) => (
            <div
              key={img.path}
              className="drive-picker-row image"
              title={img.name}
            >
              <span className="drive-picker-icon image-icon" aria-hidden>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
              </span>
              <span className="drive-picker-name">{img.name}</span>
            </div>
          ))}
        </div>

        {ctxMenu && (
          <ContextMenu
            position={ctxMenu}
            onClose={() => setCtxMenu(null)}
            items={[
              {
                label: showImages ? 'Hide images' : 'Show images',
                onClick: () => setShowImages((v) => !v),
              },
            ]}
          />
        )}

        <div className="drive-picker-footer">
          <div className="drive-picker-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button className="btn-terminal action-cancel" onClick={onClose}>[ cancel ]</button>
            <button
              className="btn-terminal action-push"
              disabled={!canChoose}
              onClick={chooseCurrent}
              title={
                (isSameAsSource && action !== 'open')
                  ? 'Destination equals source'
                  : `${action === 'move' ? 'Move' : action === 'copy' ? 'Copy' : 'Open'} ${action === 'open' ? 'from' : 'into'} ${current.name} (Cmd/Ctrl + Enter)`
              }
            >
              {action === 'move' ? '[ move here ]' : action === 'copy' ? '[ copy here ]' : '[ open folder ]'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function basename(p) {
  if (!p) return '/';
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] || '/';
}

function hasBadNameChars(name) {
  return /[/\\:*?"<>|]/.test(name);
}

export default LocalDestinationPicker;
