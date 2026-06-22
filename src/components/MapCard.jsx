// -----------------------------------------------------------------------------
// MapCard.jsx - the Live Map card: header, the navigable map surface (MapCanvas),
// the glass pose HUD, the camera toolbar, a loading overlay, and the legend.
//
// Expand-to-fullscreen: the map "stage" (canvas + HUD + controls) is a SINGLE
// element portaled to <body> and position:fixed. While docked it is glued to an
// in-card placeholder (#mapBox) via getBoundingClientRect; tapping it (or the ⤢
// button) flips `expanded`, which morphs the same element out to fill the viewport
// with a ~320ms ease. Because the stage never unmounts, the MapCanvas keeps its
// ROS subscriptions AND its camera (the shared viewRef), so pan/zoom/rotate carry
// across expand/collapse with no reset and no re-subscribe flash. Escaping to <body>
// is required: the glass card sets backdrop-filter + transform, which would
// otherwise trap a fixed child inside the card instead of the viewport.
// -----------------------------------------------------------------------------
import { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import MapCanvas from './MapCanvas';
import MapControls from './MapControls';
import LayersControl from './LayersControl';
import GlassSurface from './GlassSurface';
import GlowCard from './GlowCard';
import Skeleton from './Skeleton';
import { toDeg, signed } from '../lib/geometry';

const LEGEND = [
  ['var(--map-wall)', 'Wall'],
  ['var(--map-free)', 'Free'],
  ['var(--map-unknown)', 'Unknown'],
  ['var(--sky)', 'LiDAR'],
  ['var(--accent)', 'Robot'],
  ['var(--gold)', 'Frontier'],
];

export default function MapCard({
  ros, status, theme, pose, coverage, loading, onStats, layers, onLayersChange,
}) {
  const [expanded, setExpanded] = useState(false);
  // The camera, owned here so it survives expand/collapse and the toolbar can drive it.
  const viewRef = useRef({ cx: 0, cy: 0, k: 1, phi: 0, init: false });
  const slotRef = useRef(null);   // in-card placeholder the stage docks onto
  const stageRef = useRef(null);  // the fixed, body-portaled stage element
  const didMount = useRef(false);

  const poseText = pose
    ? `X ${signed(pose.x)} · Y ${signed(pose.y)} · θ ${signed(toDeg(pose.yaw), 1)}°`
    : null;
  const mapWaiting = loading || coverage == null;

  // Manual "Download PNG" - snapshot the live map canvas as it's currently drawn.
  const downloadPng = useCallback(() => {
    const cv = document.getElementById('map');
    if (!cv) return;
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = `atlas-map-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
  }, []);

  // Glue the fixed stage to the slot (docked) or the viewport (expanded). No
  // transition during dock-tracking (resize/scroll) - only the toggle morphs.
  const syncRect = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (expanded) {
      stage.style.top = '0px';
      stage.style.left = '0px';
      stage.style.width = '100%';
      stage.style.height = '100%';
    } else if (slotRef.current) {
      const r = slotRef.current.getBoundingClientRect();
      stage.style.top = `${r.top}px`;
      stage.style.left = `${r.left}px`;
      stage.style.width = `${r.width}px`;
      stage.style.height = `${r.height}px`;
    }
  }, [expanded]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    // Animate the expand/collapse, but not the initial mount (which would slide
    // in from 0,0). The .morph class scopes the CSS transition to the toggle.
    const animate = didMount.current;
    didMount.current = true;
    let morphT;
    if (animate && stage) {
      // Enable the transition and COMMIT the pre-toggle rect first (forced
      // reflow), then move to the new rect so the browser interpolates rather
      // than snapping straight to the final value.
      stage.classList.add('morph');
      void stage.offsetWidth;
      syncRect();
      morphT = setTimeout(() => stage.classList.remove('morph'), 380);
    } else {
      syncRect();
    }

    if (expanded) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden'; // no background scroll behind fullscreen
      const onKey = (e) => { if (e.key === 'Escape') setExpanded(false); };
      window.addEventListener('keydown', onKey);
      window.addEventListener('resize', syncRect);
      return () => {
        clearTimeout(morphT);
        stage?.classList.remove('morph');
        document.body.style.overflow = prevOverflow;
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', syncRect);
      };
    }
    // Docked: re-read the slot rect every frame and re-glue only when it moved.
    // Scroll/resize listeners + ResizeObserver are NOT enough - the slot also
    // drifts under the cards' entrance rise animation (a transform on an
    // ancestor: same size, new position, no event), which left the stage
    // permanently offset by the animation delta. One rect read per frame is
    // cheap; the style write happens only on actual change.
    let raf = 0;
    let lastRect = '';
    const track = () => {
      const slot = slotRef.current;
      if (slot) {
        const r = slot.getBoundingClientRect();
        const key = `${r.top}|${r.left}|${r.width}|${r.height}`;
        if (key !== lastRect) {
          lastRect = key;
          syncRect();
        }
      }
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    return () => {
      clearTimeout(morphT);
      stage?.classList.remove('morph');
      cancelAnimationFrame(raf);
    };
  }, [expanded, syncRect]);

  const stage = createPortal(
    <div className="map-stage" ref={stageRef} data-expanded={expanded ? 'true' : 'false'}>
      <GlassSurface
        width={224}
        height={32}
        borderRadius={10}
        blur={10}
        displace={1}
        distortionScale={-130}
        brightness={62}
        backgroundOpacity={0.18}
        saturation={1.4}
        className="pose-glass"
        style={{ position: 'absolute', top: 14, left: 16, zIndex: 3 }}
      >
        {poseText ? (
          <span className="pose-readout">{poseText}</span>
        ) : (
          <Skeleton width={150} height={11} radius={4} />
        )}
      </GlassSurface>
      {mapWaiting && (
        <div className="map-skel">
          <div className="ring" />
          <div className="lbl">{loading ? 'connecting…' : 'awaiting /map'}</div>
        </div>
      )}
      <MapCanvas
        ros={ros}
        status={status}
        theme={theme}
        onStats={onStats}
        layers={layers}
        view={viewRef}
        expanded={expanded}
        onRequestExpand={() => setExpanded(true)}
      />
      <LayersControl
        layers={layers}
        onChange={onLayersChange}
        onDownloadPng={downloadPng}
      />
      <MapControls
        expanded={expanded}
        viewRef={viewRef}
        pose={pose}
        onExpand={() => setExpanded(true)}
        onClose={() => setExpanded(false)}
      />
      {expanded && (
        <div className="map-legend in-stage">
          {LEGEND.map(([bg, label]) => (
            <span className="lg" key={label}>
              <span className="sw" style={{ background: bg }} />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );

  return (
    <GlowCard id="c-map" theme={theme}>
      <div className="head">
        <span className="ic" />
        <h2>Live Map</h2>
        <span className="r">slam_toolbox · odom→base_link [EKF]</span>
      </div>
      {/* placeholder that reserves the map's layout slot; the real surface is the
          body-portaled stage glued to this rect (so it can morph to fullscreen). */}
      <div id="mapBox" ref={slotRef} />
      <div className="map-legend">
        {LEGEND.map(([bg, label]) => (
          <span className="lg" key={label}>
            <span className="sw" style={{ background: bg }} />
            {label}
          </span>
        ))}
      </div>
      {stage}
    </GlowCard>
  );
}
