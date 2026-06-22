// -----------------------------------------------------------------------------
// RadarCard.jsx - a robot-centric polar "radar" view of the live /scan.
//
// Pose-INDEPENDENT: it plots raw LaserScan ranges around the robot (forward = up),
// so it shows the LiDAR the instant scans arrive - no /robot_pose, no /map framing,
// no dependence on MapCanvas. It keeps its OWN throttled /scan subscription (a
// second rosbridge sub is cheap and keeps this card self-contained). Range rings +
// a rotating sweep give it the classic radar read.
// -----------------------------------------------------------------------------
import { useEffect, useRef } from 'react';
import * as ROSLIB from 'roslib';
import { TOPICS, SUB_OPTS } from '../ros/topics';
import GlowCard from './GlowCard';

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export default function RadarCard({ ros, status, theme }) {
  const canvasRef = useRef(null);
  // theme read by the draw loop via a ref so a flip doesn't resubscribe /scan
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  useEffect(() => {
    if (status !== 'connected') return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let scan = null;
    let sweep = 0;
    let raf = 0;
    let palette = null;
    let lastTheme = null;

    const scanTopic = new ROSLIB.Topic({
      ros, name: TOPICS.scan.name, messageType: TOPICS.scan.type, ...SUB_OPTS.scan,
    });
    scanTopic.subscribe((msg) => { scan = msg; });

    const draw = () => {
      const cv = canvasRef.current;
      if (!cv) { raf = requestAnimationFrame(draw); return; }
      const ctx = cv.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      if (!W || !H) { raf = requestAnimationFrame(draw); return; }
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) / 2 - 8;
      if (palette === null || themeRef.current !== lastTheme) {
        lastTheme = themeRef.current;
        palette = {
          accent: cssVar('--accent'),
          sky: cssVar('--sky'),
          ring: cssVar('--hair'),
          dim: cssVar('--dim'),
        };
      }
      const { accent, sky, ring, dim } = palette;
      const rmax = scan && scan.range_max ? scan.range_max : 5;

      // range rings + radial spokes
      ctx.strokeStyle = ring;
      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (R * i) / 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
      }
      ctx.stroke();

      // rotating sweep beam with a fading trail (forward = up, clockwise)
      sweep = (sweep + 0.035) % (Math.PI * 2);
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = accent;
      for (let i = 0; i < 16; i++) {
        const th = sweep - i * 0.045;
        ctx.globalAlpha = (1 - i / 16) * 0.4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.sin(th) * R, cy - Math.cos(th) * R);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      // laser returns
      if (scan) {
        const { angle_min, angle_increment, ranges, range_max } = scan;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = sky;
        for (let i = 0; i < ranges.length; i++) {
          const r = ranges[i];
          if (!Number.isFinite(r) || r <= 0 || r >= range_max) continue;
          const ang = angle_min + i * angle_increment;
          const px = cx + (r / rmax) * R * Math.sin(ang);
          const py = cy - (r / rmax) * R * Math.cos(ang);
          ctx.beginPath();
          ctx.arc(px, py, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // robot at centre
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // outer-ring range label
      ctx.fillStyle = dim;
      ctx.font = '9px monospace';
      ctx.fillText(`${rmax.toFixed(1)} m`, cx + 4, cy - R + 11);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      try { scanTopic.unsubscribe(); } catch { /* socket gone */ }
    };
  }, [ros, status]);

  return (
    <GlowCard id="c-radar" theme={theme}>
      <div className="head">
        <span className={`ic ${status === 'connected' ? '' : 'off'}`} />
        <h2>LiDAR Radar</h2>
        <span className="r">/scan · robot-centric</span>
      </div>
      <div className="radar-body">
        <canvas ref={canvasRef} className="radar-canvas" />
      </div>
    </GlowCard>
  );
}
