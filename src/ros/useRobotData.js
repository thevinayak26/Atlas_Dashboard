// ─────────────────────────────────────────────────────────────────────────────
// useRobotData.js — the telemetry aggregation hook (spec §6/§7/§10).
//
// Subscribes ONCE to the high-rate motion/health topics that the text tiles need
// (/odom, /imu/data, /sys_stats) and accumulates the latest values in refs. A
// single 5 Hz sampler then publishes one React snapshot, so a 20 Hz odom stream
// can't trigger 20 re-renders/sec across the dashboard (§10 "don't re-render
// every frame"). The map keeps its own raw subscriptions for 60 fps canvas work;
// nothing here is subscribed twice.
//
// Everything returned is derived from REAL messages — no synthetic numbers. When
// a topic is silent the corresponding field stays null/false so tiles can show an
// honest "—" instead of a fake reading (Golden Rule 1, spec §1).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';
import { TOPICS } from './topics';
import { quatToYaw } from '../lib/geometry';

const SAMPLE_HZ = 5;
const MOVING_EPS = 0.02; // m/s below which we call the robot stopped

// Exponential moving rate estimator: smooth Hz from message inter-arrival times.
function makeRate(alpha = 0.2) {
  let last = 0;
  let hz = 0;
  return {
    tick(now) {
      if (last) {
        const dt = (now - last) / 1000;
        if (dt > 0) hz = hz ? hz + alpha * (1 / dt - hz) : 1 / dt;
      }
      last = now;
    },
    get value() {
      return hz;
    },
    stale(now, ms = 1500) {
      return !last || now - last > ms;
    },
  };
}

const EMPTY = {
  vel: null,
  dist: null,
  yaw: null,
  gyroZ: null,
  cpu: null,
  mem: null,
  uptime: null,
  odomHz: null,
  imuOk: false,
  odomOk: false,
  sysOk: false,
  moving: false,
};

export function useRobotData(ros, status) {
  const [data, setData] = useState(EMPTY);

  // Mutable accumulators (don't trigger renders) ----------------------------
  const last = useRef({
    vel: 0,
    dist: 0,
    yawOdom: null,
    yawImu: null,
    gyroZ: null,
    cpu: null,
    mem: null,
    uptime: null,
    px: null,
    py: null,
  });
  const odomRate = useRef(makeRate());
  const imuRate = useRef(makeRate());
  const sysRate = useRef(makeRate());

  useEffect(() => {
    if (status !== 'connected') return undefined;

    const odom = new ROSLIB.Topic({
      ros,
      name: TOPICS.odom.name,
      messageType: TOPICS.odom.type,
      throttle_rate: 50,
      queue_length: 1,
    });
    const imu = new ROSLIB.Topic({
      ros,
      name: TOPICS.imu.name,
      messageType: TOPICS.imu.type,
      throttle_rate: 50,
      queue_length: 1,
    });
    const sys = new ROSLIB.Topic({
      ros,
      name: TOPICS.sysStats.name,
      messageType: TOPICS.sysStats.type,
    });

    odom.subscribe((msg) => {
      odomRate.current.tick(performance.now());
      const lin = msg.twist?.twist?.linear;
      const pos = msg.pose?.pose?.position;
      const L = last.current;
      if (lin) L.vel = Math.hypot(lin.x || 0, lin.y || 0);
      if (pos) {
        if (L.px !== null) L.dist += Math.hypot(pos.x - L.px, pos.y - L.py);
        L.px = pos.x;
        L.py = pos.y;
      }
      L.yawOdom = quatToYaw(msg.pose?.pose?.orientation);
    });

    imu.subscribe((msg) => {
      imuRate.current.tick(performance.now());
      last.current.yawImu = quatToYaw(msg.orientation);
      last.current.gyroZ = msg.angular_velocity?.z ?? null;
    });

    sys.subscribe((msg) => {
      sysRate.current.tick(performance.now());
      try {
        const j = JSON.parse(msg.data);
        last.current.cpu = j.cpu ?? null;
        last.current.mem = j.mem ?? null;
        last.current.uptime = j.uptime_s ?? null;
      } catch {
        /* non-JSON /sys_stats payload — ignore rather than crash a tile */
      }
    });

    // One sampler → one snapshot per tick.
    const id = setInterval(() => {
      const now = performance.now();
      const L = last.current;
      const odomOk = !odomRate.current.stale(now);
      const imuOk = !imuRate.current.stale(now);
      const sysOk = !sysRate.current.stale(now, 3000);
      // Prefer IMU heading (it's the fused source); fall back to odom.
      const yaw = imuOk ? L.yawImu : L.yawOdom;
      setData({
        vel: odomOk ? L.vel : null,
        dist: L.dist,
        yaw: yaw ?? null,
        gyroZ: imuOk ? L.gyroZ : null,
        cpu: sysOk ? L.cpu : null,
        mem: sysOk ? L.mem : null,
        uptime: sysOk ? L.uptime : null,
        odomHz: odomOk ? odomRate.current.value : null,
        imuOk,
        odomOk,
        sysOk,
        moving: odomOk && L.vel > MOVING_EPS,
      });
    }, 1000 / SAMPLE_HZ);

    return () => {
      clearInterval(id);
      try { odom.unsubscribe(); } catch { /* socket gone */ }
      try { imu.unsubscribe(); } catch { /* socket gone */ }
      try { sys.unsubscribe(); } catch { /* socket gone */ }
    };
  }, [ros, status]);

  // When the link is down, present the empty snapshot rather than stale numbers.
  return status === 'connected' ? data : EMPTY;
}
