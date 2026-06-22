// -----------------------------------------------------------------------------
// MapCanvas.jsx - the live SLAM map (spec §7 Map, §9, §10).
//
// Renders the real /map OccupancyGrid to a canvas and overlays, every animation
// frame, the live /scan (rays + points), the robot's travelled trail, frontier
// markers, and the oriented robot marker from /robot_pose. It is the ONLY
// subscriber to /map, /scan and /robot_pose, and it does double duty: alongside
// rendering it derives coverage %, frontier count, scan Hz and pose, and reports
// them upward (throttled) via onStats so the telemetry/health tiles don't have to
// re-subscribe.
//
// Camera (RViz-style navigation): a translate+scale+rotate view sits ON TOP of
// the aspect-fit. The whole camera is a small `view` object - { cx, cy (world
// point at viewport centre), k (zoom × fit), phi (rotation rad) } - held in a ref
// OWNED BY MapCard and passed in, so it survives expand→fullscreen→collapse and so
// the toolbar buttons can drive it. Drag pans, wheel zooms toward the cursor, two
// fingers pinch-zoom/rotate, a short tap (when docked) asks MapCard to expand.
//
// Implementation note: every imperative routine lives INSIDE the subscription
// effect, closing over per-connection state. Nothing imperative runs in the
// render phase - that keeps the React-Compiler lints satisfied and the hot path
// (canvas) completely off React's state cycle (§10 "don't re-render every frame").
//
// Performance: the OccupancyGrid is rasterised into an offscreen bitmap once per
// /map message (1 Hz), cached, and re-rasterised only on a theme change (colours
// come from CSS vars). Per-frame work is just one transformed drawImage + a few
// hundred points.
//
// Y-flip note: ROS map origin is bottom-left, canvas y is top-down, so grid row
// y maps to (height-1-y); world↔screen and screen↔world both apply the same flip.
// -----------------------------------------------------------------------------
import { useEffect, useRef } from 'react';
import * as ROSLIB from 'roslib';
import { TOPICS, SUB_OPTS } from '../ros/topics';
import { quatToYaw } from '../lib/geometry';

const PAD = 14;          // px gutter around the fitted map (at k = 1)
const TRAIL_MAX = 400;   // trail points kept
const REPORT_MS = 400;   // how often derived stats are pushed upward
const K_MIN = 0.35;      // zoom-out limit (× aspect-fit)
const K_MAX = 16;        // zoom-in limit
const TAP_PX = 8;        // pointer travel under this (and quick) = a tap, not a drag
const TAP_MS = 350;

// Layer visibility defaults (overridden by the persisted set passed from App).
const DEFAULT_LAYERS = { scan: true, frontiers: true, trail: true, robot: true, grid: false };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
// Lighten/darken an [r,g,b] by factor f (>1 lighter, <1 darker) → css rgb() string.
const shade = (rgb, f) => `rgb(${rgb.map((c) => Math.round(clamp(c * f, 0, 255))).join(',')})`;
const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

