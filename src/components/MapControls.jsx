// -----------------------------------------------------------------------------
// MapControls.jsx - the RViz-style camera toolbar that floats over the map.
//
// Buttons mutate the shared `viewRef` (the camera owned by MapCard); the canvas
// rAF loop in MapCanvas reads it next frame, so none of this triggers a React
// re-render. Docked, only the Expand affordance shows (the map is also tap-to-
// expand + drag/wheel navigable); expanded, the full set + a Close (Esc) shows.
// -----------------------------------------------------------------------------
const K_MIN = 0.35;
const K_MAX = 16;
const K_STEP = 1.35;
const R_STEP = Math.PI / 12; // 15° per rotate tap

const I = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Svg = (p) => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...I} {...p} />;

const PlusIcon = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>;
const MinusIcon = () => <Svg><path d="M5 12h14" /></Svg>;
const RotLeftIcon = () => <Svg><path d="M3 12a9 9 0 1 1 3 6.7" /><path d="M3 17v-5h5" /></Svg>;
const RotRightIcon = () => <Svg><path d="M21 12a9 9 0 1 0-3 6.7" /><path d="M21 17v-5h-5" /></Svg>;
const TargetIcon = () => <Svg><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" /><path d="M12 1v3M12 20v3M1 12h3M20 12h3" /></Svg>;
const FitIcon = () => <Svg><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" /></Svg>;
const ExpandIcon = () => <Svg><path d="M8 3H4a1 1 0 0 0-1 1v4M16 3h4a1 1 0 0 1 1 1v4M8 21H4a1 1 0 0 1-1-1v-4M16 21h4a1 1 0 0 0 1-1v-4" /></Svg>;
const CloseIcon = () => <Svg><path d="M6 6l12 12M18 6L6 18" /></Svg>;

export default function MapControls({ expanded, viewRef, pose, onExpand, onClose }) {
  const zoom = (f) => () => {
    const v = viewRef.current;
    v.k = Math.max(K_MIN, Math.min(K_MAX, v.k * f));
    v.init = true;
  };
  const rotate = (d) => () => { viewRef.current.phi += d; };
  const reset = () => { viewRef.current.init = false; }; // re-frames to the explored bbox
  const centerRobot = () => {
    const v = viewRef.current;
    if (!pose) return;
    v.cx = pose.x;
    v.cy = pose.y;
    v.k = Math.max(v.k, 2.6);
    v.init = true;
  };

  if (!expanded) {
    return (
      <button type="button" className="map-btn map-expand" onClick={onExpand}
        title="Expand map" aria-label="Expand map">
        <ExpandIcon />
      </button>
    );
  }

  return (
    <>
      <button type="button" className="map-btn map-close" onClick={onClose}
        title="Close (Esc)" aria-label="Close map">
        <CloseIcon />
      </button>
      <div className="map-controls" role="toolbar" aria-label="Map view controls">
        <button type="button" className="map-btn" onClick={zoom(K_STEP)} title="Zoom in" aria-label="Zoom in"><PlusIcon /></button>
        <button type="button" className="map-btn" onClick={zoom(1 / K_STEP)} title="Zoom out" aria-label="Zoom out"><MinusIcon /></button>
        <span className="map-ctl-sep" />
        <button type="button" className="map-btn" onClick={rotate(-R_STEP)} title="Rotate left" aria-label="Rotate left"><RotLeftIcon /></button>
        <button type="button" className="map-btn" onClick={rotate(R_STEP)} title="Rotate right" aria-label="Rotate right"><RotRightIcon /></button>
        <span className="map-ctl-sep" />
        <button type="button" className="map-btn" onClick={centerRobot} title="Center on robot" aria-label="Center on robot" disabled={!pose}><TargetIcon /></button>
        <button type="button" className="map-btn" onClick={reset} title="Reset view (fit)" aria-label="Reset view"><FitIcon /></button>
      </div>
    </>
  );
}
