import React, { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import './MetadataModal.css';

function CopyBtn({ value, onCopy, isFlashing }) {
  const [pressed, setPressed] = useState(false);
  
  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value).catch(()=>{});
    if (onCopy) onCopy();
  };
  
  return (
    <button 
      className={`metadata-copy-btn${(pressed || isFlashing) ? ' pressed' : ''}`} 
      onClick={handleCopy}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      title="Copy"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
      </svg>
    </button>
  );
}

function TextPreviewModal({ fileName, text: initialText, filePath, onClose }) {
  const [currentText, setCurrentText] = useState(initialText);

  // Poll for file changes
  useEffect(() => {
    if (!filePath) return;
    const intervalId = setInterval(async () => {
      try {
        const result = await window.electronAPI.getTextFile(filePath);
        if (result.success && result.text !== currentText) {
          setCurrentText(result.text);
        }
      } catch (e) {
        console.error('Failed to poll text file:', e);
      }
    }, 1000);
    return () => clearInterval(intervalId);
  }, [filePath, currentText]);

  const [excludedTags, setExcludedTags] = useState([]);
  const [showSelected, setShowSelected] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [isKeyboardNavigating, setIsKeyboardNavigating] = useState(false);
  const [autoAdvanceDir, setAutoAdvanceDir] = useState(1);
  const [flashTop, setFlashTop] = useState(false);
  const [flashBottom, setFlashBottom] = useState(false);
  const tagRefs = useRef([]);

  // Parse text into tags (split by comma or newline)
  const tags = useMemo(() => currentText ? currentText.split(/,\s*|\n+/).map(t => t.trim()).filter(t => t) : [], [currentText]);

  const numberedParts = useMemo(() => {
    if (!currentText) return null;
    if (/1\.\s/.test(currentText) && /2\.\s/.test(currentText)) {
      const parts = currentText.split(/(?=(?:\b|^)\d+\.\s)/).map(s => s.trim().replace(/^,\s*/, '').replace(/,\s*$/, '')).filter(Boolean);
      if (parts.length > 1 && parts.some(p => /^1\.\s/.test(p))) {
        return parts;
      }
    }
    return null;
  }, [currentText]);

  const handleTagClick = useCallback((tag) => {
    setShowSelected(true);
    setExcludedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  }, []);

  const handleTopCopy = useCallback(() => {
    if (!showSelected) {
      setShowSelected(true);
      setExcludedTags([]);
    } else {
      setShowSelected(false);
      setExcludedTags([]);
      setAutoAdvanceDir(1);
    }
  }, [showSelected]);

  const handleKey = useCallback(e => {
    const isLetter = /^[a-zA-Z]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey;

    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab', 'Escape', ' ', 'Enter'].includes(e.key) || 
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') ||
        isLetter) {
      e.stopPropagation();
    }

    if (!isKeyboardNavigating && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Tab', 'Home', 'End'].includes(e.key)) {
      setIsKeyboardNavigating(true);
      
      // For basic navigation keys, the first press just activates the cursor at index 0.
      // But if they are holding Cmd (metaKey) or pressing Home/End, we let it fall through 
      // so it can instantly rocket them to the beginning or end!
      if (!e.metaKey && !e.ctrlKey && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Tab'].includes(e.key)) {
        e.preventDefault();
        setFocusedIndex(0);
        return;
      }
    }

    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(e.key)) {
      setIsKeyboardNavigating(true);
    }
    
    if (e.key === 'Escape') { 
      e.preventDefault(); 
      onClose(); 
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        setFocusedIndex(i => Math.max(i - 1, 0));
      } else {
        setFocusedIndex(i => Math.min(i + 1, tags.length - 1));
      }
    } else if (e.key === 'End' || (e.metaKey && (e.key === 'ArrowDown' || e.key === 'ArrowRight'))) {
      e.preventDefault();
      setFocusedIndex(tags.length - 1);
      setAutoAdvanceDir(-1);
    } else if (e.key === 'Home' || (e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowLeft'))) {
      e.preventDefault();
      setFocusedIndex(0);
      setAutoAdvanceDir(1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setFocusedIndex(i => Math.min(i + 1, tags.length - 1));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setFocusedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(i => Math.min(i + 6, tags.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(i => Math.max(i - 6, 0));
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (tags[focusedIndex]) {
        handleTagClick(tags[focusedIndex]);
        setFocusedIndex(i => Math.max(0, Math.min(i + autoAdvanceDir, tags.length - 1)));
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      if (showSelected) {
        const included = tags.filter(t => !excludedTags.includes(t));
        navigator.clipboard.writeText(included.join(', ')).catch(()=>{});
        setFlashBottom(true);
        setTimeout(() => setFlashBottom(false), 150);
      } else {
        navigator.clipboard.writeText(currentText).catch(()=>{});
        setFlashTop(true);
        setTimeout(() => setFlashTop(false), 150);
      }
    } else if (isLetter) {
      e.preventDefault();
      setIsKeyboardNavigating(true);
      setAutoAdvanceDir(1);
      const targetChar = e.key.toLowerCase();
      const matchIndices = tags.map((t, i) => t.toLowerCase().startsWith(targetChar) ? i : -1).filter(i => i !== -1);
      
      if (matchIndices.length > 0) {
        const nextIndex = matchIndices.find(i => i > focusedIndex);
        if (nextIndex !== undefined) {
          setFocusedIndex(nextIndex);
        } else {
          setFocusedIndex(matchIndices[0]);
        }
      }
    }
  }, [onClose, tags, focusedIndex, excludedTags, handleTagClick, isKeyboardNavigating, autoAdvanceDir]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  }, [handleKey]);

  useEffect(() => {
    if (tagRefs.current[focusedIndex]) {
      tagRefs.current[focusedIndex].scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
  }, [focusedIndex]);

  const includedTags = tags.filter(t => !excludedTags.includes(t));
  const textToCopy = includedTags.join(', ');

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <style>{`
        .txt-tag {
          cursor: pointer;
          color: var(--text-primary);
          transition: all 0.15s;
        }
        .txt-tag:hover {
          color: var(--accent);
        }
        .txt-tag.excluded {
          color: var(--text-muted);
          text-decoration: line-through;
          opacity: 0.5;
        }
        .txt-tag.focused {
          color: var(--accent);
          text-decoration: underline;
          text-decoration-color: var(--accent);
          text-underline-offset: 4px;
          transition: none; /* instant snap */
        }
        .tag-separator {
          color: var(--text-muted);
        }
        .tag-separator.excluded {
          opacity: 0.3;
        }
        .metadata-copy-btn.pressed {
          transform: scale(0.85);
          color: var(--accent);
          background: rgba(92, 124, 255, 0.15);
          border-color: var(--accent);
          opacity: 1 !important;
        }
        /* Override global hover behavior to only show copy button on direct hover */
        .metadata-value-wrap:hover .metadata-copy-btn {
          opacity: 0;
        }
        .metadata-copy-btn:hover {
          opacity: 1 !important;
        }
      `}</style>
      <div className="metadata-modal" onClick={e => e.stopPropagation()} style={{ width: 'min(900px, 94vw)', minHeight: '50vh' }}>
        <div className="metadata-header">
          <div className="metadata-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 8h.01M12 11v5"/>
            </svg>
            Metadata
          </div>
          <span className="metadata-filename">{fileName}</span>
          <button className="preview-close" onClick={onClose}>×</button>
        </div>
        <div className="metadata-body" style={{ display: 'flex', flexDirection: 'column' }}>
          {!currentText ? (
            <div className="metadata-empty">File is empty.</div>
          ) : numberedParts ? (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
              <div className="metadata-row" style={{ flex: 1, borderBottom: 'none' }}>
                <div className="metadata-key" style={{ borderBottom: 'none' }}>Contents</div>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                  {numberedParts.map((part, i) => {
                    const cleanPart = part.replace(/^\d+\.\s*/, '');
                    return (
                      <div key={i} className="metadata-value-wrap" style={i > 0 ? { borderTop: '1px solid var(--border-subtle)' } : {}}>
                        <div style={{ padding: '9px 0 9px 13px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace", fontSize: '11px', userSelect: 'none', flexShrink: 0 }}>
                          {i + 1}.
                        </div>
                        <pre 
                          className="metadata-value" 
                          style={{ borderBottom: 'none', display: 'block', maxHeight: 'none', height: 'auto', paddingLeft: '8px', flex: 1, cursor: 'pointer' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(cleanPart).catch(()=>{});
                            // Optional: provide some visual feedback by finding the copy button and adding the pressed class temporarily
                            const btn = e.currentTarget.nextElementSibling;
                            if (btn) {
                              btn.classList.add('pressed');
                              setTimeout(() => btn.classList.remove('pressed'), 150);
                            }
                          }}
                          title="Click to copy"
                        >
                          {cleanPart}
                        </pre>
                        <CopyBtn value={cleanPart} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="metadata-row" style={{ flex: 1, borderBottom: showSelected ? '1px solid var(--border-subtle)' : 'none' }}>
                <div className="metadata-key" style={{ borderBottom: 'none' }}>Contents</div>
                <div className="metadata-value-wrap" style={{ flex: 1 }}>
                  <div className="metadata-value" style={{ maxHeight: '50vh', height: '100%', borderBottom: 'none', display: 'block' }}>
                    {tags.map((tag, i) => {
                      const isExcluded = excludedTags.includes(tag);
                      return (
                        <React.Fragment key={i}>
                          <span 
                            ref={el => tagRefs.current[i] = el}
                            className={`txt-tag ${isExcluded ? 'excluded' : ''} ${isKeyboardNavigating && focusedIndex === i ? 'focused' : ''}`}
                            onClick={() => {
                              setIsKeyboardNavigating(false);
                              setAutoAdvanceDir(1);
                              setFocusedIndex(i);
                              handleTagClick(tag);
                            }}
                            title="Click to toggle exclusion"
                          >
                            {tag}
                          </span>
                          {i < tags.length - 1 && <span className={`tag-separator ${isExcluded ? 'excluded' : ''}`}>, </span>}
                        </React.Fragment>
                      );
                    })}
                  </div>
                  <CopyBtn value={currentText} onCopy={handleTopCopy} isFlashing={flashTop} />
                </div>
              </div>
              
              {showSelected && (
                <div className="metadata-row" style={{ borderBottom: 'none' }}>
                  <div className="metadata-key" style={{ borderBottom: 'none' }}>Selected</div>
                  <div className="metadata-value-wrap">
                    <div className="metadata-value" style={{ minHeight: '80px', maxHeight: '30vh', borderBottom: 'none', display: 'block' }}>
                      {includedTags.map((tag, i) => (
                        <React.Fragment key={i}>
                          <span 
                            className="txt-tag"
                            onClick={() => handleTagClick(tag)}
                            title="Click to remove from selection"
                          >
                            {tag}
                          </span>
                          {i < includedTags.length - 1 && <span className="tag-separator">, </span>}
                        </React.Fragment>
                      ))}
                    </div>
                    <CopyBtn value={textToCopy} isFlashing={flashBottom} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default TextPreviewModal;
