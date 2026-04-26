import React, { useState } from 'react';
import './RenameModal.css';

function RenameModal({ images, onConfirm, onClose }) {
  const [prefix, setPrefix] = useState('img_');
  const [startN, setStartN] = useState(1);
  const [digits, setDigits] = useState(3);

  const preview = images.slice(0, 3).map((img, i) => {
    const ext = img.name.slice(img.name.lastIndexOf('.'));
    return `${prefix}${String(startN + i).padStart(digits, '0')}${ext}`;
  });
  const lastIdx = images.length - 1;
  const lastExt = images[lastIdx]?.name.slice(images[lastIdx].name.lastIndexOf('.')) || '';
  const lastName = `${prefix}${String(startN + lastIdx).padStart(digits, '0')}${lastExt}`;

  return (
    <div className="rename-modal-overlay" onClick={onClose}>
      <div className="rename-modal" onClick={e => e.stopPropagation()}>
        <div className="rename-modal-header">
          <span>Bulk Rename · {images.length} image{images.length !== 1 ? 's' : ''}</span>
          <button className="rename-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="rename-modal-body">
          <div className="rename-field-row">
            <label>Prefix</label>
            <input
              value={prefix}
              onChange={e => setPrefix(e.target.value)}
              className="rename-input"
              placeholder="img_"
            />
          </div>
          <div className="rename-field-row">
            <label>Start</label>
            <input
              type="number"
              value={startN}
              min="0"
              onChange={e => setStartN(Math.max(0, Number(e.target.value)))}
              className="rename-input"
              style={{ width: '70px' }}
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
          <div className="rename-preview-block">
            {preview.map((name, i) => (
              <div key={i} className="rename-preview-line">{name}</div>
            ))}
            {images.length > 3 && <div className="rename-preview-ellipsis">…</div>}
            {images.length > 3 && <div className="rename-preview-line">{lastName}</div>}
          </div>
        </div>
        <div className="rename-modal-footer">
          <button className="btn-modern ghost sm" onClick={onClose}>Cancel</button>
          <button
            className="btn-modern success sm"
            disabled={!prefix}
            onClick={() => onConfirm(prefix, startN, digits)}
          >
            Rename {images.length} file{images.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RenameModal;
