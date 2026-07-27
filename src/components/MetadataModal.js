import React, { useEffect, useCallback, useState } from 'react';
import './MetadataModal.css';

const PRIORITY_KEYS = ['parameters', 'prompt', 'workflow', 'Description', 'Comment', 'title', 'author', 'Software'];

function parseSDParameters(raw) {
  const negIdx = raw.indexOf('\nNegative prompt:');
  if (negIdx === -1) return null;
  const positive = raw.slice(0, negIdx).trim();
  const rest = raw.slice(negIdx + 1); // "Negative prompt: ...\n..."
  const settingsNl = rest.indexOf('\n');
  if (settingsNl === -1) {
    return [
      ['Prompt', positive],
      ['Negative Prompt', rest.replace(/^Negative prompt:\s*/, '').trim()],
    ];
  }
  const negative = rest.slice(0, settingsNl).replace(/^Negative prompt:\s*/, '').trim();
  const settings = rest.slice(settingsNl + 1).trim();
  return [
    ['Prompt', positive],
    ['Negative Prompt', negative],
    ...(settings ? [['Settings', settings]] : []),
  ];
}

function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
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

function RenderValue({ value }) {
  if (typeof value === 'string') {
    if (/1\.\s/.test(value) && /2\.\s/.test(value)) {
      const parts = value.split(/(?:^|\s+|,\s*)(?=\d+\.\s)/).filter(Boolean);
      
      if (parts.length > 1 && parts.some(p => /^1\.\s/.test(p))) {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            {parts.map((part, i) => (
              <div key={i} className="metadata-value-wrap" style={i > 0 ? { borderTop: '1px solid var(--border-subtle)' } : {}}>
                <pre className="metadata-value">{part.trim()}</pre>
                <CopyBtn value={part.trim()} />
              </div>
            ))}
          </div>
        );
      }
    }
  }

  return (
    <div className="metadata-value-wrap">
      <pre className="metadata-value">{value}</pre>
      <CopyBtn value={value} />
    </div>
  );
}

function MetadataModal({ imageName, metadata, onClose }) {
  const handleKey = useCallback(e => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  const entries = Object.entries(metadata);
  const sorted = [
    ...PRIORITY_KEYS.filter(k => metadata[k] != null).flatMap(k => {
      if (k === 'parameters') {
        const parsed = parseSDParameters(metadata[k]);
        return parsed || [[k, metadata[k]]];
      }
      return [[k, metadata[k]]];
    }),
    ...entries.filter(([k]) => !PRIORITY_KEYS.includes(k)),
  ];

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="metadata-modal" onClick={e => e.stopPropagation()}>
        <div className="metadata-header">
          <div className="metadata-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 8h.01M12 11v5"/>
            </svg>
            Metadata
          </div>
          <span className="metadata-filename">{imageName}</span>
          <button className="preview-close" onClick={onClose}>×</button>
        </div>
        <div className="metadata-body">
          {sorted.length === 0 ? (
            <div className="metadata-empty">No readable metadata found in this file.</div>
          ) : sorted.map(([key, value]) => (
            <div key={key} className="metadata-row">
              <div className="metadata-key">{key}</div>
              <RenderValue value={value} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default MetadataModal;
