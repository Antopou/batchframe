import React, { useState, useCallback, useEffect, useRef } from 'react';
import './AIScanPanel.css';

function AIScanPanel({
  totalCount, aiScores, scanning, scanProgress, scanStatus,
  onScan, onClearScores, profilesVersion, onClearRefs,
  activeCharacter, onSetActiveCharacter,
}) {
  const [threshold, setThreshold] = useState(0.88);
  const [profiles, setProfiles]   = useState([]);
  const [adding, setAdding]       = useState(false);
  const [newName, setNewName]     = useState('');
  const inputRef                  = useRef(null);

  const matchedCount = Object.values(aiScores).filter(v => v?.score != null && v.score >= threshold).length;
  const hasScores    = Object.keys(aiScores).length > 0;
  const totalRefs    = profiles.reduce((s, p) => s + p.count, 0);
  const canScan      = totalRefs > 0 && totalCount > 0 && !scanning;

  const refreshProfiles = useCallback(async () => {
    if (!window.electronAPI?.getCharacterProfiles) return;
    const list = await window.electronAPI.getCharacterProfiles();
    setProfiles(list);
    if (list.length > 0)
      onSetActiveCharacter(cur => cur && list.find(p => p.name === cur) ? cur : list[0].name);
    else
      onSetActiveCharacter(null);
  }, [onSetActiveCharacter]);

  useEffect(() => { refreshProfiles(); }, [refreshProfiles, profilesVersion]);
  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  const handleAdd = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    await window.electronAPI.createCharacter(name);
    setNewName(''); setAdding(false);
    onSetActiveCharacter(name);
    await refreshProfiles();
  }, [newName, onSetActiveCharacter, refreshProfiles]);

  const handleScan = useCallback(() => {
    const active = profiles.filter(p => p.count > 0);
    if (!active.length || scanning) return;
    onScan(threshold, active.map(p => ({ name: p.name, folder: p.folder })));
  }, [profiles, threshold, scanning, onScan]);

  return (
    <div className="ai-scan-panel">
      {/* chips */}
      {profiles.map(p => (
        <div
          key={p.name}
          className={`ai-chip${activeCharacter === p.name ? ' active' : ''}`}
          onClick={() => onSetActiveCharacter(p.name)}
          title="Click to set active"
        >
          <span className="ai-chip-dot" />
          <span className="ai-chip-name">{p.name}</span>
          <span className="ai-chip-count">{p.count}</span>
          <span className="ai-chip-actions">
            <button
              className="ai-chip-btn"
              onClick={e => { e.stopPropagation(); window.electronAPI.openRefsFolder(p.name).then(() => setTimeout(refreshProfiles, 1200)); }}
              title="Open folder"
              disabled={scanning}
            >↗</button>
            <button
              className="ai-chip-btn danger"
              onClick={e => { e.stopPropagation(); onClearRefs(p.name); }}
              title="Clear refs"
              disabled={scanning || p.count === 0}
            >✕</button>
          </span>
        </div>
      ))}

      {/* add character */}
      {adding ? (
        <div className="ai-chip-input-wrap">
          <input
            ref={inputRef}
            className="ai-chip-input"
            placeholder="Name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') { setAdding(false); setNewName(''); }
            }}
          />
          <button className="btn-modern primary xs" onClick={handleAdd} disabled={!newName.trim()}>Add</button>
          <button className="btn-modern ghost xs" onClick={() => { setAdding(false); setNewName(''); }}>✕</button>
        </div>
      ) : (
        <button className="ai-add-btn" onClick={() => setAdding(true)} disabled={scanning}>+</button>
      )}

      {/* divider */}
      <div className="ai-divider" />

      {/* threshold */}
      <input
        type="range"
        min="0.50" max="0.95" step="0.01"
        value={threshold}
        onChange={e => setThreshold(Number(e.target.value))}
        disabled={scanning}
        className="ai-threshold-slider"
        title={`Threshold: ${Math.round(threshold * 100)}%`}
      />
      <div className="ai-threshold-wrap">
        <input
          type="number"
          min="50" max="95"
          value={Math.round(threshold * 100)}
          onChange={e => {
            const v = Math.max(50, Math.min(95, Number(e.target.value)));
            if (!isNaN(v)) setThreshold(v / 100);
          }}
          disabled={scanning}
          className="ai-threshold-input"
          title="Threshold %"
        />
        <span className="ai-threshold-pct">%</span>
      </div>

      {/* scan */}
      <button
        className="btn-modern primary sm"
        onClick={handleScan}
        disabled={!canScan}
        title={totalRefs === 0 ? 'Add reference images first' : `Scan ${totalCount} images`}
      >
        {scanning ? (scanStatus || `${scanProgress.done}/${scanProgress.total}`) : `Scan ${totalCount}`}
      </button>

      {hasScores && !scanning && (
        <>
          <span className="ai-match-count">{matchedCount} matched</span>
          <button className="btn-modern ghost sm" onClick={onClearScores}>Clear</button>
        </>
      )}
    </div>
  );
}

export default AIScanPanel;
