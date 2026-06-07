// ─────────────────────────────────────────────────────────────────────────────
// useRos.js — rosbridge connection + auto-reconnect (spec §4, §10).
//
// The ROSLIB.Ros connection is a MODULE SINGLETON, created and connected exactly
// once — NOT inside a React effect. Why: React StrictMode (and Vite HMR) mount
// effects twice, and driving connect()/close() from an effect churns the socket.
// roslib's connect() early-returns while a transport is still closing, which
// desyncs its internal isConnected flag from the real socket and makes the next
// send() throw "WebSocket … Still in CONNECTING state" — exactly the bug that
// white-screened Phase 0. One socket, created once, sidesteps the whole race.
//
// The hook only *subscribes to status updates*; mounting/unmounting it never
// touches the socket. Returns { ros, status, url } with status one of:
//   'connecting' | 'connected' | 'reconnecting' | 'down'
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import * as ROSLIB from 'roslib';
import { ROSBRIDGE_URL } from './topics';

const RECONNECT_MIN = 1000;   // ms
const RECONNECT_MAX = 8000;   // ms — cap so we keep retrying without hammering

let ros = null;
let currentStatus = 'connecting';
const statusListeners = new Set();

function setStatus(s) {
  currentStatus = s;
  statusListeners.forEach((fn) => fn(s));
}

function ensureRos() {
  if (ros) return ros;
  ros = new ROSLIB.Ros({});

  let backoff = RECONNECT_MIN;
  let timer = null;

  const connect = () => {
    try {
      ros.connect(ROSBRIDGE_URL);
    } catch {
      scheduleReconnect();
    }
  };
  const scheduleReconnect = () => {
    setStatus('reconnecting');
    clearTimeout(timer);
    const delay = backoff;
    timer = setTimeout(connect, delay);
    backoff = Math.min(delay * 2, RECONNECT_MAX);
  };

  ros.on('connection', () => {
    backoff = RECONNECT_MIN;
    setStatus('connected');
    // eslint-disable-next-line no-console
    console.log(`[ros] connected → ${ROSBRIDGE_URL}`);
  });
  ros.on('error', () => {
    setStatus('down');
    // roslib fires 'close' after 'error'; reconnect is scheduled there.
  });
  ros.on('close', () => {
    setStatus('down');
    // eslint-disable-next-line no-console
    console.warn('[ros] connection closed — retrying');
    scheduleReconnect();
  });

  connect();
  return ros;
}

export function useRos() {
  const rosInstance = ensureRos();
  const [status, setLocal] = useState(currentStatus);

  useEffect(() => {
    setLocal(currentStatus); // sync in case status changed before subscribe
    statusListeners.add(setLocal);
    return () => statusListeners.delete(setLocal);
  }, []);

  return { ros: rosInstance, status, url: ROSBRIDGE_URL };
}
