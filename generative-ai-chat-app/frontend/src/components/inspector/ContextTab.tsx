import type { InspectorSnapshot } from '../../types'
import { formatText } from '../../lib/format'

export function ContextTab({ snapshot }: { snapshot: InspectorSnapshot | null }) {
  if (!snapshot) {
    return <p className="placeholder">Send a message to see exactly what is sent to the model.</p>
  }
  const { request, api } = snapshot
  return (
    <div className="tab-body">
      <dl className="kv">
        <dt>API</dt>
        <dd>{api}</dd>
        <dt>Model</dt>
        <dd>{formatText(request.model)}</dd>
        <dt>Streaming</dt>
        <dd>{request.stream ? 'yes' : 'no'}</dd>
      </dl>
      <h3 className="tab-subtitle">messages sent to the model</h3>
      <pre className="code">{JSON.stringify(request.messages, null, 2)}</pre>
      <p className="note">
        Only the system prompt and your latest message are sent. The model has no access to
        earlier messages.
      </p>
    </div>
  )
}
