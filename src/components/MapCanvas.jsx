// ─────────────────────────────────────────────────────────────────────────────
// MapCanvas.jsx — the live SLAM map (spec §7 Map, §9, §10).
//
// Renders the real /map OccupancyGrid to a canvas and overlays, every animation
// frame, the live /scan (rays + points), the robot's travelled trail, frontier
// markers, and the oriented robot marker from /robot_pose. It is the ONLY
// subscriber to /map, /scan and /robot_pose, and it does double duty: alongside
// rendering it derives coverage %, frontier count, scan Hz and pose, and reports
// them upward (throttled) via onStats so the telemetry/health tiles don't have to
// re-subscribe.
//
// Implementation note: every imperative routine lives INSIDE the subscription
// effect, closing over per-connection state. Nothing imperative runs in the
// render phase — that keeps the React-Compiler lints satisfied and the hot path
// (canvas) completely off React's state cycle (§10 "don't re-render every frame").
//
// Performance: the OccupancyGrid is rasterised into an offscreen bitmap once per
// /map message (1 Hz), cached, and re-rasterised only on a theme change (colours
// come from CSS vars). Per-frame work is just compositing + a few hundred points.
//
// Y-flip note: ROS map origin is bottom-left, canvas y is top-down, so grid row
// y maps to (height-1-y); the world→screen transform applies the same flip.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react';
import * as ROSLIB from 'roslib';
import { TOPICS, SUB_OPTS } from '../ros/topics';
import { quatToYaw } from '../lib/geometry';

