import React, { memo, useEffect, useRef } from 'react';
import './FolderThumbnail.css';

function RenameInput({ folder, onCommit, onCancel }) {
  const inputRef = useRef(null);

  useEffect(() => {
    // Add a slight delay to ensure context menus are fully closed and focus isn't stolen
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <input
      ref={inputRef}
      className="folder-thumb-rename-input"
      defaultValue={folder.name}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(folder, e.target.value.trim());
        else if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => onCancel()}
    />
  );
}

function FolderThumbnail({ folder, preview, onClick, onContextMenu, size, orderNumber, orderSelectMode, isEditing, onRenameCommit, onRenameCancel, isSelected, onLongPress }) {
  const tiles = (preview || []).filter(p => p && p.dataUrl).slice(0, 4);
  const hasTiles = tiles.length > 0;
  
  const pressTimer = useRef(null);
  const wasLongPress = useRef(false);

  const handlePointerDown = (e) => {
    if (e.button !== 0) return; // left click only
    wasLongPress.current = false;
    pressTimer.current = setTimeout(() => {
      wasLongPress.current = true;
      if (onLongPress) onLongPress(folder.path);
      pressTimer.current = null;
    }, 400);
  };

  const handlePointerUp = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handleClick = (e) => {
    if (wasLongPress.current) {
      wasLongPress.current = false;
      return;
    }
    if (onClick) onClick(folder.path);
  };

  return (
    <div
      className={`folder-thumbnail ${orderSelectMode ? 'order-mode' : ''} ${isSelected ? 'is-selected' : ''}`}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onDoubleClick={() => onClick && onClick(folder.path)}
      onContextMenu={(e) => onContextMenu && onContextMenu(e, folder)}
      title={folder.path}
      style={size ? { width: size, height: size } : undefined}
    >
      {hasTiles ? (
        <div className={`folder-thumb-mosaic count-${tiles.length}`}>
          {tiles.map((p, i) => (
            <div key={p.path || i} className="folder-thumb-cell">
              <img src={p.dataUrl} alt="" loading="lazy" draggable={false} />
            </div>
          ))}
        </div>
      ) : (
        <div className="folder-thumb-empty">
          <svg viewBox="0 0 24 24" width="34%" height="34%" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
          </svg>
        </div>
      )}
      <div className="folder-thumb-label">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
        </svg>
        {isEditing ? (
          <RenameInput
            folder={folder}
            onCommit={onRenameCommit}
            onCancel={onRenameCancel}
          />
        ) : (
          <span>{folder.name}</span>
        )}
      </div>
    </div>
  );
}

export default memo(FolderThumbnail);
