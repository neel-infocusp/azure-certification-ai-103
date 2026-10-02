import type { InspectorSnapshot } from '../../types'
import { formatText } from '../../lib/format'

export function ContextTab({ snapshot }: { snapshot: InspectorSnapshot | null }) {
  if (!snapshot) {
    return <p className="placeholder">Send a message to see exactly what is sent to the model.</p>
  }
  const { request, api, raw } = snapshot
  return (
    <div className="tab-body">
      <dl className="kv">
        <dt>API</dt>
        <dd>{api}</dd>
        <dt>Model</dt>
        <dd>{formatText(request.model)}</dd>
        <dt>Streaming</dt>
        <dd>{request.stream ? 'yes' : 'no'}</dd>
        <dt>previous_response_id</dt>
        <dd>none</dd>
      </dl>
      <h3 className="tab-subtitle">instructions</h3>
      <pre className="code code--wrap">{request.instructions}</pre>
      <h3 className="tab-subtitle">input</h3>
      <pre className="code code--wrap">{request.input}</pre>
      <p className="note">
        No <code>previous_response_id</code> is sent, so the model cannot see earlier messages.
      </p>
      {raw && (
        <details className="raw">
          <summary>Raw response</summary>
          <pre className="code">{JSON.stringify(raw, null, 2)}</pre>
        </details>
      )}
    </div>
  )
}
