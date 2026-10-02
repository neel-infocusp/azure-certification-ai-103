import type { SessionTotals } from '../../hooks/useChat'
import type { InspectorSnapshot } from '../../types'
import { formatLatency, formatNumber, formatText } from '../../lib/format'

interface Props {
  snapshot: InspectorSnapshot | null
  totals: SessionTotals
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

export function MetricsTab({ snapshot, totals }: Props) {
  if (!snapshot) {
    return <p className="placeholder">Send a message to see latency and token usage.</p>
  }
  const { usage, metrics, response, request } = snapshot
  return (
    <div className="tab-body">
      <h3 className="tab-subtitle">Last turn</h3>
      <div className="stats">
        <Stat label="Latency" value={formatLatency(metrics.latency_ms)} />
        <Stat label="Input tokens" value={formatNumber(usage.input_tokens)} />
        <Stat label="Output tokens" value={formatNumber(usage.output_tokens)} />
        <Stat label="Total tokens" value={formatNumber(usage.total_tokens)} />
        <Stat label="Reasoning tokens" value={formatNumber(usage.reasoning_tokens)} />
        <Stat label="Cached tokens" value={formatNumber(usage.cached_tokens)} />
      </div>
      <dl className="kv">
        <dt>Finish reason</dt>
        <dd>{formatText(response.finish_reason)}</dd>
        <dt>Model</dt>
        <dd>{formatText(request.model)}</dd>
        <dt>Response ID</dt>
        <dd className="mono">{formatText(response.id)}</dd>
      </dl>
      <h3 className="tab-subtitle">This session</h3>
      <div className="stats">
        <Stat label="Turns" value={formatNumber(totals.turns)} />
        <Stat label="Total tokens" value={formatNumber(totals.tokens)} />
      </div>
    </div>
  )
}
