import type { SessionTotals } from '../../hooks/useChat'
import type { InspectorSnapshot, Stats, TurnStat } from '../../types'
import { formatLatency, formatNumber, formatSpeed, formatText } from '../../lib/format'

interface Props {
  snapshot: InspectorSnapshot | null
  turns: TurnStat[]
  totals: SessionTotals
  stats: Stats | null
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

function BackendStats({ stats }: { stats: Stats | null }) {
  if (!stats) return null
  return (
    <>
      <h3 className="tab-subtitle">Backend (all conversations)</h3>
      <div className="stats">
        <Stat label="In flight" value={formatNumber(stats.in_flight)} />
        <Stat label="Served" value={formatNumber(stats.total_requests)} />
        <Stat label="Avg latency" value={formatLatency(stats.avg_latency_ms)} />
      </div>
      <p className="note">
        Model calls running right now, finished so far, and their average time. Open a second
        browser tab and ask something while one answer is streaming: both run at the same time.
      </p>
    </>
  )
}

export function MetricsTab({ snapshot, turns, totals, stats }: Props) {
  if (!snapshot) {
    return (
      <div className="tab-body">
        <p className="placeholder">Send a message to see latency and token usage.</p>
        <BackendStats stats={stats} />
      </div>
    )
  }
  const { usage, metrics, response, request } = snapshot
  return (
    <div className="tab-body">
      <h3 className="tab-subtitle">Last turn</h3>
      <div className="stats">
        <Stat label="Latency" value={formatLatency(metrics.latency_ms)} />
        <Stat label="First token" value={formatLatency(metrics.ttft_ms)} />
        <Stat label="Chunks" value={formatNumber(metrics.chunk_count)} />
        <Stat label="Speed" value={formatSpeed(usage.output_tokens, metrics)} />
        <Stat label="Input tokens" value={formatNumber(usage.input_tokens)} />
        <Stat label="Output tokens" value={formatNumber(usage.output_tokens)} />
        <Stat label="Total tokens" value={formatNumber(usage.total_tokens)} />
        <Stat label="Reasoning tokens" value={formatNumber(usage.reasoning_tokens)} />
        <Stat label="Cached tokens" value={formatNumber(usage.cached_tokens)} />
      </div>
      <dl className="kv">
        <dt>Status</dt>
        <dd>{formatText(response.status)}</dd>
        <dt>Model</dt>
        <dd>{formatText(request.model)}</dd>
        <dt>Response ID</dt>
        <dd className="mono">{formatText(response.id)}</dd>
      </dl>

      <h3 className="tab-subtitle">Token growth per turn</h3>
      <div className="table-wrap">
        <table className="turn-table">
          <thead>
            <tr>
              <th scope="col">Turn</th>
              <th scope="col">Input</th>
              <th scope="col">Output</th>
              <th scope="col">First token</th>
              <th scope="col">Latency</th>
            </tr>
          </thead>
          <tbody>
            {turns.map((turn) => (
              <tr key={turn.index}>
                <td>{turn.index}</td>
                <td>{formatNumber(turn.input_tokens)}</td>
                <td>{formatNumber(turn.output_tokens)}</td>
                <td>{formatLatency(turn.ttft_ms)}</td>
                <td>{formatLatency(turn.latency_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Input tokens rise because the service re-reads the earlier conversation on every turn.
      </p>

      <h3 className="tab-subtitle">This conversation</h3>
      <div className="stats">
        <Stat label="Turns" value={formatNumber(totals.turns)} />
        <Stat label="Total tokens" value={formatNumber(totals.tokens)} />
      </div>

      <BackendStats stats={stats} />
    </div>
  )
}
