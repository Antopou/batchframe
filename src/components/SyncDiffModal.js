import React, { useEffect, useState, useRef } from 'react';
import './DriveFolderPicker.css';
import './SyncDiffModal.css';

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
);

function SyncGridItem({ item, cacheRoot }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (item.state === 'del' && item.driveFileId) {
      window.electronAPI?.drive?.getThumbnail?.(item.driveFileId).then(link => {
        if (!cancelled && link) setSrc(link);
      });
    } else if (cacheRoot && item.state !== 'del') {
      const absPath = `${cacheRoot}/${item.path}`;
      window.electronAPI?.getImageData?.(absPath).then(base64 => {
        if (!cancelled && base64) setSrc(`data:image/jpeg;base64,${base64}`);
      });
    }
    return () => { cancelled = true; };
  }, [item, cacheRoot]);

  const colorVar = item.state === 'new' ? 'green' : item.state === 'mod' ? 'amber' : item.state === 'del' ? 'red' : 'accent';
  const label = item.state === 'ren' ? `${item.from} -> ${item.path}` : item.path;
  const badge = item.state === 'new' ? '[+]' : item.state === 'mod' ? '[~]' : item.state === 'del' ? '[-]' : '[R]';

  return (
    <div className="drive-picker-grid-item" title={label}>
      {src ? (
        <img src={src} loading="lazy" referrerPolicy="no-referrer" alt="" />
      ) : (
        <div className="drive-picker-no-thumb" style={{ color: `var(--${colorVar})` }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="9" cy="9" r="1.5"/>
            <path d="m21 15-3.5-3.5a2 2 0 0 0-2.8 0L4 21"/>
          </svg>
        </div>
      )}
      <div className="drive-picker-grid-label">
        <span className={`diff-${item.state}`} style={{ marginRight: '4px' }}>{badge}</span>
        {item.path.split('/').pop()}
      </div>
    </div>
  );
}

export default function SyncDiffModal({ manifest, cacheRoot, onConfirm, onCancel, onChangeDataset }) {
  const [viewMode, setViewMode] = useState('list');
  const [tempShowToggle, setTempShowToggle] = useState(false);
  const toggleTimerRef = useRef(null);

  const news = [];
  const modifieds = [];
  const deleteds = [];
  const renameds = [];

  for (const [relPath, entry] of Object.entries(manifest?.files || {})) {
    if (entry.state === 'new') news.push(relPath);
    else if (entry.state === 'modified') modifieds.push(relPath);
    else if (entry.state === 'deleted') deleteds.push(relPath);
    else if (entry.state === 'renamed') renameds.push({ from: entry.renamedFrom, to: relPath });
  }

  const total = news.length + modifieds.length + deleteds.length + renameds.length;

  const allItems = [
    ...news.map(p => ({ path: p, state: 'new' })),
    ...modifieds.map(p => ({ path: p, state: 'mod' })),
    ...renameds.map(r => ({ path: r.to, from: r.from, state: 'ren' })),
    ...deleteds.map(p => ({ path: p, state: 'del', driveFileId: manifest?.files?.[p]?.driveFileId })),
  ];

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter') {
        if (total > 0 && document.activeElement?.tagName !== 'BUTTON') {
          onConfirm();
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
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

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      if ((isMac && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'v') || (!isMac && e.altKey && e.key.toLowerCase() === 'v')) {
        e.preventDefault();
        setViewMode(prev => prev === 'list' ? 'grid' : 'list');
        setTempShowToggle(true);
        if (toggleTimerRef.current) clearTimeout(toggleTimerRef.current);
        toggleTimerRef.current = setTimeout(() => setTempShowToggle(false), 2000);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, onConfirm, total]);

  return (
    <div className="drive-picker-overlay" onClick={onCancel}>
      <div className="drive-picker" onClick={e => e.stopPropagation()}>
        
        <div className="terminal-omnibar">
          <div className="terminal-prompt">
            <span className="terminal-root">~</span>
            <span className="terminal-sep">/</span>
            <span className="terminal-dir">Sync Review</span>
            <span className="terminal-arrow">❯</span>
          </div>
          <div className={`drive-picker-view-toggle ${tempShowToggle ? 'show' : ''}`} style={{ marginLeft: 'auto' }}>
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

        <div className="drive-picker-body">
          {total === 0 ? (
            <div className="drive-picker-empty">Everything is up to date!</div>
          ) : viewMode === 'list' ? (
            <div className="sync-diff-list">
              {allItems.map((item) => (
                <div key={item.path} className="sync-diff-item">
                  <span className={`sync-diff-icon diff-${item.state}`}>
                    {item.state === 'new' ? '[+]' : item.state === 'mod' ? '[~]' : item.state === 'del' ? '[-]' : '[R]'}
                  </span>
                  <span className="drive-picker-name">
                    {item.state === 'ren' ? `${item.from} -> ${item.path}` : item.path}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="drive-picker-grid">
              {allItems.map(item => (
                <SyncGridItem key={item.path} item={item} cacheRoot={cacheRoot} />
              ))}
            </div>
          )}
        </div>

        <div className="drive-picker-footer">
          <div className="drive-picker-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
            {onChangeDataset && (
              <button className="btn-terminal action-change" onClick={onChangeDataset}>[ change folder ]</button>
            )}
            <button className="btn-terminal action-cancel" onClick={onCancel} autoFocus={total === 0}>[ cancel ]</button>
            <button className="btn-terminal action-push" disabled={total === 0} onClick={onConfirm} autoFocus={total > 0}>
              [ push ]
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
