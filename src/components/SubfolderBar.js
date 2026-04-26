import React from 'react';
import './SubfolderBar.css';

function SubfolderBar({ subfolders, parentFolderPath, onNavigate, visible = true }) {
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="6" cy="12" r="2"/>
              <circle cx="12" cy="12" r="2"/>
              <circle cx="18" cy="12" r="2"/>
            </svg>
          </button>
        )}
        {subfolders.map(folder => (
          <button
            key={folder.path}
            className="subfolder-chip"
            onClick={() => onNavigate(folder.path)}
            title={folder.path}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
            </svg>
            {folder.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export default SubfolderBar;
