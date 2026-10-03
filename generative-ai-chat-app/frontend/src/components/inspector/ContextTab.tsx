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
        <dd className={request.previous_response_id ? 'mono mono--accent' : ''}>
          {request.previous_response_id ?? 'none (first message)'}
        </dd>
      </dl>
      <h3 className="tab-subtitle">instructions</h3>
      <pre className="code code--wrap">{request.instructions}</pre>
      <h3 className="tab-subtitle">input</h3>
      <pre className="code code--wrap">{request.input}</pre>
      <p className="note">
        {request.previous_response_id ? (
          <>
            The service uses <code>previous_response_id</code> to load the earlier conversation.
            Only the new message is sent as <code>input</code>.
          </>
        ) : (
          <>First message of the conversation: there is nothing to link back to yet.</>
        )}
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
