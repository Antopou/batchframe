import React, { useState, useRef, useEffect, useCallback } from 'react';
import AIScanPanel from './AIScanPanel';
import PhotoshopIcon from './PhotoshopIcon';

function Dropdown({ value, onChange, options, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div className={`custom-dropdown${open ? ' open' : ''}${disabled ? ' disabled' : ''}`} ref={ref}>
      <button
        className="dropdown-trigger"
        onClick={() => !disabled && setOpen(v => !v)}
        type="button"
      >
        <span>{selected?.label ?? value}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="dropdown-panel">
          {options.map(opt => (
            <button
              key={opt.value}
              className={`dropdown-item${opt.value === value ? ' active' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              type="button"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IconBtn({ active, onClick, disabled, title, children }) {
  return (
    <button
      className={`icon-btn${active ? ' active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

function Controls({
  folderPath,
  folderLabel,
  driveLive,
  lastFolderPath,
  recentFolders,
  showRecentFolders,
  onFolderPathEdit,
  onRecentFolderClick,
  onSelectFolder,
  onOpenLastFolder,
  onDeleteSelected,
  showShortcuts,
  onToggleShortcuts,
  onKeepSelected,
  onSelectAll,
  onDeselectAll,
  selectedCount,
  totalCount,
  previewSize,
  onPreviewSizeChange,
  onPreviewPresetChange,
  imageFitMode,
  onImageFitModeChange,
  dragSelectEnabled,
  onDragSelectEnabledChange,
  confirmRequired,
  onConfirmRequiredChange,
  loading,
  browserMode,
  currentPage,
  totalPages,
  pageSize,
  onPageSizeChange,
  onPrevPage,
  onNextPage,
  showingCount,
  lockedCount,
  onLockSelected,
  onUnlockSelected,
  subfolderBarPinned,
  onToggleSubfolderBar,
  hasSubfolders,
  sortBy,
  onSortByChange,
  sortDir,
  onSortDirChange,
  orderSelectMode,
  onOrderSelectModeChange,
  orderedSelection,
  onRenameByOrder,
  photoshopPath,
  onSetPhotoshopPath,
  onOpenInPhotoshop,
  searchQuery,
  onSearchQueryChange,
  filteredCount,
  onMoveSelected,
  isMoving,
  onCopySelected,
  isCopying,
  onExportPaths,
  onInvertSelection,
  onSelectAllFiltered,
  aspectFilter,
  onAspectFilterChange,
  autoReloadEnabled,
  onAutoReloadChange,
  onBulkRename,
  onNavigateFolder,
  aiScores,
  scanning,
  scanProgress,
  scanStatus,
  onAIScan,
  onFindDuplicates,
  onFindSource,
  onCluster,
  onShuffle,
  onRemoveBackground,
  onRemoveSubtitles,
  activeAiAction,
  customOrderActive,
  onClearOrder,
  onClearAiScores,
  profilesVersion,
  onClearRefs,
  onUseSelectedAsRefs,
  activeCharacter,
  onSetActiveCharacter,
  driveSlot,
  viewMode,
  onViewModeChange,
  listDetail,
  onListDetailChange,
  driveLabels,
}) {
  const [editPath, setEditPath] = useState(folderPath || '');
  const [isEditing, setIsEditing] = useState(false);
  const [renamePrefix, setRenamePrefix] = useState('img_');
  const [renameDigits, setRenameDigits] = useState(3);
  const [showAIScan, setShowAIScan] = useState(false);
  const [showAIMenu, setShowAIMenu] = useState(false);
  // Keyboard-driven AI menu navigation. -1 = no keyboard focus.
  // Order matches the sub-buttons rendered below:
  // 0=Scan, 1=Dupes, 2=Source, 3=Cluster, 4=Remove BG, 5=Remove Subs, 6=Shuffle.
  const [aiKbFocus, setAiKbFocus] = useState(-1);
  const AI_ITEMS_COUNT = 7;
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);
  const aiMenuRef = useRef(null);

  useEffect(() => {
    if (!showAIMenu) return;
    const handleClickOutside = (e) => {
      if (aiMenuRef.current && !aiMenuRef.current.contains(e.target)) {
        setShowAIMenu(false);
        setAiKbFocus(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAIMenu]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.key === 'f' || e.key === 'F') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleBrowsePsPath = useCallback(async () => {
    if (!window.electronAPI?.selectFile) return;
    const isMac = window.electronAPI.platform === 'darwin';
    const p = await window.electronAPI.selectFile({
      filters: isMac
        ? [{ name: 'Applications', extensions: ['app'] }]
        : [{ name: 'Executables', extensions: ['exe'] }],
      title: isMac ? 'Select Photoshop.app' : 'Select Photoshop.exe',
    });
    if (p && onSetPhotoshopPath) onSetPhotoshopPath(p);
  }, [onSetPhotoshopPath]);

  const getReadableDrivePath = useCallback((path) => {
    if (!path || !path.startsWith('drive://') || !driveLabels) return path;
    const withoutPrefix = path.replace('drive://', '');
    const parts = withoutPrefix.split('/');
    let readablePath = '';
    let currentPath = 'drive:/';
    
    for (const part of parts) {
      if (!part) continue;
      currentPath += '/' + part;
      const label = driveLabels.get(currentPath);
      readablePath += (readablePath ? '/' : '') + (label || part);
    }
    return readablePath || path;
  }, [driveLabels]);

  useEffect(() => {
    if (!isEditing) {
      if (folderPath && folderPath.startsWith('drive://')) {
        setEditPath(getReadableDrivePath(folderPath));
      } else {
        setEditPath(folderPath || '');
      }
    }
  }, [folderPath, isEditing, getReadableDrivePath]);

  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const isA = e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey;

      // Shift+A → close the AI menu (and clear focus) and close scan panel.
      if (isA && e.shiftKey) {
        if (driveLive) return;
        e.preventDefault();
        e.stopPropagation();
        setShowAIMenu(false);
        setShowAIScan(false);
        setAiKbFocus(-1);
        return;
      }

      // A (no modifier) → open menu / advance keyboard focus through sub-items.
      if (isA) {
        if (driveLive) return;
        e.preventDefault();
        e.stopPropagation();
        if (!showAIMenu) {
          setShowAIMenu(true);
          setAiKbFocus(0);
        } else {
          setAiKbFocus((i) => (i + 1) % AI_ITEMS_COUNT);
        }
        return;
      }

      // Enter → activate the focused sub-item, or just close if nothing focused
      if (e.key === 'Enter' && showAIMenu && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (aiKbFocus >= 0) {
          if (loading || totalCount === 0) return;
          setShowAIMenu(false);
          switch (aiKbFocus) {
            case 0: setShowAIScan((v) => !v); break;
            case 1: setShowAIScan(false); onFindDuplicates?.(); break;
            case 2: setShowAIScan(false); onFindSource?.(); break;
            case 3: setShowAIScan(false); onCluster?.(); break;
            case 4: if (selectedCount > 0) { setShowAIScan(false); onRemoveBackground?.(); } break;
            case 5: if (selectedCount > 0) { setShowAIScan(false); onRemoveSubtitles?.(); } break;
            case 6: setShowAIScan(false); onShuffle?.(); break;
            default: break;
          }
        } else {
          setShowAIMenu(false);
        }
        return;
      }

      // Escape closes the AI menu if it's open (and focus is engaged).
      if (e.key === 'Escape' && showAIMenu) {
        e.preventDefault();
        e.stopPropagation();
        setShowAIMenu(false);
        setAiKbFocus(-1);
        return;
      }

      if (e.key.toLowerCase() === 'e' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setIsEditing(true);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [driveLive, showAIMenu, aiKbFocus, loading, totalCount, selectedCount, onFindDuplicates, onFindSource, onCluster, onShuffle, onRemoveBackground, onRemoveSubtitles]);

  useEffect(() => {
    if (activeAiAction && activeAiAction !== 'scan') {
      setShowAIScan(false);
    }
  }, [activeAiAction]);

  const handlePathSubmit = async () => {
    const trimmed = editPath.trim();
    if (trimmed) {
      if (trimmed === getReadableDrivePath(folderPath) || trimmed === driveLabels?.get(folderPath) || trimmed === folderPath) {
        setIsEditing(false);
        return;
      }

      let resolvedPath = trimmed;
      if (!trimmed.startsWith('drive://') && !trimmed.match(/^[a-zA-Z]:\\/)) {
        for (const id of (driveLabels?.keys() || [])) {
          if (driveLabels.get(id) === trimmed || getReadableDrivePath(id) === trimmed) {
            resolvedPath = id;
            break;
          }
        }
      }

      onFolderPathEdit(resolvedPath);
    }
    setIsEditing(false);
  };

  const handlePathKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
      handlePathSubmit();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setIsEditing(false);
    }
  };

  const handlePathFocus = () => {
    setIsEditing(true);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsEditing(false);
      }
    };

    if (isEditing) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isEditing]);

  const folderName = folderLabel || (folderPath ? folderPath.replace(/\\/g, '/').split('/').pop() : '');
  const hasNumericSuffix = !driveLive && /\d+$/.test(folderName);

  return (
    <div className="controls-modern">
      {/* ── Section 1: Folder & Selection ── */}
      <div className="controls-section main-actions">
        <div className="button-group">
          <button onClick={onSelectFolder} className="btn-modern primary" disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /></svg>
            Open
          </button>
          {!browserMode && lastFolderPath && (
            <button onClick={onOpenLastFolder} className="btn-modern secondary icon-only" disabled={loading} title={lastFolderPath}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
            </button>
          )}
          {!browserMode && driveSlot}
          {!browserMode && hasNumericSuffix && (
            <>
              <button
                onClick={() => onNavigateFolder(-1)}
                className="btn-modern secondary icon-only"
                disabled={loading}
                title="Previous folder (−1)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
              </button>
              <button
                onClick={() => onNavigateFolder(1)}
                className="btn-modern secondary icon-only"
                disabled={loading}
                title="Next folder (+1)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            </>
          )}
        </div>

        {folderPath && (
          <div className="folder-breadcrumb" ref={dropdownRef}>
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editPath}
                onChange={(e) => setEditPath(e.target.value)}
                onKeyDown={handlePathKeyDown}
                onBlur={handlePathSubmit}
                className="folder-path-input-modern"
                placeholder="Enter folder path..."
                autoFocus
              />
            ) : (
              <div className="path-display" onClick={handlePathFocus} title="Click to edit path">
                <span className="path-text">
                  {folderPath.startsWith('drive://')
                    ? getReadableDrivePath(folderPath)
                    : folderLabel
                      ? folderLabel
                      : folderPath.length > 40 ? '…' + folderPath.slice(-37) : folderPath}
                </span>
              </div>
            )}
            {isEditing && recentFolders && recentFolders.length > 0 && (
              <div className="recent-folders-popover">
                <div className="popover-header">Recent Folders</div>
                <div className="popover-content">
                  {recentFolders.slice(0, 8).map((folder, index) => {
                    const readable = folder.startsWith('drive://') ? getReadableDrivePath(folder) : null;
                    const displayText = readable ? `📁 ${readable}` : (folder.length > 50 ? '…' + folder.slice(-47) : folder);
                    return (
                      <div
                        key={index}
                        className="recent-item"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setEditPath(readable || folder);
                          onFolderPathEdit(folder);
                          setIsEditing(false);
                        }}
                        title={folder}
                      >
                        {displayText}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="search-box">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery || ''}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                e.target.blur();
              } else if (e.key === 'Enter') {
                e.stopPropagation();
              }
            }}
            placeholder="Search by name…"
            className="search-input"
            disabled={loading || totalCount === 0}
          />
          {searchQuery && (
            <button onClick={() => onSearchQueryChange('')} className="search-clear" title="Clear">×</button>
          )}
          {searchQuery && filteredCount > 0 && (
            <button onClick={onSelectAllFiltered} className="search-select-btn" title={`Select all ${filteredCount} matches`}>
              {filteredCount}
            </button>
          )}
        </div>

        <div className="selection-stats">
          <div className="button-group mini">
            {selectedCount > 0 && !browserMode && (
              <button onClick={onExportPaths} className="icon-btn-modern sm" disabled={loading} title={`Export ${selectedCount} paths to .txt`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 2: Image Actions ── */}
      <div className="controls-section image-actions">
        {/* Sort & aspect filter controls */}
        <div className="button-group">
          <Dropdown
            value={sortBy}
            onChange={onSortByChange}
            disabled={loading || totalCount === 0}
            options={[
              { value: 'none', label: 'Unsorted' },
              { value: 'name', label: 'Name' },
              { value: 'date', label: 'Date' },
              { value: 'size', label: 'Size' },
            ]}
          />
          <button
            className="icon-btn-modern"
            onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
            title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            disabled={loading || totalCount === 0 || sortBy === 'none'}
          >
            {sortDir === 'asc' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8 4-4 4 4" /><path d="M7 4v16" /><path d="M11 12h4" /><path d="M11 16h7" /><path d="M11 20h10" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 16 4 4 4-4" /><path d="M7 20V4" /><path d="M11 4h10" /><path d="M11 8h7" /><path d="M11 12h4" /></svg>
            )}
          </button>
          <Dropdown
            value={aspectFilter}
            onChange={onAspectFilterChange}
            disabled={loading || totalCount === 0}
            options={[
              { value: 'all', label: 'All ratios' },
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' },
              { value: 'square', label: 'Square' },
            ]}
          />
        </div>

        <div className="divider-v" />

        {/* Order-select mode */}
        <div className="button-group">
          <button
            className={`icon-btn-modern${orderSelectMode ? ' active' : ''}`}
            onClick={() => onOrderSelectModeChange(!orderSelectMode)}
            title={orderSelectMode ? 'Exit Order Select mode (O)' : 'Order Select: click images in sequence to assign rename order (O)'}
            disabled={loading || totalCount === 0}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5" /><path d="M4 20 21 3" /><path d="M21 16v5h-5" /><path d="M15 15 21 21" /><path d="M4 4l5 5" /></svg>
          </button>
          {orderSelectMode && orderedSelection.length > 0 && (
            <div className="locked-badge" title={`${orderedSelection.length} image${orderedSelection.length !== 1 ? 's' : ''} in order`}>
              {orderedSelection.length}
            </div>
          )}
        </div>

        <div className="divider-v" />

        <div className="button-group">
          <button
            onClick={onLockSelected}
            className={`btn-modern secondary sm ${selectedCount === 0 ? 'disabled' : ''}`}
            disabled={loading || selectedCount === 0}
            title="Lock selected (L)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            Lock
          </button>
          <button
            onClick={onUnlockSelected}
            className={`btn-modern secondary sm ${selectedCount === 0 ? 'disabled' : ''}`}
            disabled={loading || selectedCount === 0}
            title="Unlock selected (Shift+L)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></svg>
            Unlock
          </button>
        </div>
        {lockedCount > 0 && (
          <div className="locked-badge" title={`${lockedCount} locked image${lockedCount !== 1 ? 's' : ''} will be preserved during deletion`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            {lockedCount}
          </div>
        )}

        <div className="divider-v" />

        <div className="button-group">
          <button
            onClick={onDeleteSelected}
            className="action-btn del"
            disabled={loading || selectedCount === 0 || browserMode}
            title="Delete selected (Del)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></svg>
            Del
          </button>
          <button
            onClick={onKeepSelected}
            className="action-btn keep"
            disabled={loading || selectedCount === 0 || browserMode}
            title="Keep selected, delete others (Shift+Del)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            Keep
          </button>
          {!browserMode && (
            <button
              onClick={onCopySelected}
              className="action-btn copy"
              disabled={loading || selectedCount === 0 || isCopying}
              title="Copy selected to another folder (C)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              Copy
            </button>
          )}
          {!browserMode && (
            <button
              onClick={onMoveSelected}
              className="action-btn move"
              disabled={loading || selectedCount === 0 || isMoving}
              title="Move selected to another folder (M)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M8 13h6" /><path d="m11 10 3 3-3 3" /></svg>
              Move
            </button>
          )}
          {!browserMode && (
            <button
              onClick={onBulkRename}
              className="action-btn rename"
              disabled={loading || selectedCount === 0}
              title="Bulk rename selected images (R)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
              </svg>
              Rename
            </button>
          )}
          {!browserMode && !driveLive && (
            <div style={{ position: 'relative' }} ref={aiMenuRef}>
              <button
                className={`action-btn${showAIMenu ? ' active' : ''}`}
                onClick={() => setShowAIMenu(v => !v)}
                title="AI tools"
                disabled={loading || totalCount === 0}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></svg>
                AI
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4, transform: showAIMenu ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}><polyline points="6 9 12 15 18 9" /></svg>
              </button>

              {showAIMenu && (
                <div 
                  className="dropdown-menu"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: 6,
                    padding: '6px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    minWidth: 140,
                    background: '#222',
                    border: '1px solid #333',
                    borderRadius: 8,
                    zIndex: 100,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                  }}
                >
                  <button
                    className={`action-btn ai-sub${showAIScan ? ' active' : ''}${activeAiAction === 'scan' ? ' ai-busy' : ''}${aiKbFocus === 0 ? ' kb-focused' : ''}`}
                    onClick={() => { setShowAIScan(v => !v); setShowAIMenu(false); }}
                    title="AI character scan (A)"
                    disabled={loading || totalCount === 0}
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a7 7 0 0 1 14 0v1" /></svg>
                    Scan
                  </button>
                  <button
                    className={`action-btn ai-sub${activeAiAction === 'dupes' ? ' ai-busy' : ''}${aiKbFocus === 1 ? ' kb-focused' : ''}`}
                    onClick={() => { setShowAIScan(false); onFindDuplicates(); setShowAIMenu(false); }}
                    title="Find duplicate images"
                    disabled={loading || totalCount === 0}
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Dupes
                  </button>
                  <button
                    className={`action-btn ai-sub${activeAiAction === 'source' ? ' ai-busy' : ''}${aiKbFocus === 2 ? ' kb-focused' : ''}`}
                    onClick={() => { setShowAIScan(false); onFindSource(); setShowAIMenu(false); }}
                    title="Find raws with no matching edit — selects them for deletion"
                    disabled={loading || totalCount === 0}
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" /><path d="M8 11h6" /></svg>
                    Source
                  </button>
                  <button
                    className={`action-btn ai-sub${activeAiAction === 'cluster' ? ' ai-busy' : ''}${aiKbFocus === 3 ? ' kb-focused' : ''}`}
                    onClick={() => { setShowAIScan(false); onCluster(); setShowAIMenu(false); }}
                    title="Group by visual similarity (CLIP + KMeans) — reorders the grid"
                    disabled={loading || totalCount === 0}
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="6"  cy="6"  r="2.5" /><circle cx="18" cy="6"  r="2.5" /><circle cx="6"  cy="18" r="2.5" /><circle cx="18" cy="18" r="2.5" /><circle cx="12" cy="12" r="2.5" /></svg>
                    Cluster
                  </button>
                  <button
                    className={`action-btn ai-sub${aiKbFocus === 4 ? ' kb-focused' : ''}`}
                    onClick={() => { setShowAIScan(false); onRemoveBackground(); setShowAIMenu(false); }}
                    title="Cut the character out onto transparency — works on the selection"
                    disabled={loading || selectedCount === 0}
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12a8 8 0 1 0-8 8" /><path d="M12 4v16" /><path d="M4 12h8" /><path d="m16 16 5 5" /><path d="m21 16-5 5" /></svg>
                    Remove BG
                  </button>
                  <button
                    className={`action-btn ai-sub${aiKbFocus === 5 ? ' kb-focused' : ''}`}
                    onClick={() => { setShowAIScan(false); onRemoveSubtitles(); setShowAIMenu(false); }}
                    title="Paint out hardcoded subtitles — works on the selection"
                    disabled={loading || selectedCount === 0}
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 15h5" /><path d="M14 15h4" /></svg>
                    Remove Subs
                  </button>
                  <button
                    className={`action-btn ai-sub${aiKbFocus === 6 ? ' kb-focused' : ''}`}
                    onClick={() => { setShowAIScan(false); onShuffle(); setShowAIMenu(false); }}
                    title="Randomize order to remove first-image bias"
                    disabled={loading || totalCount === 0}
                    style={{ width: '100%', justifyContent: 'flex-start' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5" /><path d="M4 20 21 3" /><path d="M21 16v5h-5" /><path d="m15 15 6 6" /><path d="M4 4l5 5" /></svg>
                    Shuffle
                  </button>
                  {customOrderActive && (
                    <button
                      className="action-btn ai-sub"
                      onClick={() => { setShowAIScan(false); onClearOrder(); setShowAIMenu(false); }}
                      title="Restore normal sort order"
                      style={{ width: '100%', justifyContent: 'flex-start' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M3 12h12" /><path d="M3 18h6" /></svg>
                      Reset
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {!browserMode && !driveLive && (
            <button
              onClick={onUseSelectedAsRefs}
              className="action-btn ref"
              disabled={loading || selectedCount === 0 || !activeCharacter}
              title={
                activeCharacter
                  ? `Use ${selectedCount || 'selected'} as reference (F) → ${activeCharacter}`
                  : 'Set a character first to use as reference (F)'
              }
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>
              Ref
            </button>
          )}
          {!browserMode && !driveLive && (
            photoshopPath ? (
              <button
                onClick={onOpenInPhotoshop}
                className="action-btn ps"
                disabled={loading || selectedCount === 0}
                title={`Open in Photoshop (P): ${photoshopPath}`}
              >
                <PhotoshopIcon size={14} />
                Photoshop
              </button>
            ) : (
              <button
                onClick={handleBrowsePsPath}
                className="action-btn ps"
                disabled={loading || totalCount === 0}
                title="Locate Photoshop"
              >
                <PhotoshopIcon size={14} />
                Photoshop
              </button>
            )
          )}
        </div>
      </div>

      {/* ── Order-select rename panel ── */}
      {totalCount > 0 && orderSelectMode && orderedSelection.length > 0 && (
        <div className="controls-section image-actions">
          <div className="button-group">
            <input
              type="text"
              value={renamePrefix}
              onChange={(e) => setRenamePrefix(e.target.value)}
              className="rename-input"
              placeholder="prefix"
              title="Filename prefix"
              style={{ width: '80px' }}
            />
            <input
              type="number"
              value={renameDigits}
              onChange={(e) => setRenameDigits(Math.max(1, Math.min(9, Number(e.target.value))))}
              className="rename-input"
              min="1"
              max="9"
              title="Number of digits (zero-padding)"
              style={{ width: '44px' }}
            />
            <span className="rename-preview" title="Preview of first and last filename">
              {renamePrefix}{String(1).padStart(renameDigits, '0')}
              {orderedSelection.length > 1 && ` … ${renamePrefix}${String(orderedSelection.length).padStart(renameDigits, '0')}`}
            </span>
          </div>
          <div className="button-group">
            <button
              onClick={() => onRenameByOrder(renamePrefix, renameDigits)}
              className="btn-modern success sm"
              disabled={loading || !renamePrefix}
              title="Rename files by order sequence"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              Rename
            </button>
            <button
              onClick={() => onOrderSelectModeChange(false)}
              className="btn-modern ghost sm"
              disabled={loading}
              title="Clear order selection"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ── AI Scan Panel ── */}
      {totalCount > 0 && !browserMode && !driveLive && showAIScan && (
        <div className="controls-section">
          <AIScanPanel
            totalCount={totalCount}
            aiScores={aiScores || {}}
            scanning={scanning}
            scanProgress={scanProgress}
            scanStatus={scanStatus}
            onScan={onAIScan}
            onClearScores={onClearAiScores}
            profilesVersion={profilesVersion}
            onClearRefs={onClearRefs}
            activeCharacter={activeCharacter}
            onSetActiveCharacter={onSetActiveCharacter}
          />
        </div>
      )}

      {/* ── Section 3: View & Pagination ── */}
      <div className="controls-section view-settings">
        <div className="view-config">
          <div className="slider-container">
            <input
              id="preview-size"
              type="range"
              min="80"
              max="300"
              value={previewSize}
              onChange={(e) => onPreviewSizeChange(Number(e.target.value))}
              disabled={loading || totalCount === 0}
            />
          </div>
          <div className="segmented-control">
            {['S', 'M', 'L', 'XL'].map((label, idx) => {
              const vals = [120, 170, 230, 280];
              return (
                <button
                  key={label}
                  className={`segment-btn ${previewSize === vals[idx] ? 'active' : ''}`}
                  onClick={() => onPreviewPresetChange(vals[idx])}
                  disabled={loading || totalCount === 0}
                  title={`Size: ${label} (${idx + 1})`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="divider-v" />

        <div className="mode-toggles">
          <div className="segmented-control">
            <button
              className={`segment-btn ${viewMode === 'explorer' ? 'active' : ''}`}
              onClick={() => onViewModeChange && onViewModeChange('explorer')}
              title="Explorer view — folders + images (V)"
              disabled={loading || totalCount === 0}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /></svg>
            </button>
            <button
              className={`segment-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => onViewModeChange && onViewModeChange('grid')}
              title="Grid view (V)"
              disabled={loading || totalCount === 0}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /></svg>
            </button>
            <button
              className={`segment-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => onViewModeChange && onViewModeChange('list')}
              title="List view (V)"
              disabled={loading || totalCount === 0}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
            </button>
          </div>
          {viewMode === 'list' ? (
            <div className="segmented-control">
              <button
                className={`segment-btn ${listDetail === 'plain' ? 'active' : ''}`}
                onClick={() => onListDetailChange && onListDetailChange('plain')}
                title="List, names only (T)"
                disabled={loading || totalCount === 0}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></svg>
              </button>
              <button
                className={`segment-btn ${listDetail === 'thumb' ? 'active' : ''}`}
                onClick={() => onListDetailChange && onListDetailChange('thumb')}
                title="List with thumbnail (T)"
                disabled={loading || totalCount === 0}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="6" height="6" rx="1" /><line x1="12" y1="6" x2="21" y2="6" /><line x1="12" y1="9" x2="18" y2="9" /><rect x="3" y="14" width="6" height="6" rx="1" /><line x1="12" y1="16" x2="21" y2="16" /><line x1="12" y1="19" x2="18" y2="19" /></svg>
              </button>
            </div>
          ) : (
            <div className="segmented-control">
              <button
                className={`segment-btn ${imageFitMode === 'contain' ? 'active' : ''}`}
                onClick={() => onImageFitModeChange('contain')}
                title="Contain (T)"
                disabled={loading || totalCount === 0}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
              </button>
              <button
                className={`segment-btn ${imageFitMode === 'cover' ? 'active' : ''}`}
                onClick={() => onImageFitModeChange('cover')}
                title="Cover (T)"
                disabled={loading || totalCount === 0}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="m3 3 18 18" /><path d="m21 3-18 18" /></svg>
              </button>
            </div>
          )}
          <button
            className={`icon-btn-modern ${dragSelectEnabled ? 'active' : ''}`}
            onClick={() => onDragSelectEnabledChange(!dragSelectEnabled)}
            title="Drag Select (D)"
            disabled={loading || totalCount === 0}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9" /><path d="M12 2v8" /><path d="M12 10 9 7" /><path d="m12 10 3-3" /><path d="M18 21v-8a2 2 0 0 0-2-2h-4" /></svg>
          </button>
          {!browserMode && (
            <button
              className={`icon-btn-modern ${autoReloadEnabled ? 'active' : ''}`}
              onClick={() => onAutoReloadChange(!autoReloadEnabled)}
              title={autoReloadEnabled ? 'Auto-Reload: ON (Q)' : 'Auto-Reload: OFF (Q)'}
              disabled={loading || totalCount === 0}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
            </button>
          )}
          <button
            className={`icon-btn-modern ${!confirmRequired ? 'warning' : ''}`}
            onClick={() => onConfirmRequiredChange(!confirmRequired)}
            title={confirmRequired ? 'Confirm: ON (N)' : 'Confirm: OFF (N)'}
            disabled={loading || totalCount === 0}
          >
            {confirmRequired ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0" /><path d="M18.63 13A17.89 17.89 0 0 1 18 8" /><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" /><path d="M18 8a6 6 0 0 0-9.33-5" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
            )}
          </button>

          <div className="divider-v" style={{ height: '16px', margin: '0 4px' }} />
          <button onClick={onSelectAll} className="icon-btn-modern" disabled={loading || totalCount === 0} title="Select All (Ctrl/Cmd+A)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </button>
          <button onClick={onDeselectAll} className="icon-btn-modern" disabled={loading || totalCount === 0} title="Deselect All (Esc)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" />
            </svg>
          </button>
          <button onClick={onInvertSelection} className="icon-btn-modern" disabled={loading || totalCount === 0} title="Invert selection (I)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" />
            </svg>
          </button>
        </div>

        <div className="divider-v" />

        <div className="pagination-modern">
          <div className={`stat-badge-modern ${selectedCount > 0 ? 'active' : ''}`} title={selectedCount > 0 ? `${selectedCount} selected / ${totalCount} total` : `${totalCount} total items`}>
            {selectedCount > 0 && (
              <>
                <span className="count">{selectedCount}</span>
                <span className="sep">/</span>
              </>
            )}
            {searchQuery && (
              <>
                <span className="filtered" title="Filtered">{filteredCount}</span>
                <span className="sep">/</span>
              </>
            )}
            <span className="total">{totalCount} {selectedCount === 0 ? 'items' : ''}</span>
          </div>
          <Dropdown
            value={pageSize}
            onChange={onPageSizeChange}
            disabled={loading || totalCount === 0}
            options={[
              { value: 100, label: '100' },
              { value: 200, label: '200' },
              { value: 300, label: '300' },
              { value: 500, label: '500' },
              { value: 1000, label: '1000' },
              { value: 99999, label: 'All' },
            ]}
          />
          <div className="nav-group">
            <button onClick={onPrevPage} disabled={loading || totalCount === 0 || currentPage <= 1} className="nav-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <span className="page-info">{currentPage}<span className="of">/</span>{totalPages}</span>
            <button onClick={onNextPage} disabled={loading || totalCount === 0 || currentPage >= totalPages} className="nav-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>
          <button
            className={`help-btn-modern ${showShortcuts ? 'active' : ''}`}
            onClick={onToggleShortcuts}
            title="Keyboard shortcuts"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" x2="12.01" y1="17" y2="17" /></svg>
          </button>
          {hasSubfolders && (
            <button
              className={`help-btn-modern ${!subfolderBarPinned ? 'active' : ''}`}
              onClick={onToggleSubfolderBar}
              title={subfolderBarPinned ? 'Unpin subfolder bar' : 'Pin subfolder bar'}
            >
              {subfolderBarPinned ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 17v5" /><path d="M15 9.34V6h1a2 2 0 0 0 0-4H7.89" /><path d="m2 2 20 20" /><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h9.8" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="17" x2="12" y2="22" />
                  <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 1 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default Controls;
