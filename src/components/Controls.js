import React, { useState, useRef, useEffect, useCallback } from 'react';

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
          <path d="m6 9 6 6 6-6"/>
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
}) {
  const [editPath, setEditPath] = useState(folderPath || '');
  const [isEditing, setIsEditing] = useState(false);
  const [renamePrefix, setRenamePrefix] = useState('img_');
  const [renameDigits, setRenameDigits] = useState(3);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  const handleBrowsePsPath = useCallback(async () => {
    if (!window.electronAPI?.selectFile) return;
    const p = await window.electronAPI.selectFile({
      filters: [{ name: 'Executables', extensions: ['exe'] }],
      title: 'Select Photoshop.exe',
    });
    if (p && onSetPhotoshopPath) onSetPhotoshopPath(p);
  }, [onSetPhotoshopPath]);

  useEffect(() => {
    setEditPath(folderPath || '');
  }, [folderPath]);

  const handlePathSubmit = () => {
    if (editPath.trim() && editPath !== folderPath) {
      onFolderPathEdit(editPath.trim());
    }
    setIsEditing(false);
  };

  const handlePathKeyDown = (e) => {
    if (e.key === 'Enter') {
      handlePathSubmit();
    } else if (e.key === 'Escape') {
      setEditPath(folderPath || '');
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

  return (
    <div className="controls-modern">
      {/* ── Section 1: Folder & Selection ── */}
      <div className="controls-section main-actions">
        <div className="button-group">
          <button onClick={onSelectFolder} className="btn-modern primary" disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
            Open
          </button>
          {!browserMode && lastFolderPath && (
            <button onClick={onOpenLastFolder} className="btn-modern secondary icon-only" disabled={loading} title={lastFolderPath}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </button>
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
                  {folderPath.length > 40 ? '…' + folderPath.slice(-37) : folderPath}
                </span>
              </div>
            )}
            {isEditing && recentFolders && recentFolders.length > 0 && (
              <div className="recent-folders-popover">
                <div className="popover-header">Recent Folders</div>
                <div className="popover-content">
                  {recentFolders.slice(0, 8).map((folder, index) => (
                    <div
                      key={index}
                      className="recent-item"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditPath(folder);
                        onFolderPathEdit(folder);
                        setIsEditing(false);
                      }}
                      title={folder}
                    >
                      {folder.length > 50 ? '…' + folder.slice(-47) : folder}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {totalCount > 0 && (
          <div className="search-box">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <input
              type="text"
              value={searchQuery || ''}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Search by name…"
              className="search-input"
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
        )}

        {totalCount > 0 && (
          <div className="selection-stats">
            <div className="stat-badge">
              <span className="count">{selectedCount}</span>
              <span className="sep">/</span>
              {searchQuery && (
                <>
                  <span className="filtered" title="Filtered">{filteredCount}</span>
                  <span className="sep">/</span>
                </>
              )}
              <span className="total">{totalCount}</span>
            </div>
            <div className="button-group mini">
              <button onClick={onSelectAll} className="btn-modern ghost sm" disabled={loading} title="Select All (current page)">All</button>
              <button onClick={onDeselectAll} className="btn-modern ghost sm" disabled={loading} title="Deselect All">None</button>
              <button onClick={onInvertSelection} className="btn-modern ghost sm" disabled={loading} title="Invert selection">Inv</button>
              {selectedCount > 0 && !browserMode && (
                <button onClick={onExportPaths} className="icon-btn-modern" disabled={loading} title={`Export ${selectedCount} paths to .txt`}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Section 2: Image Actions ── */}
      {totalCount > 0 && (
        <div className="controls-section image-actions">
          {/* Sort & aspect filter controls */}
          <div className="button-group">
            <Dropdown
              value={sortBy}
              onChange={onSortByChange}
              disabled={loading}
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
              disabled={loading || sortBy === 'none'}
            >
              {sortDir === 'asc' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M11 12h4"/><path d="M11 16h7"/><path d="M11 20h10"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/></svg>
              )}
            </button>
            <Dropdown
              value={aspectFilter}
              onChange={onAspectFilterChange}
              disabled={loading}
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
              title={orderSelectMode ? 'Exit Order Select mode' : 'Order Select: click images in sequence to assign rename order'}
              disabled={loading}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15 21 21"/><path d="M4 4l5 5"/></svg>
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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Lock
            </button>
            <button
              onClick={onUnlockSelected}
              className={`btn-modern secondary sm ${selectedCount === 0 ? 'disabled' : ''}`}
              disabled={loading || selectedCount === 0}
              title="Unlock selected (Shift+L)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
              Unlock
            </button>
          </div>
          {lockedCount > 0 && (
            <div className="locked-badge" title={`${lockedCount} locked image${lockedCount !== 1 ? 's' : ''} will be preserved during deletion`}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              {lockedCount}
            </div>
          )}

          <div className="divider-v" />

          <div className="button-group">
            <button
              onClick={onDeleteSelected}
              className="action-btn del"
              disabled={loading || selectedCount === 0 || browserMode}
              title="Delete selected"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
              Del
            </button>
            <button
              onClick={onKeepSelected}
              className="action-btn keep"
              disabled={loading || selectedCount === 0 || browserMode}
              title="Keep selected, delete others"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              Keep
            </button>
            {!browserMode && (
              <button
                onClick={onCopySelected}
                className="action-btn copy"
                disabled={loading || selectedCount === 0 || isCopying}
                title="Copy selected to another folder"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                </svg>
                Copy
              </button>
            )}
            {!browserMode && (
              <button
                onClick={onMoveSelected}
                className="action-btn move"
                disabled={loading || selectedCount === 0 || isMoving}
                title="Move selected to another folder"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h20"/><path d="M19 9l3 3-3 3"/><path d="M5 9l-3 3 3 3"/></svg>
                Move
              </button>
            )}
            {!browserMode && (
              <button
                onClick={onBulkRename}
                className="action-btn rename"
                disabled={loading || selectedCount === 0}
                title="Bulk rename selected images"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                </svg>
                Rename
              </button>
            )}
            {!browserMode && (
              photoshopPath ? (
                <button
                  onClick={onOpenInPhotoshop}
                  className="action-btn ps"
                  disabled={loading || selectedCount === 0}
                  title={`Open in Photoshop: ${photoshopPath}`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 2 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                  PS
                </button>
              ) : (
                <button
                  onClick={handleBrowsePsPath}
                  className="action-btn ps"
                  disabled={loading}
                  title="Locate Photoshop.exe"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 2 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  Set PS
                </button>
              )
            )}
          </div>
        </div>
      )}

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
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
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

      {/* ── Section 3: View & Pagination ── */}
      {totalCount > 0 && (
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
                disabled={loading}
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
                    disabled={loading}
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
                className={`segment-btn ${imageFitMode === 'contain' ? 'active' : ''}`}
                onClick={() => onImageFitModeChange('contain')}
                title="Contain"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
              </button>
              <button 
                className={`segment-btn ${imageFitMode === 'cover' ? 'active' : ''}`}
                onClick={() => onImageFitModeChange('cover')}
                title="Cover"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m3 3 18 18"/><path d="m21 3-18 18"/></svg>
              </button>
            </div>
            <button
              className={`icon-btn-modern ${dragSelectEnabled ? 'active' : ''}`}
              onClick={() => onDragSelectEnabledChange(!dragSelectEnabled)}
              title="Drag Select"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9"/><path d="M12 2v8"/><path d="M12 10 9 7"/><path d="m12 10 3-3"/><path d="M18 21v-8a2 2 0 0 0-2-2h-4"/></svg>
            </button>
            {!browserMode && (
              <button
                className={`icon-btn-modern ${autoReloadEnabled ? 'active' : ''}`}
                onClick={() => onAutoReloadChange(!autoReloadEnabled)}
                title={autoReloadEnabled ? 'Auto-Reload: ON (refresh thumbnails when files change on disk)' : 'Auto-Reload: OFF'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              </button>
            )}
            <button 
              className={`icon-btn-modern ${!confirmRequired ? 'warning' : ''}`}
              onClick={() => onConfirmRequiredChange(!confirmRequired)}
              title={confirmRequired ? 'Confirm: ON' : 'Confirm: OFF'}
            >
              {confirmRequired ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              )}
            </button>
          </div>

          <div className="divider-v" />

          <div className="pagination-modern">
            <Dropdown
              value={pageSize}
              onChange={onPageSizeChange}
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
              <button onClick={onPrevPage} disabled={loading || currentPage <= 1} className="nav-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <span className="page-info">{currentPage}<span className="of">/</span>{totalPages}</span>
              <button onClick={onNextPage} disabled={loading || currentPage >= totalPages} className="nav-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>
            <button
              className={`help-btn-modern ${showShortcuts ? 'active' : ''}`}
              onClick={onToggleShortcuts}
              title="Keyboard shortcuts"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>
            </button>
            {hasSubfolders && (
              <button
                className={`help-btn-modern ${subfolderBarPinned ? 'active' : ''}`}
                onClick={onToggleSubfolderBar}
                title={subfolderBarPinned ? 'Auto-hide subfolder bar' : 'Pin subfolder bar'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
              </button>
            )}
          </div>
        </div>
      )}
      
      {loading && (
        <div className="loading-indicator-modern">
          <div className="spinner"></div>
        </div>
      )}
    </div>
  );
}

export default Controls;
