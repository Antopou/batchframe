import React, { useEffect, useRef } from 'react';
import './SubfolderBar.css';

function SubfolderBar({
  subfolders,
  parentFolderPath,
  onNavigate,
  visible = true,
  hideFolderChips = false,
  onContextMenu,
  onCreateFolder,
  editingFolderPath,
  onRenameCommit,
  onRenameCancel,
}) {
  if (!parentFolderPath && subfolders.length === 0) return null;

  return (
    <div className={`subfolder-bar-wrapper ${!visible ? 'subfolder-bar-collapsed' : ''}`}>
      <div className="subfolder-bar">
        {parentFolderPath && (
          <button
            className="subfolder-up-btn"
            onClick={() => onNavigate(parentFolderPath)}
            title={`Go up to: ${parentFolderPath}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        {!hideFolderChips && subfolders.map(folder => (
          folder.path === editingFolderPath ? (
            <RenameInput
              key={folder.path}
              folder={folder}
              onCommit={onRenameCommit}
              onCancel={onRenameCancel}
            />
          ) : (
            <button
              key={folder.path}
              className="subfolder-chip"
              onClick={() => onNavigate(folder.path)}
              onContextMenu={(e) => onContextMenu && onContextMenu(e, folder)}
              title={folder.path}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
              </svg>
              {folder.name}
            </button>
          )
        ))}
        {onCreateFolder && (
          <button
            className="subfolder-add-btn"
            onClick={() => onCreateFolder()}
            title="New folder"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function RenameInput({ folder, onCommit, onCancel }) {
  const inputRef = useRef(null);

  useEffect(() => {
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
      className="subfolder-rename-input"
      defaultValue={folder.name}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onCommit(folder, e.target.value.trim());
        } else if (e.key === 'Escape') {
          onCancel();
        }
      }}
      onBlur={() => onCancel()}
    />
  );
}

export default SubfolderBar;