const PAD = 22;          // px gutter around the fitted map
const TRAIL_MAX = 400;   // trail points kept
const REPORT_MS = 400;   // how often derived stats are pushed upward

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export default function MapCanvas({ ros, status, theme, onStats }) {
  const canvasRef = useRef(null);
  const dirtyRef = useRef(false); // theme changed → bitmap needs re-rasterising

  // A theme flip changes the map colours; flag it and let the rAF loop re-raster
  // the cached map message (no resubscribe, no render-phase work).
  useEffect(() => {
    dirtyRef.current = true;
  }, [theme]);

  useEffect(() => {
    if (status !== 'connected') return undefined;

    // ---- per-connection state (closure, never touches React) ----
    let bitmap = null;     // offscreen canvas with the rasterised grid
    let mapMsg = null;     // last raw /map (for re-raster on theme change)
    let meta = null;       // { width, height, resolution, originX, originY }
    let scan = null;       // latest LaserScan
    let pose = null;       // latest { x, y, yaw }
    let frontiers = [];    // [[wx, wy], …] cluster centroids
    let coverage = null;   // %
    let frontierCount = null;
    const trail = [];      // [[wx, wy], …]
    const scanRate = { last: 0, hz: 0, lastSeen: 0 };
    let raf = 0;
    let lastReport = 0;

    const detectFrontiers = (data, w, h, info) => {
      const isFree = (i) => data[i] >= 0 && data[i] < 65;
      const isUnknown = (i) => data[i] < 0;
      const frontier = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!isFree(i)) continue;
          const nb = [x > 0 && i - 1, x < w - 1 && i + 1, y > 0 && i - w, y < h - 1 && i + w];
          if (nb.some((j) => j !== false && isUnknown(j))) frontier[i] = 1;
        }
      }
      const seen = new Uint8Array(w * h);
      const centroids = [];
      const stack = [];
      for (let s = 0; s < frontier.length; s++) {
        if (!frontier[s] || seen[s]) continue;
        stack.length = 0;
        stack.push(s);
        seen[s] = 1;
        let sx = 0;
        let sy = 0;
        let n = 0;
        while (stack.length) {
          const i = stack.pop();
          const x = i % w;
          const y = (i / w) | 0;
          sx += x;
          sy += y;
          n++;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const j = ny * w + nx;
              if (frontier[j] && !seen[j]) {
                seen[j] = 1;
                stack.push(j);
              }
            }
          }
        }
        if (n >= 3) {
          centroids.push([
            info.origin.position.x + (sx / n + 0.5) * info.resolution,
            info.origin.position.y + (sy / n + 0.5) * info.resolution,
          ]);
        }
      }
      frontiers = centroids;
      frontierCount = centroids.length;
    };

    const rasterize = (msg) => {
      mapMsg = msg;
      const w = msg.info.width;
      const h = msg.info.height;
      const data = msg.data;
      if (!bitmap || bitmap.width !== w || bitmap.height !== h) {
        bitmap = document.createElement('canvas');
        bitmap.width = w;
        bitmap.height = h;
      }
      const octx = bitmap.getContext('2d');
      const img = octx.createImageData(w, h);
      const cUnknown = hexToRgb(cssVar('--map-unknown'));
      const cFree = hexToRgb(cssVar('--map-free'));
      const cWall = hexToRgb(cssVar('--map-wall'));
      let known = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v >= 0) known++;
        const c = v < 0 ? cUnknown : v >= 65 ? cWall : cFree;
        const x = i % w;
        const y = h - 1 - Math.floor(i / w); // flip Y
        const p = (y * w + x) * 4;
        img.data[p] = c[0];
        img.data[p + 1] = c[1];
        img.data[p + 2] = c[2];
        img.data[p + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      meta = {
        width: w,
        height: h,
        resolution: msg.info.resolution,
        originX: msg.info.origin.position.x,
        originY: msg.info.origin.position.y,
      };
      coverage = data.length ? Math.round((known / data.length) * 100) : 0;
      detectFrontiers(data, w, h, msg.info);
    };

    const makeTransform = (cssW, cssH) => {
      if (!meta) return null;
      const s = Math.min((cssW - PAD * 2) / meta.width, (cssH - PAD * 2) / meta.height);
      const offX = (cssW - meta.width * s) / 2;
      const offY = (cssH - meta.height * s) / 2;
      return {
        s,
        offX,
        offY,
        toScreen(wx, wy) {
          const gpx = (wx - meta.originX) / meta.resolution;
          const gpy = meta.height - (wy - meta.originY) / meta.resolution;
          return [offX + gpx * s, offY + gpy * s];
        },
      };
    };

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        raf = requestAnimationFrame(draw);
        return;
      }
      if (dirtyRef.current && mapMsg) {
        rasterize(mapMsg);
        dirtyRef.current = false;
      }
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
        canvas.width = cssW * dpr;
        canvas.height = cssH * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const inset = cssVar('--inset');
      ctx.fillStyle = inset;
      ctx.fillRect(0, 0, cssW, cssH);

      const T = makeTransform(cssW, cssH);
      if (T && bitmap) {
        const accent = cssVar('--accent');
        const sky = cssVar('--sky');
        const gold = cssVar('--gold');

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bitmap, T.offX, T.offY, meta.width * T.s, meta.height * T.s);

        // /scan: faint rays + glowing laser points
        if (scan && pose) {
          const { angle_min, angle_increment, ranges, range_max } = scan;
          const [rpx, rpy] = T.toScreen(pose.x, pose.y);
          ctx.strokeStyle = sky + '2e';
          ctx.lineWidth = 1;
          ctx.beginPath();
          const pts = [];
          for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];
            if (!Number.isFinite(r) || r <= 0 || r >= range_max) continue;
            const ang = pose.yaw + angle_min + i * angle_increment;
            const [sx, sy] = T.toScreen(pose.x + r * Math.cos(ang), pose.y + r * Math.sin(ang));
            ctx.moveTo(rpx, rpy);
            ctx.lineTo(sx, sy);
            pts.push([sx, sy]);
          }
          ctx.stroke();
          // Additive blend + glow so overlapping returns bloom like a real laser.
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.shadowColor = sky;
          ctx.shadowBlur = 9;
          ctx.fillStyle = sky;
          for (const [sx, sy] of pts) {
            ctx.beginPath();
            ctx.arc(sx, sy, 2.3, 0, 7);
            ctx.fill();
          }
          // bright hot core
          ctx.shadowBlur = 0;
          ctx.fillStyle = 'rgba(220,245,255,0.9)';
          for (const [sx, sy] of pts) {
            ctx.beginPath();
            ctx.arc(sx, sy, 0.9, 0, 7);
            ctx.fill();
          }
          ctx.restore();
        }

        // travelled trail
        if (trail.length > 1) {
          ctx.strokeStyle = accent + '88';
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          ctx.beginPath();
          for (let i = 0; i < trail.length; i++) {
            const [sx, sy] = T.toScreen(trail[i][0], trail[i][1]);
            if (i) ctx.lineTo(sx, sy);
            else ctx.moveTo(sx, sy);
          }
          ctx.stroke();
        }

        // frontier markers
        for (const [fx, fy] of frontiers) {
          const [sx, sy] = T.toScreen(fx, fy);
          ctx.fillStyle = gold;
          ctx.beginPath();
          ctx.arc(sx, sy, 3, 0, 7);
          ctx.fill();
          ctx.strokeStyle = gold + '55';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(sx, sy, 7, 0, 7);
          ctx.stroke();
        }

        // robot marker
        if (pose) {
          const [sx, sy] = T.toScreen(pose.x, pose.y);
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(-pose.yaw); // screen y is down → negate world (CCW) yaw
          ctx.fillStyle = accent;
          ctx.strokeStyle = inset;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(12, 0);
          ctx.lineTo(-8, -8);
          ctx.lineTo(-3, 0);
          ctx.lineTo(-8, 8);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          ctx.strokeStyle = accent + '33';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, 15, 0, 7);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = cssVar('--dim');
        ctx.font = '13px monospace';
        ctx.fillText('awaiting /map …', 16, 24);
      }

      // push derived stats upward (throttled)
      const now = performance.now();
      if (now - lastReport > REPORT_MS) {
        lastReport = now;
        onStats({
          pose,
          coverage,
          frontiers: frontierCount,
          scanHz: scanRate.lastSeen && now - scanRate.lastSeen < 1500 ? scanRate.hz : null,
        });
      }

      raf = requestAnimationFrame(draw);
    };

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
    scanTopic.subscribe((msg) => {
      scan = msg;
      const now = performance.now();
      if (scanRate.last) {
        const dt = (now - scanRate.last) / 1000;
        if (dt > 0) scanRate.hz = scanRate.hz ? scanRate.hz + 0.25 * (1 / dt - scanRate.hz) : 1 / dt;
      }
      scanRate.last = now;
      scanRate.lastSeen = now;
    });
    poseTopic.subscribe((msg) => {
      const p = msg.pose.position;
      pose = { x: p.x, y: p.y, yaw: quatToYaw(msg.pose.orientation) };
      const lastPt = trail[trail.length - 1];
      if (!lastPt || Math.hypot(p.x - lastPt[0], p.y - lastPt[1]) > 0.02) {
        trail.push([p.x, p.y]);
        if (trail.length > TRAIL_MAX) trail.shift();
      }
    });

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      try { mapTopic.unsubscribe(); } catch { /* gone */ }
      try { scanTopic.unsubscribe(); } catch { /* gone */ }
      try { poseTopic.unsubscribe(); } catch { /* gone */ }
    };
  }, [ros, status, onStats]);

  return <canvas id="map" ref={canvasRef} />;
}
