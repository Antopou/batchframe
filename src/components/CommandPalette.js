import React, { useEffect, useRef, useState } from 'react';
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

function CommandPalette({ isOpen, onClose, query, setQuery, actions }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Filter actions based on query
  const filteredActions = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(action => {
      return (
        action.name.toLowerCase().includes(q) ||
        (action.subtitle && action.subtitle.toLowerCase().includes(q)) ||
        (action.keywords && action.keywords.some(k => k.toLowerCase().includes(q)))
      );
    });
  }, [actions, query]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Handle keyboard navigation
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
        setSelectedIndex(prev => Math.min(prev + 1, filteredActions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredActions[selectedIndex]) {
          filteredActions[selectedIndex].onExecute();
          onClose();
        } else {
          // If no actions match, the query is just a local image search
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true); // Use capture phase to override global shortcuts
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, filteredActions, selectedIndex, onClose]);

  // Keep selected item in view
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector('.cmd-palette-item.selected');
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="cmd-palette-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmd-palette" onMouseDown={e => e.stopPropagation()}>
        <div className="cmd-palette-header">
          <span className="cmd-palette-prompt">❯</span>
          <input
            ref={inputRef}
            className="cmd-palette-input"
            placeholder="enter command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        
        <div className="cmd-palette-body" ref={listRef}>
          {filteredActions.length > 0 ? (
            <>
              <div className="cmd-palette-section-title">Commands</div>
              {filteredActions.map((action, idx) => (
                <div 
                  key={action.id} 
                  className={`cmd-palette-item ${idx === selectedIndex ? 'selected' : ''}`}
                  onMouseMove={() => setSelectedIndex(idx)}
                  onClick={() => {
                    action.onExecute();
                    onClose();
                  }}
                >

                  <div className="cmd-palette-item-content">
                    <div className="cmd-palette-item-title">{highlight(action.name, query)}</div>
                    {action.subtitle && <div className="cmd-palette-item-subtitle">{highlight(action.subtitle, query)}</div>}
                  </div>
                  {action.shortcut && (
                    <div className="cmd-palette-item-shortcut">
                      {action.shortcut.map((key, i) => <kbd key={i}>{key}</kbd>)}
                    </div>
                  )}
                </div>
              ))}
            </>
          ) : (
            <div className="cmd-palette-empty">
              No commands found. Searching images for "{query}"...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
