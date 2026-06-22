// -----------------------------------------------------------------------------
// DiagCard.jsx - topic-health diagnostics.
//
// Built ENTIRELY from liveness signals the dashboard already derives - no new ROS
// subscriptions. For each topic the dashboard depends on it shows the expected
// name + type, a live/stale dot, and (where known) the measured rate. This is the
// panel that makes a topic-name mismatch (the /odom vs /odometry/filtered bug)
// obvious at a glance: the row simply sits "stale".
// -----------------------------------------------------------------------------
import GlowCard from './GlowCard';
import { TOPICS } from '../ros/topics';

function DiagRow({ name, type, ok, hz }) {
  return (
    <div className="diag-row">
      <span className={`diag-dot ${ok ? 'ok' : 'bad'}`} />
      <span className="diag-name">{name}</span>
      <span className="diag-type">{type}</span>
      <span className="diag-hz">
        {ok ? (hz != null ? `${Math.round(hz)} Hz` : 'live') : 'stale'}
      </span>
    </div>
  );
}

export default function DiagCard({ status, robot, scanHz, pose, health, theme }) {
  const connected = status === 'connected';
  const rows = [
    { name: TOPICS.odom.name, type: 'Odometry', ok: connected && robot.odomOk, hz: robot.odomHz },
    { name: TOPICS.imu.name, type: 'Imu', ok: connected && robot.imuOk, hz: null },
    { name: TOPICS.scan.name, type: 'LaserScan', ok: connected && scanHz != null, hz: scanHz },
    { name: TOPICS.robotPose.name, type: 'PoseStamped', ok: connected && !!pose, hz: null },
    { name: TOPICS.sysStats.name, type: 'String', ok: connected && robot.sysOk, hz: null },
  ];

  return (
    <GlowCard id="c-diag" theme={theme}>
      <div className="head">
        <span className={`ic ${connected ? '' : 'off'}`} />
        <h2>Topic Health</h2>
        <span className="r">
          {connected ? `rosbridge · ${health?.nodeCount ?? '-'} nodes` : 'offline'}
        </span>
      </div>
      <div className="diag-body">
        {rows.map((r) => (
          <DiagRow key={r.name} {...r} />
        ))}
      </div>
    </GlowCard>
  );
}
