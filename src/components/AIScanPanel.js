import React, { useState, useCallback, useEffect, useRef } from 'react';
import './AIScanPanel.css';

// Persisted scan thresholds (survive reloads — set once in the settings pop-up).
const LS_GATE  = 'aiScanGate';   // 1st pass: fast CLIP pre-filter
const LS_MATCH = 'aiScanMatch';  // 2nd pass: accurate CCIP match
const loadPct = (key, def) => {
  const v = parseFloat(localStorage.getItem(key));
  return v >= 0.50 && v <= 0.95 ? v : def;
};

function AIScanPanel({
  totalCount, aiScores, scanning, scanProgress, scanStatus,
  onScan, onClearScores, profilesVersion, onClearRefs,
  activeCharacter, onSetActiveCharacter,
}) {
  const [threshold, setThreshold] = useState(() => loadPct(LS_MATCH, 0.80));
  const [gate, setGate]           = useState(() => loadPct(LS_GATE, 0.90));
  const [showSettings, setShowSettings] = useState(false);
  const [profiles, setProfiles]   = useState([]);
  const [adding, setAdding]       = useState(false);
  const [newName, setNewName]     = useState('');
  const inputRef                  = useRef(null);
  const settingsRef               = useRef(null);

  const matchedCount = Object.values(aiScores).filter(v => v?.score != null && v.score >= threshold).length;
  const hasScores    = Object.keys(aiScores).length > 0;
  const totalRefs    = profiles.reduce((s, p) => s + p.count, 0);
  const canScan      = totalRefs > 0 && totalCount > 0 && !scanning;

  // Persist thresholds whenever they change.
  useEffect(() => { localStorage.setItem(LS_MATCH, String(threshold)); }, [threshold]);
  useEffect(() => { localStorage.setItem(LS_GATE,  String(gate)); },      [gate]);

  // Close the settings pop-up on outside click.
  useEffect(() => {
    if (!showSettings) return;
    const onDoc = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) setShowSettings(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showSettings]);

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
    onScan(threshold, active.map(p => ({ name: p.name, folder: p.folder })), gate);
  }, [profiles, threshold, gate, scanning, onScan]);

  const pctInput = (value, setter) => (
    <div className="ai-threshold-wrap">
      <input
        type="number" min="50" max="95"
        value={Math.round(value * 100)}
        onChange={e => {
          const v = Math.max(50, Math.min(95, Number(e.target.value)));
          if (!isNaN(v)) setter(v / 100);
        }}
        disabled={scanning}
        className="ai-threshold-input"
      />
      <span className="ai-threshold-pct">%</span>
    </div>
  );

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

      {/* settings pop-up (1st pass filter % + 2nd pass match %) */}
      <div className="ai-settings-wrap" ref={settingsRef}>
        <button
          className={`ai-settings-btn${showSettings ? ' active' : ''}`}
          onClick={() => setShowSettings(v => !v)}
          disabled={scanning}
          title="Scan thresholds — 1st filter / 2nd match"
        >
          <span className="ai-settings-gear">⚙</span>
          <span className="ai-settings-read">{Math.round(gate * 100)}<span className="ai-settings-sep">→</span>{Math.round(threshold * 100)}%</span>
        </button>

        {showSettings && (
          <div className="ai-settings-pop" onMouseDown={e => e.stopPropagation()}>
            <div className="ai-set-title">Scan thresholds</div>

            <div className="ai-set-row">
              <div className="ai-set-head">
                <span className="ai-set-name"><b>1st</b> · Quick filter</span>
                {pctInput(gate, setGate)}
              </div>
              <input
                type="range" min="0.50" max="0.95" step="0.01"
                value={gate}
                onChange={e => setGate(Number(e.target.value))}
                disabled={scanning}
                className="ai-threshold-slider wide"
              />
              <div className="ai-set-hint">Fast first pass. Only images above this get the slow scan. Higher = faster, but may skip real matches.</div>
            </div>

            <div className="ai-set-row">
              <div className="ai-set-head">
                <span className="ai-set-name"><b>2nd</b> · Match</span>
                {pctInput(threshold, setThreshold)}
              </div>
              <input
                type="range" min="0.50" max="0.95" step="0.01"
                value={threshold}
                onChange={e => setThreshold(Number(e.target.value))}
                disabled={scanning}
                className="ai-threshold-slider wide"
              />
              <div className="ai-set-hint">Accurate scan. An image counts as a match at or above this. Higher = stricter, fewer wrong matches.</div>
            </div>
          </div>
        )}
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