export default function MapCanvas({
  ros, status, theme, onStats, layers = DEFAULT_LAYERS,
  view: viewProp, expanded = false, onRequestExpand,
}) {
  const canvasRef = useRef(null);
  const dirtyRef = useRef(false); // theme changed → bitmap needs re-rasterising

  // The camera. Owned by MapCard when provided (so it persists across the
  // expand/collapse remount and the toolbar can mutate it); a local fallback
  // keeps MapCanvas usable standalone. `init` is set the first time we frame a map.
  const localView = useRef({ cx: 0, cy: 0, k: 1, phi: 0, init: false });
  const view = viewProp || localView;

  // Latest expand state / callback, read by the gesture closure without
  // re-subscribing ROS topics when they change. Synced in an effect (writing a
  // ref during render trips react-hooks/refs and isn't safe under the Compiler).
  const expandedRef = useRef(expanded);
  const requestExpandRef = useRef(onRequestExpand);
  useEffect(() => {
    expandedRef.current = expanded;
    requestExpandRef.current = onRequestExpand;
  }, [expanded, onRequestExpand]);

  // Layer visibility toggles, read by the draw loop via a ref so flipping one
  // doesn't tear down/rebuild the ROS subscriptions (mirrors expandedRef above).
  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  // A theme flip changes the map colours; flag it and let the rAF loop re-raster
  // the cached map message (no resubscribe, no render-phase work).
  useEffect(() => {
    dirtyRef.current = true;
  }, [theme]);

  useEffect(() => {
    if (status !== 'connected') return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    // ---- per-connection state (closure, never touches React) ----
    let bitmap = null;     // offscreen canvas with the rasterised grid
    let mapMsg = null;     // last raw /map (for re-raster on theme change)
    let meta = null;       // { width, height, resolution, originX, originY, known }
    let scan = null;       // latest LaserScan
    let pose = null;       // latest { x, y, yaw }
    let frontiers = [];    // [[wx, wy], …] cluster centroids
    let coverage = null;   // %
    let frontierCount = null;
    const trail = [];      // [[wx, wy], …]
    const scanRate = { last: 0, hz: 0, lastSeen: 0 };
    let raf = 0;
    let lastReport = 0;
    let lastT = null;      // most recent transform, for gesture hit-testing
    const pointers = new Map(); // active pointerId -> { x, y } in canvas px
    let gesture = null;    // { mode:'pan'|'pinch', … }

    // Cached theme colours: getComputedStyle is costly, so read the CSS vars ONCE
    // per theme change (flagged by dirtyRef) instead of ~8x every animation frame.
    let palette = null;
    const readPalette = () => ({
      inset: cssVar('--inset'),
      accent: cssVar('--accent'),
      sky: cssVar('--sky'),
      gold: cssVar('--gold'),
      cardEdge: cssVar('--card-edge'),
      dim: cssVar('--dim'),
    });

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
      const w = msg.info.width;
      const h = msg.info.height;
      const data = msg.data;
      // Defensive: a malformed / truncated grid (data.length ≠ w·h, or a non-array
      // payload from an exotic rosbridge transport) must not smear rows - treat
      // anything missing as unknown rather than indexing off the end.
      if (!data || typeof data.length !== 'number' || !w || !h) return;
      mapMsg = msg;
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
      // Bounding box of known (explored) cells, in bitmap pixel coords, so the
      // view can frame the actual map instead of the full grid (which often has
      // large unexplored padding off to one side - the "empty left band").
      let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
      const n = w * h;
      for (let i = 0; i < n; i++) {
        const v = i < data.length ? data[i] : -1;
        const c = v < 0 ? cUnknown : v >= 65 ? cWall : cFree;
        const x = i % w;
        const y = h - 1 - ((i / w) | 0); // flip Y
        if (v >= 0) {
          known++;
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
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
        // null until at least one known cell; falls back to full-grid framing
        known: bx1 >= bx0 ? { x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 } : null,
      };
      coverage = n ? Math.round((known / n) * 100) : 0;
      detectFrontiers(data, w, h, msg.info);
    };

    // world (m) ↔ bitmap pixel (y-down, matches the rasterised offscreen grid)
    const worldToPx = (wx, wy) => [
      (wx - meta.originX) / meta.resolution,
      meta.height - (wy - meta.originY) / meta.resolution,
    ];
    const setCenterFromPx = (cpx, cpy) => {
      view.current.cx = meta.originX + cpx * meta.resolution;
      view.current.cy = meta.originY + (meta.height - cpy) * meta.resolution;
    };

    const makeTransform = (cssW, cssH) => {
      if (!meta) return null;
      // Aspect-fit the explored region (known-cell bbox) so the map centres and
      // fills the surface; the camera (k, phi, centre) is layered on top.
      const b = meta.known || { x0: 0, y0: 0, x1: meta.width, y1: meta.height };
      const bw = b.x1 - b.x0;
      const bh = b.y1 - b.y0;
      const sFit = Math.min((cssW - PAD * 2) / bw, (cssH - PAD * 2) / bh);
      const v = view.current;
      if (!v.init) {
        // default view: centre of the explored bbox, fit scale, no rotation
        setCenterFromPx((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
        v.k = 1;
        v.phi = 0;
        v.init = true;
      }
      const s = sFit * clamp(v.k, K_MIN, K_MAX);
      const cosp = Math.cos(v.phi);
      const sinp = Math.sin(v.phi);
      const cpx = (v.cx - meta.originX) / meta.resolution;
      const cpy = meta.height - (v.cy - meta.originY) / meta.resolution;
      const Cx = cssW / 2;
      const Cy = cssH / 2;
      const px = (gpx, gpy) => {
        const ux = (gpx - cpx) * s;
        const uy = (gpy - cpy) * s;
        return [cosp * ux - sinp * uy + Cx, sinp * ux + cosp * uy + Cy];
      };
      return {
        s, sFit, cosp, sinp, cpx, cpy, Cx, Cy, phi: v.phi,
        px,
        toScreen(wx, wy) {
          const [gpx, gpy] = worldToPx(wx, wy);
          return px(gpx, gpy);
        },
      };
    };

    // ---- gesture helpers ----
    const screenToPx = (T, sx, sy) => {
      const ux = sx - T.Cx;
      const uy = sy - T.Cy;
      const rx = (T.cosp * ux + T.sinp * uy) / T.s; // rotate by -phi, undo scale
      const ry = (-T.sinp * ux + T.cosp * uy) / T.s;
      return [rx + T.cpx, ry + T.cpy];
    };
    // Re-centre so bitmap-px (gpx,gpy) lands at screen (sx,sy) for a given s, phi.
    const anchorPx = (gpx, gpy, sx, sy, s, phi) => {
      const cosp = Math.cos(phi);
      const sinp = Math.sin(phi);
      const ux = sx - lastT.Cx;
      const uy = sy - lastT.Cy;
      const rx = (cosp * ux + sinp * uy) / s;
      const ry = (-sinp * ux + cosp * uy) / s;
      setCenterFromPx(gpx - rx, gpy - ry);
    };

    const canvasXY = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    const onPointerDown = (e) => {
      if (!lastT || !meta) return;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const [x, y] = canvasXY(e);
      pointers.set(e.pointerId, { x, y });
      if (pointers.size === 1) {
        const [gpx, gpy] = screenToPx(lastT, x, y);
        gesture = { mode: 'pan', id: e.pointerId, gpx, gpy, downX: x, downY: y, downT: performance.now(), moved: false };
        canvas.style.cursor = 'grabbing';
      } else if (pointers.size === 2) {
        const it = [...pointers.entries()];
        const A0 = screenToPx(lastT, it[0][1].x, it[0][1].y);
        const A1 = screenToPx(lastT, it[1][1].x, it[1][1].y);
        gesture = { mode: 'pinch', ids: [it[0][0], it[1][0]], A0, A1, sFit: lastT.sFit };
      }
    };

    const onPointerMove = (e) => {
      if (!pointers.has(e.pointerId) || !lastT) return;
      const [x, y] = canvasXY(e);
      pointers.set(e.pointerId, { x, y });
      if (gesture && gesture.mode === 'pan' && pointers.size === 1) {
        if (Math.hypot(x - gesture.downX, y - gesture.downY) > TAP_PX) gesture.moved = true;
        anchorPx(gesture.gpx, gesture.gpy, x, y, lastT.s, view.current.phi);
      } else if (gesture && gesture.mode === 'pinch' && pointers.size >= 2) {
        const p0 = pointers.get(gesture.ids[0]);
        const p1 = pointers.get(gesture.ids[1]);
        if (!p0 || !p1) return;
        // Solve the similarity (scale·rotation·translation) that keeps both
        // grabbed world points under both fingers. z = (q0-q1)/(A0-A1) (complex);
        // |z| = scale, arg z = rotation; then centre from one anchor.
        const dqx = p0.x - p1.x;
        const dqy = p0.y - p1.y;
        const dAx = gesture.A0[0] - gesture.A1[0];
        const dAy = gesture.A0[1] - gesture.A1[1];
        const denom = dAx * dAx + dAy * dAy;
        if (denom < 1e-9) return;
        let zx = (dqx * dAx + dqy * dAy) / denom;
        let zy = (dqy * dAx - dqx * dAy) / denom;
        const phi = Math.atan2(zy, zx);
        let s = Math.hypot(zx, zy);
        const k = clamp(s / gesture.sFit, K_MIN, K_MAX);
        s = k * gesture.sFit;
        zx = s * Math.cos(phi);
        zy = s * Math.sin(phi);
        const ex = p0.x - lastT.Cx;
        const ey = p0.y - lastT.Cy;
        const s2 = s * s;
        const cpx = gesture.A0[0] - (ex * zx + ey * zy) / s2;
        const cpy = gesture.A0[1] - (ey * zx - ex * zy) / s2;
        view.current.k = k;
        view.current.phi = phi;
        view.current.init = true;
        setCenterFromPx(cpx, cpy);
      }
    };

    const endPointer = (e) => {
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      const wasPan = gesture && gesture.mode === 'pan' && gesture.id === e.pointerId;
      const tap = wasPan && !gesture.moved && performance.now() - gesture.downT < TAP_MS;
      pointers.delete(e.pointerId);
      if (tap && !expandedRef.current && requestExpandRef.current) {
        requestExpandRef.current(); // a clean tap on the docked map → expand
      }
      if (pointers.size === 1) {
        // dropped from pinch to one finger → resume panning with the remainder
        const [id, p] = [...pointers.entries()][0];
        const [gpx, gpy] = screenToPx(lastT, p.x, p.y);
        gesture = { mode: 'pan', id, gpx, gpy, downX: p.x, downY: p.y, downT: performance.now(), moved: true };
      } else if (pointers.size === 0) {
        gesture = null;
        canvas.style.cursor = 'grab';
      }
    };

    const onWheel = (e) => {
      if (!lastT || !meta) return;
      e.preventDefault();
      const [x, y] = canvasXY(e);
      const [gpx, gpy] = screenToPx(lastT, x, y);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const k = clamp(view.current.k * factor, K_MIN, K_MAX);
      view.current.k = k;
      view.current.init = true;
      anchorPx(gpx, gpy, x, y, lastT.sFit * k, view.current.phi); // keep cursor world fixed
    };

    const draw = () => {
      const cv = canvasRef.current;
      if (!cv) {
        raf = requestAnimationFrame(draw);
        return;
      }
      if (dirtyRef.current || !palette) {
        palette = readPalette(); // theme changed (or first frame): refresh colours
      }
      if (dirtyRef.current && mapMsg) {
        rasterize(mapMsg);
        dirtyRef.current = false;
      }
      const ctx = cv.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const cssW = cv.clientWidth;
      const cssH = cv.clientHeight;
      if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
        cv.width = Math.round(cssW * dpr);
        cv.height = Math.round(cssH * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const inset = palette.inset;
      ctx.fillStyle = inset;
      ctx.fillRect(0, 0, cssW, cssH);

      const T = makeTransform(cssW, cssH);
      lastT = T;
      const L = layersRef.current;
      if (T && bitmap) {
        const { accent, sky, gold } = palette;

        // The grid bitmap, under the full translate·rotate·scale camera.
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.translate(T.Cx, T.Cy);
        ctx.rotate(T.phi);
        ctx.scale(T.s, T.s);
        ctx.translate(-T.cpx, -T.cpy);
        ctx.drawImage(bitmap, 0, 0);
        ctx.restore();

        // Frame the explored region (rotates with the view) so the aspect-fit
        // gutters read as a deliberate display surface, not dead space.
        const b = meta.known || { x0: 0, y0: 0, x1: meta.width, y1: meta.height };
        const corners = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
        ctx.strokeStyle = palette.cardEdge;
        ctx.lineWidth = 1;
        ctx.beginPath();
        corners.forEach(([gx, gy], i) => {
          const [sx, sy] = T.px(gx, gy);
          if (i) ctx.lineTo(sx, sy);
          else ctx.moveTo(sx, sy);
        });
        ctx.closePath();
        ctx.stroke();

        // optional metric grid (1 m spacing), faint, aligned to the map cells
        if (L.grid) {
          const stepPx = Math.max(1, Math.round(1 / meta.resolution));
          ctx.strokeStyle = accent + '24';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let gx = Math.ceil(b.x0 / stepPx) * stepPx; gx <= b.x1; gx += stepPx) {
            const [lx0, ly0] = T.px(gx, b.y0);
            const [lx1, ly1] = T.px(gx, b.y1);
            ctx.moveTo(lx0, ly0); ctx.lineTo(lx1, ly1);
          }
          for (let gy = Math.ceil(b.y0 / stepPx) * stepPx; gy <= b.y1; gy += stepPx) {
            const [lx0, ly0] = T.px(b.x0, gy);
            const [lx1, ly1] = T.px(b.x1, gy);
            ctx.moveTo(lx0, ly0); ctx.lineTo(lx1, ly1);
          }
          ctx.stroke();
        }

        // /scan: faint rays + glowing laser points
        if (scan && pose && L.scan) {
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
          // Additive blend so overlapping returns bloom like a real laser. NO
          // per-point shadowBlur (it's the single most expensive canvas op and we
          // draw hundreds of points/frame) - the glow comes from a translucent
          // halo under 'lighter' plus a bright core.
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = sky + '55';
          for (const [sx, sy] of pts) {
            ctx.beginPath();
            ctx.arc(sx, sy, 3, 0, 7);
            ctx.fill();
          }
          // bright hot core
          ctx.fillStyle = 'rgba(220,245,255,0.9)';
          for (const [sx, sy] of pts) {
            ctx.beginPath();
            ctx.arc(sx, sy, 1, 0, 7);
            ctx.fill();
          }
          ctx.restore();
        }

        // travelled trail
        if (trail.length > 1 && L.trail) {
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

        // frontier markers (toggleable)
        if (L.frontiers) for (const [fx, fy] of frontiers) {
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

        // robot marker - a 2.5D rover (shaded chassis + drop shadow + heading
        // wedge), rotated by heading and the view. Toggleable via the layers panel.
        if (pose && L.robot) {
          const [sx, sy] = T.toScreen(pose.x, pose.y);
          const aRgb = hexToRgb(accent);
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(T.phi - pose.yaw); // screen y down → negate world (CCW) yaw, add view spin
          // soft ground shadow - the "lift" that reads as 2.5D
          ctx.fillStyle = 'rgba(0,0,0,0.32)';
          ctx.beginPath();
          ctx.ellipse(1.5, 3, 13, 9, 0, 0, 7);
          ctx.fill();
          // chassis: rounded body with a top-lit gradient
          const grad = ctx.createLinearGradient(0, -8, 0, 8);
          grad.addColorStop(0, shade(aRgb, 1.4));
          grad.addColorStop(1, shade(aRgb, 0.82));
          ctx.fillStyle = grad;
          ctx.strokeStyle = inset;
          ctx.lineWidth = 1.5;
          roundRect(ctx, -10, -7, 20, 14, 4);
          ctx.fill();
          ctx.stroke();
          // heading wedge at the front (+x), brighter
          ctx.fillStyle = shade(aRgb, 1.65);
          ctx.beginPath();
          ctx.moveTo(11, 0);
          ctx.lineTo(3, -4.5);
          ctx.lineTo(3, 4.5);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          // heading ring
          ctx.strokeStyle = accent + '33';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, 17, 0, 7);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = palette.dim;
        ctx.font = '13px monospace';
        ctx.fillText('awaiting /map ...', 16, 24);
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

    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endPointer);
      canvas.removeEventListener('pointercancel', endPointer);
      canvas.removeEventListener('wheel', onWheel);
      try { mapTopic.unsubscribe(); } catch { /* gone */ }
      try { scanTopic.unsubscribe(); } catch { /* gone */ }
      try { poseTopic.unsubscribe(); } catch { /* gone */ }
    };
  }, [ros, status, onStats, view]);

  return <canvas id="map" ref={canvasRef} />;
}
