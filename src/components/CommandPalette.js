import React, { useEffect, useMemo, useRef, useState } from 'react';
import './CommandPalette.css';

// Wraps the query substring in a highlight span. Case-insensitive, first match only.
function highlight(text, query) {
  if (!text) return null;
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'rgba(255, 204, 102, 0.22)', color: '#ffe0a3', padding: '0 1px', borderRadius: '2px' }}>
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function basename(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

function pathSegments(p) {
  if (!p) return [];
  return p.split(/[\\/]/).filter(Boolean);
}

function CommandPalette({
  isOpen,
  onClose,
  query,
  setQuery,
  actions,
  currentPath,
  lastFolderPath,
  subfolders = [],
  parentFolderPath,
  recentFolders = [],
  onNavigateToFolder,
  onNavigateUp,
  onBrowseFolder,
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Path shown in the omnibar. Prefer currentPath; fall back to lastFolderPath for cold-start hint.
  const headerPath = currentPath || lastFolderPath || '';
  const headerSegments = useMemo(() => pathSegments(headerPath), [headerPath]);

  const q = query.trim().toLowerCase();

  const folderItems = useMemo(() => {
    const items = [];
    if (parentFolderPath) {
      items.push({ kind: 'parent', id: '__parent__', name: '..', path: parentFolderPath, subtitle: parentFolderPath });
    }
    for (const f of subfolders) {
      items.push({ kind: 'folder', id: `folder:${f.path}`, name: f.name, path: f.path, subtitle: f.path });
    }
    return items;
  }, [subfolders, parentFolderPath]);

  const recentItems = useMemo(() => {
    return recentFolders
      .filter((p) => p && p !== currentPath)
      .map((p) => ({ kind: 'recent', id: `recent:${p}`, name: basename(p), path: p, subtitle: p }));
  }, [recentFolders, currentPath]);

  const filteredFolders = useMemo(
    () => (q ? folderItems.filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) : folderItems),
    [folderItems, q]
  );
  const filteredRecents = useMemo(
    () => (q ? recentItems.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)) : recentItems),
    [recentItems, q]
  );
  const filteredActions = useMemo(() => {
    if (!q) return actions;
    return actions.filter((action) => (
      action.name.toLowerCase().includes(q) ||
      (action.subtitle && action.subtitle.toLowerCase().includes(q)) ||
      (action.keywords && action.keywords.some((k) => k.toLowerCase().includes(q)))
    ));
  }, [actions, q]);

  // Optional "browse for folder..." action at cold start when there's no current folder.
  const showBrowseAction = !currentPath && !!onBrowseFolder;

  const flatItems = useMemo(() => {
    const arr = [];
    filteredFolders.forEach((f) => arr.push({ kind: f.kind, item: f }));
    filteredRecents.forEach((r) => arr.push({ kind: 'recent', item: r }));
    if (showBrowseAction) {
      arr.push({
        kind: 'action',
        item: {
          id: 'browse-folder',
          name: 'cd ...',
          subtitle: 'Browse your computer for a folder',
          onExecute: onBrowseFolder,
        },
      });
    }
    filteredActions.forEach((a) => arr.push({ kind: 'action', item: a }));
    return arr;
  }, [filteredFolders, filteredRecents, filteredActions, showBrowseAction, onBrowseFolder]);

  // Reset selection when query or item set changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, flatItems.length]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Backspace' && !query && parentFolderPath && onNavigateUp) {
        e.preventDefault();
        onNavigateUp();
        return;
      }
      if (e.key === 'Tab') {
        if (filteredFolders.length > 0) {
          e.preventDefault();
          const target = flatItems[selectedIndex]?.kind === 'folder' || flatItems[selectedIndex]?.kind === 'parent'
            ? flatItems[selectedIndex].item
            : filteredFolders[0];
          if (target?.name && target.kind !== 'parent') setQuery(target.name);
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const entry = flatItems[selectedIndex];
        if (!entry) { onClose(); return; }
        if (entry.kind === 'folder' || entry.kind === 'parent' || entry.kind === 'recent') {
          if (onNavigateToFolder) onNavigateToFolder(entry.item.path);
          setQuery('');
          // Palette stays open so the user can keep browsing.
          return;
        }
        entry.item.onExecute?.();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, flatItems, selectedIndex, onClose, query, parentFolderPath, onNavigateUp, onNavigateToFolder, filteredFolders, setQuery]);

  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector('.cmd-palette-item.selected');
      if (selectedEl) selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 10);
  }, [isOpen]);

  if (!isOpen) return null;

  const runEntry = (entry) => {
    if (entry.kind === 'folder' || entry.kind === 'parent' || entry.kind === 'recent') {
      if (onNavigateToFolder) onNavigateToFolder(entry.item.path);
      setQuery('');
      return;
    }
    entry.item.onExecute?.();
    onClose();
  };

  let runningIndex = 0;
  const renderSection = (title, entries) => {
    if (entries.length === 0) return null;
    return (
      <>
        <div className="cmd-palette-section-title">{title}</div>
        {entries.map((entry) => {
          const idx = runningIndex++;
          const item = entry.item;
          const isFolderKind = entry.kind === 'folder' || entry.kind === 'parent' || entry.kind === 'recent';
          return (
            <div
              key={item.id}
              className={`cmd-palette-item ${idx === selectedIndex ? 'selected' : ''}`}
              onMouseMove={() => setSelectedIndex(idx)}
              onClick={() => runEntry(entry)}
            >
              {isFolderKind && (
                <div className="cmd-palette-item-icon">
                  {entry.kind === 'parent' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12h18"/><path d="M9 6l-6 6 6 6"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                    </svg>
                  )}
                </div>
              )}
              <div className="cmd-palette-item-content">
                <div className="cmd-palette-item-title">{highlight(item.name, query)}</div>
                {item.subtitle && <div className="cmd-palette-item-subtitle">{highlight(item.subtitle, query)}</div>}
              </div>
              {item.shortcut && (
                <div className="cmd-palette-item-shortcut">
                  {item.shortcut.map((key, i) => <kbd key={i}>{key}</kbd>)}
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  const folderEntries = flatItems.filter((e) => e.kind === 'folder' || e.kind === 'parent');
  const recentEntries = flatItems.filter((e) => e.kind === 'recent');
  const actionEntries = flatItems.filter((e) => e.kind === 'action');

  return (
    <div className="cmd-palette-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmd-palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmd-palette-header cmd-palette-omnibar">
          <div className="cmd-palette-prompt-path">
            <span className="terminal-root">~</span>
            {headerSegments.length > 2 && (
              <>
                <span className="terminal-sep">/</span>
                <span className="terminal-dir">...</span>
              </>
            )}
            {headerSegments.slice(-2).map((seg, i) => (
              <React.Fragment key={`${seg}-${i}`}>
                <span className="terminal-sep">/</span>
                <span className="terminal-dir" title={seg}>{seg}</span>
              </React.Fragment>
            ))}
            <span className="terminal-arrow">❯</span>
          </div>
          <input
            ref={inputRef}
            className="cmd-palette-input"
            placeholder={currentPath ? 'search folders or commands…' : 'enter command or cd…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="cmd-palette-body" ref={listRef}>
          {flatItems.length > 0 ? (
            <>
              {renderSection('Folders', folderEntries)}
              {renderSection('Recent', recentEntries)}
              {renderSection('Commands', actionEntries)}
            </>
          ) : (
            <div className="cmd-palette-empty">
              No matches. Searching images for "{query}"...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
