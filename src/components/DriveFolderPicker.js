import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DriveIcon from './DriveIcon';
import './DriveFolderPicker.css';

const ROOT = { id: 'root', name: 'My Drive' };

function DriveFolderPicker({ onSelect, onClose }) {
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
    searchRef.current?.focus();
  }, [current.id]);

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
        if (query) {
          e.preventDefault();
          if (focusIndex >= 0 && filteredFolders[focusIndex]) {
            setQuery(filteredFolders[focusIndex].name);
          } else if (filteredFolders.length > 0) {
            setQuery(filteredFolders[0].name);
          }
        } else {
          e.preventDefault();
        }
      }
      
      // Select the current directory explicitly with Cmd/Ctrl + Enter
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canChooseRoot) {
        e.preventDefault();
        chooseCurrent();
      }

      // Toggle view mode
      if ((e.metaKey || e.ctrlKey) && e.key === '1') {
        e.preventDefault();
        setViewMode('list');
        setTempShowToggle(true);
        if (toggleTimerRef.current) clearTimeout(toggleTimerRef.current);
        toggleTimerRef.current = setTimeout(() => setTempShowToggle(false), 2000);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '2') {
        e.preventDefault();
        setViewMode('grid');
        setTempShowToggle(true);
        if (toggleTimerRef.current) clearTimeout(toggleTimerRef.current);
        toggleTimerRef.current = setTimeout(() => setTempShowToggle(false), 2000);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, filteredFolders, focusIndex, query]);

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

  const canChooseRoot = current.id !== 'root';
  const nothingHere = !loading && !error && filteredFolders.length === 0 && filteredImages.length === 0;

  return (
    <div className="drive-picker-overlay" onClick={onClose}>
      <div className="drive-picker" onClick={(e) => e.stopPropagation()}>
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
            autoFocus
          />
          {query && (
            <button className="drive-picker-search-clear" onClick={() => setQuery('')} title="Clear (Esc)">×</button>
          )}
          <div className={`drive-picker-view-toggle ${tempShowToggle ? 'show' : ''}`} style={{ marginLeft: '12px' }}>
            <button 
              className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`} 
              onClick={() => setViewMode('list')}
              title="List View (Cmd/Ctrl + 1)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
            <button 
              className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`} 
              onClick={() => setViewMode('grid')}
              title="Grid View (Cmd/Ctrl + 2)"
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

          {nothingHere && (
            <div className="drive-picker-empty">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
              <span>{query ? `Nothing matches “${query}”.` : 'This folder is empty.'}</span>
            </div>
          )}

          {!loading && filteredFolders.map((f, idx) => (
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

          {!loading && viewMode === 'list' && filteredImages.map((f) => (
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

          {!loading && viewMode === 'grid' && filteredImages.length > 0 && (
            <div className="drive-picker-grid">
              {filteredImages.map((f) => (
                <div key={f.id} className="drive-picker-grid-item" title={f.name}>
                  {f.thumbnailLink ? (
                    <img src={f.thumbnailLink} alt={f.name} loading="lazy" />
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
          <div className="drive-picker-footer-left" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span className="drive-picker-search-count">
              {filteredFolders.length + filteredImages.length}
              {query && folders.length + images.length !== filteredFolders.length + filteredImages.length
                ? ` / ${folders.length + images.length}` : ''} items
            </span>
          </div>
          <div className="drive-picker-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="btn-modern ghost sm" onClick={onClose}>Cancel</button>
            <button
              className="btn-modern success sm"
              disabled={!canChooseRoot && images.length === 0}
              onClick={chooseCurrent}
              title={!canChooseRoot ? 'Pick a subfolder before importing' : `Open ${current.name} (Cmd/Ctrl + Enter)`}
            >
              Open
            </button>
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
