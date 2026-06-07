// ─────────────────────────────────────────────────────────────────────────────
// App.jsx — PHASE 0 ONLY (spec §9): skeleton + connection.
// Goal: status shows "connected" against a replayed rosbag (here: fake_publisher),
// and ONE test subscription logs real messages to the console.
// Styling/tiles come in later phases — this is intentionally bare.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';
import { useRos } from './ros/useRos';
import { TOPICS, SUB_OPTS } from './ros/topics';

const STATUS_COLOR = {
  connecting:   '#fbbf24',
  connected:    '#2dd4bf',
  reconnecting: '#fbbf24',
  down:         '#fb7185',
};

// The single test subscription for Phase 0's acceptance criterion.
const TEST = TOPICS.odom;

export default function App() {
  const { ros, status, url } = useRos();
  const [count, setCount] = useState(0);
  const [last, setLast] = useState(null);
  const countRef = useRef(0);

  useEffect(() => {
    if (status !== 'connected') return undefined;
    let topic;
    try {
      topic = new ROSLIB.Topic({
        ros,
        name: TEST.name,
        messageType: TEST.type,
        ...(SUB_OPTS.odom || {}),
      });
      topic.subscribe((msg) => {
        countRef.current += 1;
        // eslint-disable-next-line no-console
        console.log(`[ros] ${TEST.name} #${countRef.current}`, msg);
        setCount(countRef.current);
        setLast(msg);
      });
    } catch (e) {
      // A transient roslib/WebSocket race must not crash the tree; log and move on.
      // eslint-disable-next-line no-console
      console.warn('[ros] subscribe failed (will not crash UI):', e?.message || e);
    }
    return () => {
      try { topic?.unsubscribe(); } catch { /* socket already gone */ }
    };
  }, [ros, status]);

  const pos = last?.pose?.pose?.position;
  const lin = last?.twist?.twist?.linear;

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, lineHeight: 1.7 }}>
      <h1 style={{ fontFamily: 'serif', fontWeight: 500 }}>
        ATLAS Console — <em>Phase 0</em>
      </h1>

      <p>
        <span
          style={{
            display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
            background: STATUS_COLOR[status], marginRight: 8,
          }}
        />
        rosbridge: <b style={{ color: STATUS_COLOR[status] }}>{status}</b>
        {'  '}<span style={{ opacity: 0.6 }}>({url})</span>
      </p>

      <hr style={{ opacity: 0.2, margin: '16px 0' }} />

      <p>test subscription: <b>{TEST.name}</b> <span style={{ opacity: 0.6 }}>({TEST.type})</span></p>
      <p>messages received: <b>{count}</b></p>
      {last ? (
        <pre style={{ background: '#11161d', color: '#9be0c4', padding: 12, borderRadius: 8, maxWidth: 520 }}>
{pos
  ? `pose.position  x=${pos.x.toFixed(3)}  y=${pos.y.toFixed(3)}  z=${pos.z.toFixed(3)}
twist.linear   x=${lin.x.toFixed(3)}  y=${lin.y.toFixed(3)}`
  : JSON.stringify(last, null, 2).slice(0, 400)}
        </pre>
      ) : (
        <p style={{ opacity: 0.6 }}>
          {status === 'connected'
            ? 'connected — waiting for first message (is fake_publisher running?)'
            : 'not connected yet…'}
        </p>
      )}

      <p style={{ opacity: 0.5, marginTop: 24, fontSize: 12 }}>
        Open the browser console to see each real message logged.
      </p>
    </div>
  );
}
