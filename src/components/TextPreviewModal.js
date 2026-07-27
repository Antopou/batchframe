import React, { useEffect, useCallback, useState } from 'react';
import './MetadataModal.css';

function CopyBtn({ value, onCopy }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      if (onCopy) onCopy();
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button className={`metadata-copy-btn${copied ? ' copied' : ''}`} onClick={handleCopy} title="Copy">
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
        </svg>
      )}
    </button>
  );
}

function TextPreviewModal({ fileName, text, onClose }) {
  const [excludedTags, setExcludedTags] = useState([]);

  const handleKey = useCallback(e => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  // Parse text into tags (split by comma or newline)
  const tags = text ? text.split(/,\s*|\n+/).map(t => t.trim()).filter(t => t) : [];

  const handleTagClick = (tag) => {
    setExcludedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

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
        .tag-separator {
          color: var(--text-muted);
        }
        .tag-separator.excluded {
          opacity: 0.3;
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
          {!text ? (
            <div className="metadata-empty">File is empty.</div>
          ) : (
            <>
              <div className="metadata-row" style={{ flex: 1, borderBottom: includedTags.length > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                <div className="metadata-key" style={{ borderBottom: 'none' }}>Contents</div>
                <div className="metadata-value-wrap" style={{ flex: 1 }}>
                  <div className="metadata-value" style={{ maxHeight: '50vh', height: '100%', borderBottom: 'none', display: 'block' }}>
                    {tags.map((tag, i) => {
                      const isExcluded = excludedTags.includes(tag);
                      return (
                        <React.Fragment key={i}>
                          <span 
                            className={`txt-tag ${isExcluded ? 'excluded' : ''}`}
                            onClick={() => handleTagClick(tag)}
                            title="Click to toggle exclusion"
                          >
                            {tag}
                          </span>
                          {i < tags.length - 1 && <span className={`tag-separator ${isExcluded ? 'excluded' : ''}`}>, </span>}
                        </React.Fragment>
                      );
                    })}
                  </div>
                  <CopyBtn value={text} onCopy={() => setExcludedTags([])} />
                </div>
              </div>
              
              {includedTags.length > 0 && (
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
                    <CopyBtn value={textToCopy} />
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
