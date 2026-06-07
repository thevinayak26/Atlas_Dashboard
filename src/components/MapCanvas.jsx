// ─────────────────────────────────────────────────────────────────────────────
// MapCanvas.jsx — PHASE 1 (spec §7 Map, §9, §10).
// Renders the real /map OccupancyGrid to a canvas, overlays /scan as points, and
// draws the robot marker from /robot_pose. "Ugly is fine" per Golden Rule 2 —
// the mockup aesthetic is applied in Phase 3.
//
// OccupancyGrid decode + Y-flip are reused verbatim from
// design/prototype_map_renderer.html: ROS map origin is bottom-left, canvas y is
// top-down, so row y maps to (height-1-y). The grid is rasterised once per /map
// message into an offscreen bitmap (cached, §10 "don't re-render every frame");
// scan + robot are drawn each animation frame on top using a single world→screen
// transform derived from the map's origin/resolution so everything lines up.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';
import { TOPICS, SUB_OPTS } from '../ros/topics';

// Dark-theme map colours pulled from dashboard_mockup_v2.html (move to CSS vars
// in the Phase 3 styling pass).
const COLOR = {
  unknown: [38, 45, 55],   // #262d37
  free:    [22, 27, 34],   // #161b22
  wall:    [223, 230, 236],// #dfe6ec
  lidar:   '#56b6e0',      // --sky
  robot:   '#2dd4bf',      // --accent
  inset:   '#0f1216',
};

