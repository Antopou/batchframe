import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DriveIcon from './DriveIcon';
import './DriveFolderPicker.css';

const ROOT = { id: 'root', name: 'My Drive' };

// mode: 'normal' pulls into the local cache workflow; 'live' opens the folder
// directly as a drive:// workspace (caller confirms and sets folderPath).
function DriveFolderPicker({ localPath, mode = 'normal', onSelect, onCreateFolder, onLinkDataset, onClose }) {
  const [crumbs, setCrumbs] = useState([ROOT]);
  const [folders, setFolders] = useState([]);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [focusIndex, setFocusIndex] = useState(-1);
  const [viewMode, setViewMode] = useState('list');
  const [tempShowToggle, setTempShowToggle] = useState(false);
  const searchRef = useRef(null);
  const bodyRef = useRef(null);
  const toggleTimerRef = useRef(null);

  const current = crumbs[crumbs.length - 1];

  const load = useCallback(async (folderId) => {
    setLoading(true);
    setError(null);
    try {
      const r = await window.electronAPI.drive.listFolder(folderId);
      if (!r.success) throw new Error(r.error || 'Failed to list folder');
      setFolders(r.folders || []);
      setImages(r.images || []);
    } catch (e) {
      setError(e.message);
      setFolders([]);
      setImages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(current.id); }, [current.id, load]);

  // Reset the search/focus when we navigate into a different folder.
  useEffect(() => {
    setQuery('');
    setFocusIndex(-1);
  }, [current.id]);

  // The prompt is the resting place for focus: take it back whenever nothing
  // else in the picker deliberately holds it (mount, folder change, load end,
  // clicking a row). Leaves focus alone if the user arrowed onto a button.
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

  const filteredImages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return images;
    return images.filter((f) => f.name.toLowerCase().includes(q));
  }, [images, query]);

  useEffect(() => {
    if (focusIndex >= filteredFolders.length) setFocusIndex(filteredFolders.length - 1);
  }, [filteredFolders.length, focusIndex]);

  const canChooseRoot = current.id !== 'root';
  const folderToCreate = query.trim();
  const exactMatchExists = folders.some((f) => f.name.toLowerCase() === folderToCreate.toLowerCase());
  const showCreateOption = localPath && folderToCreate && !exactMatchExists;
  const nothingHere = !loading && folders.length === 0 && images.length === 0;

  const handleCreateAndEnter = async (name) => {
    setLoading(true);
    const created = await onCreateFolder({ parentId: current.id, name });
    if (created) {
      setQuery('');
      openFolder(created);
    } else {
      setLoading(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex((i) => Math.min((i < 0 ? -1 : i) + 1, filteredFolders.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        if (focusIndex >= 0 && filteredFolders[focusIndex]) {
          e.preventDefault();
          openFolder(filteredFolders[focusIndex]);
        } else if (localPath) {
          e.preventDefault();
          const q = query.trim().toLowerCase();
          if (q) {
            const exactMatch = filteredFolders.find(f => f.name.toLowerCase() === q);
            if (exactMatch) {
              openFolder(exactMatch);
            } else {
              handleCreateAndEnter(query.trim());
            }
          } else if (canChooseRoot) {
            onLinkDataset({ driveFolderId: current.id, datasetName: current.name });
          }
        } else if (query && filteredFolders.length === 1) {
          e.preventDefault();
          openFolder(filteredFolders[0]);
        } else if (!query && focusIndex === -1 && canChooseRoot) {
          e.preventDefault();
          chooseCurrent();
        }
      } else if (e.key === 'Backspace' && !query && crumbs.length > 1) {
        // Go up one directory if the search bar is empty
        e.preventDefault();
        goTo(crumbs.length - 2);
      } else if (e.key === 'Tab') {
        if (query && focusIndex >= -1) {
          e.preventDefault();
          if (focusIndex >= 0 && filteredFolders[focusIndex]) {
            setQuery(filteredFolders[focusIndex].name);
          } else if (filteredFolders.length > 0) {
            setQuery(filteredFolders[0].name);
          }
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const isInput = document.activeElement?.tagName === 'INPUT';
        if (isInput) {
          const input = document.activeElement;
          if (e.key === 'ArrowLeft' && input.selectionStart > 0) return;
          if (e.key === 'ArrowRight' && input.selectionEnd < input.value.length) return;
        }
        
        const actionsDiv = document.querySelector('.drive-picker-actions');
        if (actionsDiv) {
          const buttons = Array.from(actionsDiv.querySelectorAll('button:not([disabled])'));
          if (buttons.length > 0) {
            const currentIndex = buttons.indexOf(document.activeElement);
            let nextIndex = currentIndex;
            if (currentIndex === -1) {
              nextIndex = e.key === 'ArrowRight' ? 0 : buttons.length - 1;
            } else {
              nextIndex = e.key === 'ArrowRight' ? currentIndex + 1 : currentIndex - 1;
              if (nextIndex >= buttons.length) nextIndex = 0;
              if (nextIndex < 0) nextIndex = buttons.length - 1;
            }
            buttons[nextIndex].focus();
            e.preventDefault();
          }
        }
      }
      
      // Select the current directory explicitly with Cmd/Ctrl + Enter
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canChooseRoot) {
        e.preventDefault();
        chooseCurrent();
      }

      // Toggle view mode
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      if ((isMac && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'v') || (!isMac && e.altKey && e.key.toLowerCase() === 'v')) {
        e.preventDefault();
        setViewMode(prev => prev === 'list' ? 'grid' : 'list');
        setTempShowToggle(true);
        if (toggleTimerRef.current) clearTimeout(toggleTimerRef.current);
        toggleTimerRef.current = setTimeout(() => setTempShowToggle(false), 2000);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, filteredFolders, focusIndex, query, localPath, current, canChooseRoot, onLinkDataset, onCreateFolder]);

  // Keep the focused row visible when navigating with arrow keys.
  useEffect(() => {
    if (focusIndex < 0 || !bodyRef.current) return;
    const el = bodyRef.current.querySelector(`.drive-picker-row[data-idx="${focusIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  function openFolder(f) {
    setCrumbs((c) => [...c, { id: f.id, name: f.name }]);
  }

  function goTo(idx) {
    setCrumbs((c) => c.slice(0, idx + 1));
  }

  function chooseCurrent() {
    onSelect({ id: current.id, name: current.name });
  }

  return (
    <div className="drive-picker-overlay" onClick={onClose}>
      <div
        className="drive-picker"
        onClick={(e) => {
          e.stopPropagation();
          // Clicking a row, the toggle or dead space should hand typing back to
          // the prompt; only the footer buttons keep focus for Enter/Space.
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
          <div className={`drive-picker-view-toggle ${tempShowToggle ? 'show' : ''}`} style={{ marginLeft: '12px' }}>
            <button 
              className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`} 
              onClick={() => setViewMode('list')}
              title={`List View (${navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Ctrl' : 'Alt'} + V)`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
            <button 
              className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`} 
              onClick={() => setViewMode('grid')}
              title={`Grid View (${navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Ctrl' : 'Alt'} + V)`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/></svg>
            </button>
          </div>
        </div>

        <div className="drive-picker-body" ref={bodyRef}>
          {error && <div className="drive-picker-error">{error}</div>}
          {loading && (
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

          {!loading && viewMode === 'list' && (
            <>
              {showCreateOption && (
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
                    Create <strong style={{ color: 'var(--accent)', fontStyle: 'normal' }}>"{folderToCreate}"</strong> here...
                  </span>
                </div>
              )}
              {filteredFolders.map((f, idx) => (
                <div
                  key={f.id}
                  data-idx={idx}
                  className={`drive-picker-row folder${idx === focusIndex ? ' focused' : ''}${query ? ' matched' : ''}`}
                  onDoubleClick={() => openFolder(f)}
                  onClick={() => openFolder(f)}
                  title="Click to open"
                >
                  <span className="drive-picker-icon folder-icon" aria-hidden>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                    </svg>
                  </span>
                  <span className="drive-picker-name">{highlight(f.name, query)}</span>
                </div>
              ))}
              {filteredImages.map((f) => (
                <div key={f.id} className="drive-picker-row image">
                  <span className="drive-picker-icon image-icon" aria-hidden>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <circle cx="9" cy="9" r="1.5"/>
                      <path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L4 21"/>
                    </svg>
                  </span>
                  <span className="drive-picker-name">{highlight(f.name, query)}</span>
                </div>
              ))}
            </>
          )}

          {!loading && viewMode === 'grid' && (filteredFolders.length > 0 || filteredImages.length > 0 || showCreateOption) && (
            <div className="drive-picker-grid">
              {showCreateOption && (
                <div 
                  className="drive-picker-grid-item create-new" 
                  onClick={() => handleCreateAndEnter(folderToCreate)} 
                  title={`Create ${folderToCreate} and navigate into it`}
                >
                  <div className="drive-picker-no-thumb" style={{ color: 'var(--accent)' }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </div>
                  <div className="drive-picker-grid-label" style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.8)' }}>
                    Create <strong style={{ color: 'var(--accent)', fontStyle: 'normal' }}>"{folderToCreate}"</strong>
                  </div>
                </div>
              )}
              {filteredFolders.map((f, idx) => (
                <div 
                  key={f.id} 
                  data-idx={idx} 
                  className={`drive-picker-grid-item folder${idx === focusIndex ? ' focused' : ''}`} 
                  onDoubleClick={() => openFolder(f)} 
                  onClick={() => openFolder(f)} 
                  title={`Click to open ${f.name}`}
                >
                  <div className="drive-picker-no-thumb" style={{ color: 'var(--accent)' }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                    </svg>
                  </div>
                  <div className="drive-picker-grid-label">{highlight(f.name, query)}</div>
                </div>
              ))}
              {filteredImages.map((f) => (
                <div key={f.id} className="drive-picker-grid-item" title={f.name}>
                  {f.thumbnailLink ? (
                    <img src={f.thumbnailLink} alt={f.name} loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="drive-picker-no-thumb">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <circle cx="9" cy="9" r="1.5"/>
                        <path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L4 21"/>
                      </svg>
                    </div>
                  )}
                  <div className="drive-picker-grid-label">{highlight(f.name, query)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="drive-picker-footer">
          <div className="drive-picker-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button className="btn-terminal action-cancel" onClick={onClose}>[ cancel ]</button>
            {localPath ? (
              <button
                className="btn-terminal action-push"
                disabled={!canChooseRoot}
                onClick={() => onLinkDataset({ driveFolderId: current.id, datasetName: current.name })}
                title={!canChooseRoot ? "Navigate into a folder to push" : `Link local dataset to "${current.name}" and push`}
              >
                [ push here ]
              </button>
            ) : (
              <button
                className="btn-terminal action-open"
                disabled={!canChooseRoot && images.length === 0}
                onClick={chooseCurrent}
                title={!canChooseRoot
                  ? 'Pick a subfolder before importing'
                  : mode === 'live'
                    ? `Open ${current.name} live — edits apply directly to Drive (Cmd/Ctrl + Enter)`
                    : `Open ${current.name} (Cmd/Ctrl + Enter)`}
              >
                {mode === 'live' ? '[ open live ]' : '[ open ]'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Wraps the query substring in a highlight span. Case-insensitive, first match only.
function highlight(name, query) {
  return name;
}

export default DriveFolderPicker;
