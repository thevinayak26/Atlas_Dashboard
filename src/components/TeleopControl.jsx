// -----------------------------------------------------------------------------
// TeleopControl.jsx - game-style WASD manual driving (opt-in).
//
// A floating "Drive" toggle. ONLY while it is on does the page capture the keyboard
// and publish geometry_msgs/Twist to /cmd_vel (the same topic teleop_twist_keyboard
// uses), so normal use never hijacks your keys. Hold W/A/S/D (or the arrow keys) to
// drive, Shift to boost, Space for an immediate stop. A Twist is published at a steady
// rate while keys are held; releasing everything (or toggling off, or the window
// losing focus) publishes a zero Twist so the robot always stops. A live HUD shows the
// pressed keys and the current linear/angular command.
//
// Safety: this drives the real robot. Don't run it while Nav2 is autonomously
// navigating (both would fight over /cmd_vel). Speeds are deliberately gentle.
// -----------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';
import { TOPICS } from '../ros/topics';

const LIN = 0.18;   // m/s   base forward/back speed
const ANG = 0.6;    // rad/s base turn rate
const BOOST = 1.7;  // Shift multiplier
const PUB_MS = 66;  // ~15 Hz command rate (also the watchdog cadence)

// keyboard -> logical direction key
const KEYMAP = {
  w: 'w', s: 's', a: 'a', d: 'd',
  arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd',
};

const WheelIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v6M4.5 9.5l4.6 3M19.5 9.5l-4.6 3" />
  </svg>
);

export default function TeleopControl({ ros, status }) {
  const connected = status === 'connected';
  const [active, setActive] = useState(false);
  const [held, setHeld] = useState({ w: false, a: false, s: false, d: false });
  const [boost, setBoost] = useState(false);

  // Refs the publish loop reads without re-subscribing on every keypress. Synced in
  // effects (writing a ref during render trips react-hooks/refs under the Compiler).
  const heldRef = useRef(held);
  const boostRef = useRef(boost);
  useEffect(() => { heldRef.current = held; }, [held]);
  useEffect(() => { boostRef.current = boost; }, [boost]);

  // Driving requires both the toggle ON and a live link; losing the link tears the
  // effect down (publishing a stop) and hides the HUD, without forcing state in an
  // effect. A deliberate re-toggle (or reconnect) resumes - and with no keys held it
  // only ever publishes a zero Twist until you press one.
  const driving = active && connected;

  useEffect(() => {
    if (!driving) return undefined;

    const topic = new ROSLIB.Topic({
      ros, name: TOPICS.cmdVel.name, messageType: TOPICS.cmdVel.type,
    });
    topic.advertise();

    const publish = (lin, ang) => {
      topic.publish(
        new ROSLIB.Message({
          linear: { x: lin, y: 0, z: 0 },
          angular: { x: 0, y: 0, z: ang },
        })
      );
    };
    const stop = () => publish(0, 0);

    const tick = () => {
      const h = heldRef.current;
      const m = boostRef.current ? BOOST : 1;
      const lin = ((h.w ? 1 : 0) - (h.s ? 1 : 0)) * LIN * m;
      const ang = ((h.a ? 1 : 0) - (h.d ? 1 : 0)) * ANG * m;
      publish(lin, ang);
    };
    const timer = setInterval(tick, PUB_MS);

    const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const onDown = (e) => {
      if (e.repeat || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'spacebar') {
        e.preventDefault();
        setHeld({ w: false, a: false, s: false, d: false });
        stop();
        return;
      }
      if (k === 'shift') { setBoost(true); return; }
      const dir = KEYMAP[k];
      if (!dir) return;
      e.preventDefault();
      setHeld((s) => (s[dir] ? s : { ...s, [dir]: true }));
    };
    const onUp = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'shift') { setBoost(false); return; }
      const dir = KEYMAP[k];
      if (!dir) return;
      setHeld((s) => (s[dir] ? { ...s, [dir]: false } : s));
    };
    // Lose focus -> drop everything and stop (don't keep driving while alt-tabbed).
    const onBlur = () => {
      setHeld({ w: false, a: false, s: false, d: false });
      setBoost(false);
      stop();
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);

    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      stop(); // always leave the robot stopped
      try { topic.unadvertise(); } catch { /* gone */ }
      setHeld({ w: false, a: false, s: false, d: false });
      setBoost(false);
    };
  }, [driving, ros]);

  const mult = boost ? BOOST : 1;
  const lin = ((held.w ? 1 : 0) - (held.s ? 1 : 0)) * LIN * mult;
  const ang = ((held.a ? 1 : 0) - (held.d ? 1 : 0)) * ANG * mult;

  return (
    <div className="teleop">
      {driving && (
        <div className="teleop-hud" role="status">
          <div className="teleop-keys">
            <span className={`tk ${held.w ? 'on' : ''}`}>W</span>
            <div className="tk-row">
              <span className={`tk ${held.a ? 'on' : ''}`}>A</span>
              <span className={`tk ${held.s ? 'on' : ''}`}>S</span>
              <span className={`tk ${held.d ? 'on' : ''}`}>D</span>
            </div>
          </div>
          <div className="teleop-read">
            <div><span>lin</span><b className="num">{lin.toFixed(2)}</b> m/s</div>
            <div><span>ang</span><b className="num">{ang.toFixed(2)}</b> rad/s</div>
            {boost && <div className="teleop-boost">BOOST</div>}
          </div>
          <button type="button" className="teleop-stop" onClick={() => {
            setHeld({ w: false, a: false, s: false, d: false });
          }}>
            STOP
          </button>
          <div className="teleop-hint">Hold W A S D · Shift = boost · Space = stop</div>
        </div>
      )}
      <button
        type="button"
        className={`teleop-toggle ${driving ? 'on' : ''}`}
        onClick={() => setActive((a) => !a)}
        disabled={!connected}
        aria-pressed={driving}
        title={connected ? 'Toggle manual WASD driving' : 'Connect to drive'}
      >
        <WheelIcon />
        <span className="teleop-label">
          <b>Manual Drive</b>
          <em>{driving ? 'WASD live' : connected ? 'keyboard off' : 'offline'}</em>
        </span>
        <span className="teleop-switch" aria-hidden="true"><span className="teleop-knob" /></span>
      </button>
    </div>
  );
}