function quatToYaw(q) {
  if (!q) return 0;
  const { x = 0, y = 0, z = 0, w = 1 } = q;
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

export default function MapCanvas({ ros, status }) {
  const canvasRef = useRef(null);
  const bitmapRef = useRef(null);   // offscreen canvas holding the rasterised grid
  const mapMetaRef = useRef(null);  // { width, height, resolution, originX, originY }
  const scanRef = useRef(null);     // latest LaserScan
  const poseRef = useRef(null);     // latest { x, y, yaw }
  const rafRef = useRef(0);
  const [pose, setPose] = useState(null); // for the on-screen readout

  // ---- rasterise an OccupancyGrid into an offscreen canvas (reused decode) ----
  const rasterize = (msg) => {
    const w = msg.info.width, h = msg.info.height, data = msg.data;
    let off = bitmapRef.current;
    if (!off || off.width !== w || off.height !== h) {
      off = document.createElement('canvas');
      off.width = w; off.height = h;
      bitmapRef.current = off;
    }
    const octx = off.getContext('2d');
    const img = octx.createImageData(w, h);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      const c = v < 0 ? COLOR.unknown : v >= 65 ? COLOR.wall : COLOR.free;
      // flip Y so the map isn't upside-down (ROS origin is bottom-left)
      const x = i % w, y = h - 1 - Math.floor(i / w);
      const p = (y * w + x) * 4;
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    mapMetaRef.current = {
      width: w, height: h, resolution: msg.info.resolution,
      originX: msg.info.origin.position.x, originY: msg.info.origin.position.y,
    };
  };

  // ---- world (metres, map frame) → screen pixel, matching the flipped bitmap --
  const makeTransform = (cssW, cssH) => {
    const m = mapMetaRef.current;
    if (!m) return null;
    const s = Math.min(cssW / m.width, cssH / m.height); // screen px per grid cell
    const offX = (cssW - m.width * s) / 2;
    const offY = (cssH - m.height * s) / 2;
    return {
      s, offX, offY, meta: m,
      toScreen(wx, wy) {
        const gpx = (wx - m.originX) / m.resolution;            // grid px, x →
        const gpy = m.height - (wy - m.originY) / m.resolution; // grid px, y flipped
        return [offX + gpx * s, offY + gpy * s];
      },
    };
  };

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = COLOR.inset;
    ctx.fillRect(0, 0, cssW, cssH);

    const T = makeTransform(cssW, cssH);
    const bmp = bitmapRef.current;
    if (T && bmp) {
      // draw the cached grid bitmap, scaled, no smoothing (crisp cells)
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bmp, T.offX, T.offY, T.meta.width * T.s, T.meta.height * T.s);

      const p = poseRef.current;

      // ---- /scan overlay as points (range+angle → world via robot pose) ----
      const scan = scanRef.current;
      if (scan && p) {
        ctx.fillStyle = COLOR.lidar;
        const { angle_min, angle_increment, ranges, range_max } = scan;
        for (let i = 0; i < ranges.length; i++) {
          const r = ranges[i];
          if (!Number.isFinite(r) || r <= 0 || r >= range_max) continue;
          const ang = p.yaw + angle_min + i * angle_increment;
          const wx = p.x + r * Math.cos(ang);
          const wy = p.y + r * Math.sin(ang);
          const [sx, sy] = T.toScreen(wx, wy);
          ctx.fillRect(sx - 1, sy - 1, 2, 2);
        }
      }

      // ---- robot marker from /robot_pose (oriented triangle) ----
      if (p) {
        const [sx, sy] = T.toScreen(p.x, p.y);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(-p.yaw); // screen y is down → negate world (CCW) yaw
        ctx.fillStyle = COLOR.robot;
        ctx.strokeStyle = COLOR.inset;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(12, 0); ctx.lineTo(-8, -8); ctx.lineTo(-3, 0); ctx.lineTo(-8, 8);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = COLOR.robot + '55';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, 15, 0, Math.PI * 2); ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#646e7b';
      ctx.font = '13px monospace';
      ctx.fillText('awaiting /map …', 16, 24);
    }
    rafRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    if (status !== 'connected') return undefined;

    const mapTopic = new ROSLIB.Topic({
      ros, name: TOPICS.map.name, messageType: TOPICS.map.type, ...SUB_OPTS.map,
    });
    const scanTopic = new ROSLIB.Topic({
      ros, name: TOPICS.scan.name, messageType: TOPICS.scan.type, ...SUB_OPTS.scan,
    });
    const poseTopic = new ROSLIB.Topic({
      ros, name: TOPICS.robotPose.name, messageType: TOPICS.robotPose.type,
    });

    mapTopic.subscribe((msg) => rasterize(msg));
    scanTopic.subscribe((msg) => { scanRef.current = msg; });
    poseTopic.subscribe((msg) => {
      const pos = msg.pose.position;
      const yaw = quatToYaw(msg.pose.orientation);
      poseRef.current = { x: pos.x, y: pos.y, yaw };
      setPose({ x: pos.x, y: pos.y, yaw });
    });

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      try { mapTopic.unsubscribe(); } catch { /* gone */ }
      try { scanTopic.unsubscribe(); } catch { /* gone */ }
      try { poseTopic.unsubscribe(); } catch { /* gone */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ros, status]);

  const deg = pose ? (pose.yaw * 180 / Math.PI) : 0;
  const fmt = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: COLOR.inset, borderRadius: 12, overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute', top: 12, left: 14, fontFamily: 'monospace', fontSize: 11,
        color: '#9aa4b1', background: 'rgba(45,212,191,.14)', padding: '6px 11px', borderRadius: 8,
      }}>
        {pose
          ? `X ${fmt(pose.x)} · Y ${fmt(pose.y)} · θ ${(deg >= 0 ? '+' : '') + deg.toFixed(1)}°`
          : 'pose: awaiting /robot_pose'}
      </div>
      <div style={{
        position: 'absolute', bottom: 12, left: 14, display: 'flex', gap: 13,
        fontFamily: 'monospace', fontSize: 10, color: '#9aa4b1',
      }}>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, background: '#dfe6ec', borderRadius: 2, marginRight: 4 }} />Wall</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, background: '#161b22', borderRadius: 2, marginRight: 4 }} />Free</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, background: '#262d37', borderRadius: 2, marginRight: 4 }} />Unknown</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, background: COLOR.lidar, borderRadius: 2, marginRight: 4 }} />LiDAR</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, background: COLOR.robot, borderRadius: 2, marginRight: 4 }} />Robot</span>
      </div>
    </div>
  );
}
