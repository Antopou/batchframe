import React, { useState, useMemo, useRef, useEffect } from 'react';
import './RenameModal.css';

function RenameModal({ images, allImages, onConfirm, onClose }) {
  const [prefix, setPrefix] = useState('img_');
  const [digits, setDigits] = useState(1);
  const prefixInputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => {
      if (prefixInputRef.current) {
        prefixInputRef.current.focus();
        prefixInputRef.current.select();
      }
    }, 10);
  }, []);

  const previewRenames = useMemo(() => {
    let actualPrefix = prefix;
    let computedSuffix = '';
    const trimmed = prefix.trimEnd();

    if (trimmed.length > 0 && /[a-zA-Z0-9]$/.test(trimmed) && prefix === trimmed) {
      actualPrefix = prefix + ' (';
      computedSuffix = ')';
    } else if (trimmed.endsWith('(')) {
      computedSuffix = ')';
    } else if (trimmed.endsWith('[')) {
      computedSuffix = ']';
    } else if (trimmed.endsWith('{')) {
      computedSuffix = '}';
    }

    let maxN = -1;
    (allImages || []).forEach(img => {
      const ext = img.name.slice(img.name.lastIndexOf('.'));
      const base = img.name.slice(0, img.name.length - ext.length);
      if (base.toLowerCase().startsWith(actualPrefix.toLowerCase()) && 
          base.toLowerCase().endsWith(computedSuffix.toLowerCase()) && 
          base.length >= actualPrefix.length + computedSuffix.length) {
        const numStr = base.slice(actualPrefix.length, base.length - computedSuffix.length);
        if (/^\d+$/.test(numStr)) {
          maxN = Math.max(maxN, parseInt(numStr, 10));
        }
      }
    });

    const startN = maxN >= 0 ? maxN + 1 : 1;

    return images.map((img, i) => {
      const ext = img.name.slice(img.name.lastIndexOf('.'));
      const newName = `${actualPrefix}${String(startN + i).padStart(digits, '0')}${computedSuffix}${ext}`;
      return { oldPath: img.path, newName };
    });
  }, [prefix, digits, images, allImages]);

  return (
    <div className="rename-modal-overlay" onClick={onClose}>
      <div 
        className="rename-modal" 
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Enter' && prefix) {
            e.preventDefault();
            e.nativeEvent.stopImmediatePropagation();
            onConfirm(previewRenames);
          }
        }}
      >
        <div className="rename-modal-header">
          <span>Bulk Rename · {images.length} image{images.length !== 1 ? 's' : ''}</span>
          <button className="rename-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rename-modal-body">
          <div className="rename-field-row">
            <label>Prefix</label>
            <input
              ref={prefixInputRef}
              value={prefix}
              onChange={e => setPrefix(e.target.value)}
              className="rename-input"
              placeholder="img_"
            />
          </div>
          <div className="rename-field-row">
            <label>Digits</label>
            <input
              type="number"
              value={digits}
              min="1"
              max="9"
              onChange={e => setDigits(Math.max(1, Math.min(9, Number(e.target.value))))}
              className="rename-input"
              style={{ width: '55px' }}
            />
          </div>
        </div>
        <div className="rename-modal-footer">
          <button className="btn-modern ghost sm" onClick={onClose}>Cancel</button>
          <button
            className="btn-modern success sm"
            disabled={!prefix}
            onClick={() => onConfirm(previewRenames)}
          >
            Rename {images.length} file{images.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RenameModal;
