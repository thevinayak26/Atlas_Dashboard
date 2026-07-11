import { useEffect, useMemo, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';
import { TOPICS } from '../ros/topics';
import { parseCommand } from '../lib/commandParser';

const params = new URLSearchParams(window.location.search);
const VOICE_HOST = params.get('voicehost') || window.location.hostname || 'localhost';
const VOICE_PORT = params.get('voiceport') || '5005';
const TRANSCRIBE_URL = `http://${VOICE_HOST}:${VOICE_PORT}/transcribe`;

const MicIcon = ({ on }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" fill={on ? 'currentColor' : 'none'} />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export default function CommandCard({ ros, status }) {
  const connected = status === 'connected';
  const [mode, setMode] = useState('text');
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [last, setLast] = useState(null);
  const [note, setNote] = useState('');

  const pub = useMemo(() => {
    if (!ros) return null;
    return new ROSLIB.Topic({ ros, name: TOPICS.voiceCommand.name, messageType: TOPICS.voiceCommand.type });
  }, [ros]);

  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  const publish = (cmd, sourceText) => {
    if (!cmd) { setNote(`not understood: "${sourceText}"`); return; }
    if (!pub || !connected) { setNote('no ROS link; command not sent'); setLast(cmd); return; }
    pub.publish(new ROSLIB.Message({ data: JSON.stringify(cmd) }));
    setLast(cmd);
    setNote(`sent: ${cmd.command}${cmd.target ? ' -> ' + cmd.target : ''}`);
  };

  const sendText = () => { const t = text.trim(); if (!t) return; publish(parseCommand(t), t); setText(''); };

  const startRec = async () => {
    setNote('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setNote('transcribing...');
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'clip.webm');
          const res = await fetch(TRANSCRIBE_URL, { method: 'POST', body: fd });
          if (!res.ok) throw new Error(`service ${res.status}`);
          const data = await res.json();
          if (data.heard) setNote(`heard: ${data.heard}`);
          publish(data.command ? { command: data.command, target: data.target ?? null } : null, data.heard || '(voice)');
        } catch (err) { setNote(`voice service unreachable (${err.message}); try Text mode`); }
      };
      mr.start(); mediaRef.current = mr; setRecording(true);
    } catch { setNote('mic permission denied'); }
  };

  const stopRec = () => { if (mediaRef.current && recording) { mediaRef.current.stop(); setRecording(false); } };

  useEffect(() => () => { if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop(); }, []);

  return (
    <div style={styles.card}>
      <div style={styles.row}>
        <span style={styles.title}>Command</span>
        <div style={styles.toggle}>
          <button onClick={() => setMode('text')} style={{ ...styles.chip, ...(mode === 'text' ? styles.chipOn : {}) }}>Text</button>
          <button onClick={() => setMode('voice')} style={{ ...styles.chip, ...(mode === 'voice' ? styles.chipOn : {}) }}>Voice</button>
        </div>
      </div>
      {mode === 'text' ? (
        <div style={styles.inputRow}>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendText()}
            placeholder='e.g. "go to the kitchen" / "रसोई में जाओ"' style={styles.input} />
          <button onClick={sendText} style={styles.send} disabled={!text.trim()}>Send</button>
        </div>
      ) : (
        <div style={styles.inputRow}>
          <button onMouseDown={startRec} onMouseUp={stopRec} onMouseLeave={stopRec}
            onTouchStart={(e) => { e.preventDefault(); startRec(); }} onTouchEnd={(e) => { e.preventDefault(); stopRec(); }}
            style={{ ...styles.mic, ...(recording ? styles.micOn : {}) }}>
            <MicIcon on={recording} />{recording ? 'Release to send' : 'Hold to talk'}
          </button>
        </div>
      )}
      <div style={styles.note}>
        {note}
        {last && <span style={styles.last}> last: {last.command}{last.target ? ` -> ${last.target}` : ''}</span>}
      </div>
    </div>
  );
}

const styles = {
  card: { position: 'fixed', bottom: 16, right: 16, width: 320, zIndex: 50, padding: '12px 14px', borderRadius: 12, background: 'rgba(20,20,28,0.85)', backdropFilter: 'blur(8px)', color: '#e5e7eb', display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'system-ui, sans-serif' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase', opacity: 0.7 },
  toggle: { display: 'flex', gap: 4 },
  chip: { fontSize: 12, padding: '3px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
  chipOn: { background: 'rgba(255,255,255,0.14)', borderColor: 'rgba(255,255,255,0.3)' },
  inputRow: { display: 'flex', gap: 8 },
  input: { flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: 'inherit', fontSize: 14 },
  send: { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: 13 },
  mic: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: 'inherit', cursor: 'pointer', fontSize: 14, userSelect: 'none' },
  micOn: { background: 'rgba(239,68,68,0.25)', borderColor: 'rgba(239,68,68,0.6)' },
  note: { fontSize: 12, opacity: 0.75, minHeight: 16 },
  last: { opacity: 0.6 },
};
