// ─────────────────────────────────────────────────────────────────────────────
// MapCard.jsx — the Live Map card: header, the canvas (MapCanvas), the glass pose
// HUD, a loading overlay, and the legend. The legend lives in a footer bar below
// the canvas (not floating over it) so it never overlaps the map as it fills in.
// ─────────────────────────────────────────────────────────────────────────────
import MapCanvas from './MapCanvas';
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

export default function MapCard({ ros, status, theme, pose, coverage, loading, onStats }) {
  const poseText = pose
    ? `X ${signed(pose.x)} · Y ${signed(pose.y)} · θ ${signed(toDeg(pose.yaw), 1)}°`
    : null;
  const mapWaiting = loading || coverage == null;
  return (
    <GlowCard id="c-map" theme={theme}>
      <div className="head">
        <span className="ic" />
        <h2>Live Map</h2>
        <span className="r">slam_toolbox · odom→base_link [EKF]</span>
      </div>
      <div id="mapBox">
        {/* Liquid-glass pose readout — refracts the live map behind it. */}
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
        <MapCanvas ros={ros} status={status} theme={theme} onStats={onStats} />
      </div>
      <div className="map-legend">
        {LEGEND.map(([bg, label]) => (
          <span className="lg" key={label}>
            <span className="sw" style={{ background: bg }} />
            {label}
          </span>
        ))}
      </div>
    </GlowCard>
  );
}
