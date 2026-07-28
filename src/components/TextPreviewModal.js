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
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const searchIndexRef = useRef(0);
  const textAreaRef = useRef(null);

  // Poll for file changes
  useEffect(() => {
    if (!filePath || isEditing) return;
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
  }, [filePath, currentText, isEditing]);

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
        return parts.map(p => {
          let num = '';
          let title = null;
          let content = p;
          
          const numMatch = p.match(/^(\d+\.)\s*/);
          if (numMatch) {
            num = numMatch[1];
            content = p.substring(numMatch[0].length);
          }
          
          if (content.startsWith('--')) {
            const nlIndex = content.indexOf('\n');
            if (nlIndex !== -1) {
              title = content.substring(2, nlIndex).trim();
              content = content.substring(nlIndex + 1).trim();
            } else {
              title = content.substring(2).trim();
              content = '';
            }
          }
          
          return { num, title, content };
        });
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
    if (isEditing) return;
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
  }, [onClose, tags, focusedIndex, excludedTags, handleTagClick, isKeyboardNavigating, autoAdvanceDir, isEditing]);

  const handleExitEdit = () => {
    if (textAreaRef.current && textAreaRef.current.value !== currentText) {
      if (!window.confirm('You have unsaved changes. Are you sure you want to discard them?')) return;
    }
    setIsEditing(false);
    setShowSearch(false);
  };

  const handleFindNext = useCallback(() => {
    if (!searchQuery || !textAreaRef.current) return;
    const text = textAreaRef.current.value;
    const lowerText = text.toLowerCase();
    const lowerQuery = searchQuery.toLowerCase();
    let idx = lowerText.indexOf(lowerQuery, searchIndexRef.current);
    
    if (idx === -1) { // wrap around
      idx = lowerText.indexOf(lowerQuery, 0);
    }
    
    if (idx !== -1) {
      const textarea = textAreaRef.current;
      textarea.focus();
      textarea.setSelectionRange(idx, idx + searchQuery.length);
      searchIndexRef.current = idx + searchQuery.length;
      
      // Calculate scroll position using a mirror div
      const mirror = document.createElement('div');
      const computed = window.getComputedStyle(textarea);
      
      const properties = [
        'direction', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY', 
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 
        'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily', 
        'textAlign', 'textTransform', 'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 
        'tabSize', 'MozTabSize'
      ];
      properties.forEach(prop => {
        mirror.style[prop] = computed[prop];
      });
      
      mirror.style.position = 'absolute';
      mirror.style.top = '0';
      mirror.style.left = '-9999px';
      mirror.style.visibility = 'hidden';
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.wordWrap = 'break-word';
      
      mirror.textContent = text.substring(0, idx);
      const span = document.createElement('span');
      span.textContent = text.substring(idx, idx + searchQuery.length);
      mirror.appendChild(span);
      
      document.body.appendChild(mirror);
      const spanTop = span.offsetTop;
      document.body.removeChild(mirror);
      
      textarea.scrollTop = Math.max(0, spanTop - textarea.clientHeight / 2);
    }
  }, [searchQuery]);

  const handleReplace = useCallback(() => {
    if (!searchQuery || !textAreaRef.current) return;
    const start = textAreaRef.current.selectionStart;
    const end = textAreaRef.current.selectionEnd;
    const selectedText = textAreaRef.current.value.substring(start, end);
    
    if (selectedText.toLowerCase() === searchQuery.toLowerCase()) {
      textAreaRef.current.setRangeText(replaceQuery, start, end, 'end');
    }
    handleFindNext();
  }, [searchQuery, replaceQuery, handleFindNext]);

  const handleReplaceAll = useCallback(() => {
    if (!searchQuery || !textAreaRef.current) return;
    const text = textAreaRef.current.value;
    const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    textAreaRef.current.value = text.replace(regex, replaceQuery);
  }, [searchQuery, replaceQuery]);

  const handleSave = async () => {
    if (!filePath || isSaving) return;
    const textToSave = textAreaRef.current ? textAreaRef.current.value : currentText;
    setIsSaving(true);
    try {
      const res = await window.electronAPI.saveTextFile(filePath, textToSave);
      if (res.success) {
        setCurrentText(textToSave);
        setHasUnsavedChanges(false);
        // Do not close edit mode on save
      } else {
        console.error('Failed to save file:', res.error);
      }
    } catch (e) {
      console.error('Error saving text file:', e);
    }
    setIsSaving(false);
  };

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
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
            {!isEditing && (
              <button 
                title="Edit text"
                onClick={() => setIsEditing(true)}
                style={{ 
                  background: 'transparent', color: 'var(--text-muted)', border: 'none', borderRadius: '4px', 
                  width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', transition: 'all 0.15s'
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
              </button>
            )}
            {isEditing && (
              <>
                <button 
                  onClick={handleExitEdit}
                  style={{ 
                    background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', 
                    borderRadius: '4px', padding: '3px 11px', fontSize: '12px', cursor: 'pointer' 
                  }}
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSave}
                  disabled={isSaving}
                  style={{ 
                    background: hasUnsavedChanges ? 'var(--accent)' : 'transparent', 
                    color: hasUnsavedChanges ? '#fff' : 'var(--text-muted)', 
                    border: hasUnsavedChanges ? 'none' : '1px solid var(--border)', 
                    borderRadius: '4px', 
                    padding: '4px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: '500',
                    opacity: isSaving ? 0.6 : 1
                  }}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
            <button className="preview-close" onClick={() => {
              if (isEditing && textAreaRef.current && textAreaRef.current.value !== currentText) {
                if (!window.confirm('You have unsaved changes. Are you sure you want to close?')) return;
              }
              onClose();
            }} style={{ marginLeft: '8px' }}>×</button>
          </div>
        </div>
        <div className="metadata-body" style={{ display: 'flex', flexDirection: 'column' }}>
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', height: '100%' }}>
              {showSearch && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 16px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      id="search-input-field"
                      autoFocus
                      placeholder="Find in text..."
                      value={searchQuery}
                      onChange={e => {
                        setSearchQuery(e.target.value);
                        searchIndexRef.current = 0;
                      }}
                      onKeyDown={e => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleFindNext();
                        }
                        if (e.key === 'Escape') {
                          setShowSearch(false);
                          textAreaRef.current?.focus();
                        }
                        if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
                           e.preventDefault();
                           e.target.select();
                        }
                      }}
                      style={{
                        flex: 1, padding: '4px 8px', background: 'var(--bg-inset)', border: '1px solid var(--border)',
                        color: 'var(--text-primary)', borderRadius: '4px', fontSize: '13px', outline: 'none'
                      }}
                    />
                    <button onClick={handleFindNext} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>Next</button>
                    <button onClick={() => { setShowSearch(false); textAreaRef.current?.focus(); }} style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: '4px', padding: '3px 11px', fontSize: '12px', cursor: 'pointer' }}>Close</button>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      placeholder="Replace with..."
                      value={replaceQuery}
                      onChange={e => setReplaceQuery(e.target.value)}
                      onKeyDown={e => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleReplace();
                        }
                        if (e.key === 'Escape') {
                          setShowSearch(false);
                          textAreaRef.current?.focus();
                        }
                      }}
                      style={{
                        flex: 1, padding: '4px 8px', background: 'var(--bg-inset)', border: '1px solid var(--border)',
                        color: 'var(--text-primary)', borderRadius: '4px', fontSize: '13px', outline: 'none'
                      }}
                    />
                    <button onClick={handleReplace} style={{ background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', padding: '3px 11px', fontSize: '12px', cursor: 'pointer' }}>Replace</button>
                    <button onClick={handleReplaceAll} style={{ background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', padding: '3px 11px', fontSize: '12px', cursor: 'pointer' }}>All</button>
                  </div>
                </div>
              )}
              <textarea
                ref={textAreaRef}
                defaultValue={currentText || ''}
                onChange={e => {
                  setHasUnsavedChanges(e.target.value !== currentText);
                }}
              onKeyDown={e => {
                // Let the textarea handle all its own key events so the modal doesn't intercept
                e.stopPropagation();
                if (e.key === 'Escape') {
                  if (showSearch) {
                    setShowSearch(false);
                  } else {
                    handleExitEdit();
                  }
                }
                if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSave();
                }
                if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  setShowSearch(true);
                  searchIndexRef.current = 0;
                }
                if (e.key === 'Enter' && showSearch) {
                  e.preventDefault();
                  handleFindNext();
                }
              }}
              autoFocus
              style={{
                flex: 1,
                width: '100%',
                padding: '16px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace",
                fontSize: '13px',
                resize: 'none',
                outline: 'none',
                lineHeight: '1.6'
              }}
            />
            </div>
          ) : !currentText ? (
            <div className="metadata-empty">File is empty.</div>
          ) : numberedParts ? (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
              {numberedParts.map((part, i) => {
                const { num, title, content } = part;
                return (
                  <div key={i} className="metadata-row" style={{ flexShrink: 0, borderBottom: i === numberedParts.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                    <div className="metadata-key" style={{ borderBottom: 'none' }}>
                      {title ? title : (i === 0 ? 'Contents' : '')}
                    </div>
                    <div className="metadata-value-wrap" style={{ flex: 1, borderTop: 'none' }}>
                      <div style={{ padding: '9px 0 9px 13px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace", fontSize: '11px', userSelect: 'none', flexShrink: 0 }}>
                        {num}
                      </div>
                      <pre 
                        className="metadata-value" 
                        style={{ borderBottom: 'none', display: 'block', maxHeight: 'none', height: 'auto', paddingLeft: '8px', flex: 1, cursor: 'pointer' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(content).catch(()=>{});
                          const btn = e.currentTarget.nextElementSibling;
                          if (btn) {
                            btn.classList.add('pressed');
                            setTimeout(() => btn.classList.remove('pressed'), 150);
                          }
                        }}
                        title="Click to copy"
                      >
                        {content}
                      </pre>
                      <CopyBtn value={content} />
                    </div>
                  </div>
                );
              })}
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
