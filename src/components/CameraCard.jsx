// -----------------------------------------------------------------------------
// CameraCard.jsx - Camera tile.
//
// HONESTY (spec §1): the camera isn't wired yet (TOPICS.camera.status === 'later'),
// so the header reads "offline" - NOT a fabricated "640×480 · 15 fps", which would
// be a made-up spec for hardware that isn't streaming. The <img> path is ready for
// the day a web_video_server MJPEG stream exists: flip the topic status to 'live'
// and it renders the real feed (and could surface the stream's real resolution),
// falling back to the placeholder on any load error.
//
// Expand-to-fullscreen: like the map card, the card carries a ⤢ control that morphs
// the camera view out to fill the viewport (Esc or ✕ to close). The camera has no
// canvas/ROS state to preserve, so this is a plain body-portaled overlay rendered
// only while expanded - much simpler than the map's docked stage, same affordance.
// -----------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { TOPICS, cameraUrl } from '../ros/topics';
import GlassSurface from './GlassSurface';
import GlowCard from './GlowCard';

const I = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const ExpandIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...I}>
    <path d="M8 3H4a1 1 0 0 0-1 1v4M16 3h4a1 1 0 0 1 1 1v4M8 21H4a1 1 0 0 1-1-1v-4M16 21h4a1 1 0 0 0 1-1v-4" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...I}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// The camera surface itself - shared verbatim between the docked card and the
// fullscreen overlay so they can never drift apart.
function CamView({ expectLive, live, setLive, today, big }) {
  return (
    <div className={'camview' + (big ? ' big' : '')}>
      {expectLive && (
        <img
          src={cameraUrl()}
          alt="camera feed"
          onLoad={() => setLive(true)}
          onError={() => setLive(false)}
          style={{ display: live ? 'block' : 'none' }}
        />
      )}
      {!live && (
        <>
          <div className="camnoise" />
          <div className="camstatus">
            <span className="d" />
            NO&nbsp;SIGNAL
          </div>
          <div className="camchrome">
            <span className="ccorner tl" />
            <span className="ccorner tr" />
            <span className="ccorner bl" />
            <span className="ccorner br" />
          </div>
          <div className="camcenter">
            <GlassSurface
              width={big ? 360 : 244}
              height={big ? 190 : 134}
              borderRadius={16}
              blur={9}
              displace={1}
              distortionScale={-120}
              brightness={60}
              backgroundOpacity={0.12}
              saturation={1.3}
            >
              <div className="cam-glass-inner">
                <div className="big">Awaiting feed</div>
                <div className="sub">CAMERA · {today}</div>
                <div className="chip">camera not installed</div>
              </div>
            </GlassSurface>
          </div>
        </>
      )}
      {live && (
        <div className="camstatus live">
          <span className="d" />
          LIVE
        </div>
      )}
    </div>
  );
}

export default function CameraCard({ theme }) {
  const expectLive = TOPICS.camera.status === 'live';
  const [live, setLive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const today = new Date()
    .toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' })
    .toUpperCase();

  // Esc closes; lock background scroll while the overlay is up (mirrors MapCard).
  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setExpanded(false); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  const shared = { expectLive, live, setLive, today };

  return (
    <GlowCard id="c-cam" theme={theme}>
      <div className="head">
        <span className={'ic' + (live ? '' : ' off')} />
        <h2>Camera</h2>
        <span className="r">{live ? 'live feed' : 'offline · no stream'}</span>
      </div>
      <div className="cam-slot">
        <CamView {...shared} big={false} />
        <button
          type="button"
          className="map-btn cam-expand"
          onClick={() => setExpanded(true)}
          title="Expand camera"
          aria-label="Expand camera"
        >
          <ExpandIcon />
        </button>
      </div>

      {expanded &&
        createPortal(
          <div className="cam-stage" role="dialog" aria-label="Camera (fullscreen)">
            <button
              type="button"
              className="map-btn cam-close"
              onClick={() => setExpanded(false)}
              title="Close (Esc)"
              aria-label="Close camera"
            >
              <CloseIcon />
            </button>
            <CamView {...shared} big />
          </div>,
          document.body,
        )}
    </GlowCard>
  );
}
