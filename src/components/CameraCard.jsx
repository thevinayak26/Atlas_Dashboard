// -----------------------------------------------------------------------------
// CameraCard.jsx - Camera tile.
//
// HONESTY (spec §1): the camera isn't wired yet (TOPICS.camera.status === 'later'),
// so the header reads "offline" - NOT a fabricated "640×480 · 15 fps", which would
// be a made-up spec for hardware that isn't streaming. The <img> path is ready for
// the day a web_video_server MJPEG stream exists: flip the topic status to 'live'
// and it renders the real feed (and could surface the stream's real resolution),
// falling back to the placeholder on any load error.
// -----------------------------------------------------------------------------
import { useState } from 'react';
import { TOPICS, cameraUrl } from '../ros/topics';
import GlassSurface from './GlassSurface';
import GlowCard from './GlowCard';

export default function CameraCard({ theme }) {
  const expectLive = TOPICS.camera.status === 'live';
  const [live, setLive] = useState(false);
  const today = new Date()
    .toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' })
    .toUpperCase();

  return (
    <GlowCard id="c-cam" theme={theme}>
      <div className="head">
        <span className={'ic' + (live ? '' : ' off')} />
        <h2>Camera</h2>
        <span className="r">{live ? 'live feed' : 'offline · no stream'}</span>
      </div>
      <div className="camview">
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
                width={244}
                height={134}
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
    </GlowCard>
  );
}
