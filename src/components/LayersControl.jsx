// -----------------------------------------------------------------------------
// LayersControl.jsx - a "layers" button + popover that floats over the map.
//
// Toggles which overlays MapCanvas draws (scan / frontiers / trail / robot / grid)
// and offers a manual "Download PNG" of the current map view. The toggle state is
// owned by App (persisted to localStorage) and flows down through MapCard; flipping
// one only updates a ref inside MapCanvas, so the ROS subscriptions are untouched.
// -----------------------------------------------------------------------------
import { useState } from 'react';

const LayersIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2 2 7l10 5 10-5-10-5Z" />
    <path d="m2 17 10 5 10-5" />
    <path d="m2 12 10 5 10-5" />
  </svg>
);
const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);

const LAYER_DEFS = [
  ['scan', 'LiDAR scan'],
  ['frontiers', 'Frontiers'],
  ['trail', 'Trail'],
  ['robot', 'Robot'],
  ['grid', 'Grid'],
];

export default function LayersControl({ layers, onChange, onDownloadPng }) {
  const [open, setOpen] = useState(false);
  const toggle = (key) => () => onChange({ ...layers, [key]: !layers[key] });

  return (
    <div className="map-layers">
      <button
        type="button"
        className="map-btn"
        title="Layers"
        aria-label="Map layers"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <LayersIcon />
      </button>
      {open && (
        <div className="layers-pop" role="menu">
          <div className="layers-pop-title">Layers</div>
          {LAYER_DEFS.map(([key, label]) => (
            <label className="layers-row" key={key}>
              <input type="checkbox" checked={!!layers[key]} onChange={toggle(key)} />
              <span>{label}</span>
            </label>
          ))}
          <button type="button" className="layers-download" onClick={onDownloadPng}>
            <DownloadIcon /> Download PNG
          </button>
        </div>
      )}
    </div>
  );
}
