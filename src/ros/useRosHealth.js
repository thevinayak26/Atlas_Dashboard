// ─────────────────────────────────────────────────────────────────────────────
// useRosHealth.js — System-Health tile data sourced from REAL rosbridge state.
//
// Calls the rosapi service /rosapi/nodes on a 2 s poll. The response gives the
// live ROS node list (real "N nodes up"), and timing the round-trip gives a real
// link-latency figure — no invented "12 ms". rosapi ships with rosbridge_server
// by default; if it's somehow absent the hook degrades to nulls and the tile
// shows "—" rather than guessing.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import * as ROSLIB from 'roslib';

const POLL_MS = 2000;

const EMPTY = { latencyMs: null, nodes: [], nodeCount: null, ok: false };

export function useRosHealth(ros, status) {
  const [health, setHealth] = useState(EMPTY);

  useEffect(() => {
    if (status !== 'connected') return undefined;

    const nodesSvc = new ROSLIB.Service({
      ros,
      name: '/rosapi/nodes',
      serviceType: 'rosapi/Nodes',
    });

    let alive = true;
    let timer = null;

    const poll = () => {
      const t0 = performance.now();
      // roslib v2 dropped ROSLIB.ServiceRequest — callService takes a plain object.
      nodesSvc.callService(
        {},
        (res) => {
          if (!alive) return;
          const latencyMs = Math.round(performance.now() - t0);
          const nodes = res?.nodes || [];
          setHealth({ latencyMs, nodes, nodeCount: nodes.length, ok: true });
          timer = setTimeout(poll, POLL_MS);
        },
        () => {
          if (!alive) return;
          setHealth((h) => ({ ...h, ok: false }));
          timer = setTimeout(poll, POLL_MS);
        }
      );
    };
    poll();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ros, status]);

  return status === 'connected' ? health : EMPTY;
}
