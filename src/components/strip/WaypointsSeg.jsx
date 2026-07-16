import { useEffect, useMemo, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';
import { TOPICS } from '../../ros/topics';
import { WAYPOINTS } from '../../lib/waypoints';
import Skeleton from '../Skeleton';

const params = new URLSearchParams(window.location.search);
const VOICE_HOST = params.get('voicehost') || window.location.hostname || 'localhost';
const VOICE_PORT = params.get('voiceport') || '5005';
const TRANSCRIBE_URL = `http://${VOICE_HOST}:${VOICE_PORT}/transcribe`;
const PARSE_URL = `http://${VOICE_HOST}:${VOICE_PORT}/parse`;

const STOP_SETTLE_MS = 100;
const MIN_BLOB_BYTES = 1000;

const Mic = ({ on }) => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" fill={on ? 'currentColor' : 'none'} />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

// Short display string for whatever schema the backend returns.
function describe(cmd) {
  if (!cmd || !cmd.command) return '';
  switch (cmd.command) {
    case 'MOVE': return `${cmd.direction} ${cmd.distance}m`;
    case 'TURN': return `${cmd.direction} ${cmd.angle}\u00b0`;
    case 'NAVIGATE': return cmd.target ? `\u2192 ${cmd.target}` : 'NAVIGATE';
    case 'STOP': return 'STOP';
    case 'CANCEL': return 'CANCEL';
    default: return cmd.command;
  }
}

export default function WaypointsSeg({ ros, status, pose, loading }) {
  const connected = status === 'connected';
  const [mode, setMode] = useState('text');
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState('');
  const [heard, setHeard] = useState('');
  const [parsed, setParsed] = useState(null);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);

  const pub = useMemo(() => {
    if (!ros) return null;
    return new ROSLIB.Topic({ ros, name: TOPICS.voiceCommand.name, messageType: TOPICS.voiceCommand.type });
  }, [ros]);

  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const wasConnected = useRef(connected);

  useEffect(() => {
    if (connected && !wasConnected.current && pending && pub) {
      pub.publish({ data: JSON.stringify(pending.cmd) });
      console.log('ROS reconnected - sent queued command:', pending.label);
      setNote(`reconnected \u00b7 sent ${pending.label}`);
      setPending(null);
    }
    wasConnected.current = connected;
  }, [connected, pending, pub]);

  useEffect(() => () => {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop();
  }, []);

  // cmd is the FULL object from the backend (command, direction, distance, angle, target...)
  // no more collapsing it down to {command, target}.
  const send = (cmd, src) => {
    setHeard(src);
    setParsed(cmd && cmd.command ? cmd : null);

    if (!cmd || !cmd.command) {
      console.log('VOICE: not understood ->', src);
      setPending(null);
      setNote('');
      return;
    }

    const label = describe(cmd);
    console.log("VOICE:", cmd);

    if (pub && connected) {
      pub.publish({ data: JSON.stringify(cmd) });
      setPending(null);
      setNote('');
      return;
    }

    console.log("ROS offline - queued:", label);
    setPending({ cmd, label });
    setNote('');
  };

  const sendText = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    setBusy(true);
    setNote('parsing\u2026');
    try {
      const res = await fetch(PARSE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t }),
      });
      if (!res.ok) throw new Error(`service ${res.status}`);
      const data = await res.json();
      const { heard, ...cmd } = data;
      send(cmd.command ? cmd : null, heard || t);
    } catch (err) {
      setNote(`parser unreachable (${err.message})`);
    } finally {
      setBusy(false);
    }
  };

  const sendWaypoint = (w) => send({ command: 'NAVIGATE', target: w.key }, w.name);

  const startRec = async () => {
    if (recording) return;
    setNote('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        await new Promise(resolve => setTimeout(resolve, STOP_SETTLE_MS));
        stream.getTracks().forEach((tr) => tr.stop());
        const chunks = chunksRef.current;

        if (chunks.length === 0) {
          setNote('no audio captured \u00b7 hold the button a little longer');
          return;
        }
        const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
        console.log("Chunks:", chunks.length);
        console.log("Blob size:", blob.size);

        if (blob.size < MIN_BLOB_BYTES) {
          setNote(`recording too short (${blob.size}b) \u00b7 hold the button a little longer`);
          return;
        }

        setNote('transcribing\u2026');
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'clip.webm');
          const res = await fetch(TRANSCRIBE_URL, { method: 'POST', body: fd });
          if (!res.ok) throw new Error(`service ${res.status}`);
          const data = await res.json();

          console.log("VOICE SERVER:", data);

          const { heard, ...cmd } = data;
          send(cmd.command ? cmd : null, heard || "(voice)");
        } catch (err) { console.warn('voice service:', err); setNote('voice offline \u00b7 check voice_server'); }
      };
      mr.start(250); mediaRef.current = mr; setRecording(true);
    } catch { setNote('mic denied'); }
  };
  const stopRec = () => {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop();
    }
    setRecording(false);
  };

  const [selIdx, setSelIdx] = useState(-1);
  let activeIdx = selIdx;
  if (pose) {
    let best = Infinity;
    WAYPOINTS.forEach((w, i) => { const d = Math.hypot(w.x - pose.x, w.y - pose.y); if (d < best) { best = d; activeIdx = i; } });
  }

  return (
    <div className="seg">
      <div className="seghead">
        <span className="ic" />
        <h3>Destinations</h3>
        <div style={s.toggle}>
          <button onClick={() => setMode('text')} style={{ ...s.chip, ...(mode === 'text' ? s.chipOn : {}) }}>Text</button>
          <button onClick={() => setMode('voice')} style={{ ...s.chip, ...(mode === 'voice' ? s.chipOn : {}) }}>Voice</button>
        </div>
      </div>
      <div className="segbody">
        {mode === 'text' ? (
          <div style={s.row}>
            <input value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendText()}
              placeholder='"move 0.1m forward" / "go to the dock"' style={s.input} disabled={busy} />
            <button onClick={sendText} style={s.send} disabled={!text.trim() || busy}>Go</button>
          </div>
        ) : (
          <button onMouseDown={startRec} onMouseUp={stopRec} onMouseLeave={stopRec}
            onTouchStart={(e) => { e.preventDefault(); startRec(); }} onTouchEnd={(e) => { e.preventDefault(); stopRec(); }}
            style={{ ...s.micBtn, ...(recording ? s.micOn : {}) }}>
            <Mic on={recording} />{recording ? 'Release to send' : 'Hold to talk'}
          </button>
        )}

        <div style={s.status}>
          {heard ? (
            <>
              <div style={s.statusLine}>{'>>'} {heard}</div>
              {parsed ? (
                <div style={s.statusLine}><span style={s.dotOk} /> {describe(parsed)}</div>
              ) : (
                <div style={s.statusLine}><span style={s.dotBad} /> not understood</div>
              )}
              {!connected && (
                <div style={{ ...s.statusLine, opacity: 0.65 }}>
                  ROS offline{pending ? ' \u00b7 queued for reconnect' : ''}
                </div>
              )}
            </>
          ) : null}
          {note && <div style={s.note} title={note}>{note}</div>}
          {!heard && !note && <div style={s.note}>{'\u00A0'}</div>}
        </div>

        <div style={{ marginTop: 6, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {WAYPOINTS.map((w, i) => {
            const d = pose ? Math.hypot(w.x - pose.x, w.y - pose.y) : null;
            return (
              <div className={'wp' + (i === activeIdx ? ' active' : '')} key={w.key}
                onClick={() => { setSelIdx(i); sendWaypoint(w); }} style={{ cursor: 'pointer' }}>
                <span className="pin" />
                <span className="nm">{w.name}</span>
                {loading ? (
                  <span className="co" style={{ marginLeft: 'auto' }}><Skeleton width={40} height={9} /></span>
                ) : (
                  <span className="co">{d != null ? d.toFixed(1) + ' m' : `${w.x}, ${w.y}`}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const s = {
  toggle: { display: 'flex', gap: 3, marginLeft: 'auto' },
  chip: { fontSize: 10, padding: '2px 7px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
  chipOn: { background: 'rgba(255,255,255,0.14)', borderColor: 'rgba(255,255,255,0.3)' },
  row: { display: 'flex', gap: 6 },
  input: { flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: 'inherit', fontSize: 12 },
  send: { padding: '5px 11px', borderRadius: 6, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: 12 },
  micBtn: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: 'inherit', cursor: 'pointer', fontSize: 12, userSelect: 'none' },
  micOn: { background: 'rgba(239,68,68,0.25)', borderColor: 'rgba(239,68,68,0.6)' },
  status: { marginTop: 5, minHeight: 28 },
  statusLine: { fontSize: 11, lineHeight: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  dotOk: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#22c55e', marginRight: 5, verticalAlign: 'middle' },
  dotBad: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ef4444', marginRight: 5, verticalAlign: 'middle' },
  note: { fontSize: 11, opacity: 0.7, lineHeight: '14px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
};
