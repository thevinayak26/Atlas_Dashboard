// ─────────────────────────────────────────────────────────────────────────────
// SystemHealthSeg.jsx — Link / Scan / CPU / Nodes, all from real sources:
//   Link   round-trip latency of a /rosapi/nodes call (useRosHealth)
//   Scan   measured /scan rate (reported by MapCanvas)
//   CPU    parsed from /sys_stats JSON (useRobotData)
//   Nodes  live ROS node count from /rosapi/nodes
// Missing sources render "—" and a muted bar, never a fabricated value.
// ─────────────────────────────────────────────────────────────────────────────
import Skeleton from '../Skeleton';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const NODE_BARS = 10; // visual cap

export default function SystemHealthSeg({ latencyMs, scanHz, cpu, nodeCount, healthOk, loading }) {
  const linkPct = latencyMs != null ? clamp(100 - latencyMs, 12, 100) : 0;
  const scanPct = scanHz != null ? clamp((scanHz / 10) * 100, 0, 100) : 0;
  const cpuPct = cpu != null ? clamp(cpu, 0, 100) : 0;
  const cpuCls = cpu == null ? '' : cpu > 90 ? 'coral' : cpu > 70 ? 'gold' : '';
  const shownBars = nodeCount != null ? clamp(nodeCount, 0, NODE_BARS) : 0;
  const val = (node) => (loading ? <Skeleton width={44} height={11} /> : node);

  return (
    <div className="seg">
      <div className="seghead">
        <span className={'ic' + (healthOk ? '' : ' off')} />
        <h3>System Health</h3>
      </div>
      <div className="segbody">
        <div className="hgrid">
          <div className="hrow">
            <span className="k">Link</span>
            <div className="hbar">
              <i style={{ width: linkPct + '%' }} />
            </div>
            {val(
              <span className={'v' + (latencyMs != null ? ' ok' : '')}>
                {latencyMs != null ? latencyMs + ' ms' : '—'}
              </span>
            )}
          </div>
          <div className="hrow">
            <span className="k">Scan</span>
            <div className="hbar">
              <i style={{ width: scanPct + '%' }} />
            </div>
            {val(<span className="v">{scanHz != null ? scanHz.toFixed(1) + ' Hz' : '—'}</span>)}
          </div>
          <div className="hrow">
            <span className="k">CPU</span>
            <div className="hbar">
              <i className={cpuCls} style={{ width: cpuPct + '%' }} />
            </div>
            {val(<span className="v">{cpu != null ? Math.round(cpu) + '%' : '—'}</span>)}
          </div>
          <div>
            <div className="hrow" style={{ marginBottom: 3 }}>
              <span className="k">Nodes</span>
              {val(
                <span className={'v' + (nodeCount ? ' ok' : '')}>
                  {nodeCount != null ? `${nodeCount} up` : '—'}
                </span>
              )}
            </div>
            <div className="nodes">
              {Array.from({ length: NODE_BARS }).map((_, i) => (
                <div className={'nd' + (i < shownBars ? '' : ' off')} key={i} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
