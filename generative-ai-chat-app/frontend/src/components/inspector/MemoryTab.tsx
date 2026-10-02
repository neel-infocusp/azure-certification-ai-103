import { useEffect, useState } from 'react'
import { getMemory } from '../../api/client'
import type { InspectorSnapshot, MemoryResponse } from '../../types'

interface Props {
  snapshot: InspectorSnapshot | null
  sessionId: string | null
}

type ServerItemsResult =
  | { key: string; status: 'loaded'; data: MemoryResponse }
  | { key: string; status: 'unavailable' }

export function MemoryTab({ snapshot, sessionId }: Props) {
  const lastResponseId = snapshot?.response.id ?? null
  // Identifies "this conversation at this point", so a stale answer is never shown.
  const key = sessionId && lastResponseId ? `${sessionId}:${lastResponseId}` : null
  const [result, setResult] = useState<ServerItemsResult | null>(null)

  // Ask the server what it stored, each time the conversation moves on. Best effort only.
  useEffect(() => {
    if (!sessionId || !key) return
    let cancelled = false
    getMemory(sessionId)
      .then((data) => {
        if (!cancelled) setResult({ key, status: 'loaded', data })
      })
      .catch(() => {
        if (!cancelled) setResult({ key, status: 'unavailable' })
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, key])

  const serverItems = key !== null && result?.key === key ? result : null
  const loading = key !== null && serverItems === null

  if (!snapshot) {
    return (
      <p className="placeholder">
        No messages yet. After the first answer, this tab shows what the conversation remembers.
      </p>
    )
  }

  const { response_chain: chain, transcript } = snapshot.memory

  return (
    <div className="tab-body">
      <dl className="kv">
        <dt>Memory mode</dt>
        <dd>{snapshot.memory.mode}</dd>
      </dl>

      <h3 className="tab-subtitle">Server memory: response chain</h3>
      <ol className="chain">
        {chain.map((id, index) => {
          const latest = index === chain.length - 1
          return (
            <li key={id} className={latest ? 'chain--latest' : undefined}>
              <span className="mono">{id}</span>
              {latest && <span className="chain-tag">latest</span>}
            </li>
          )
        })}
      </ol>
      <p className="note">
        The next question is sent with the latest ID, so the service can load everything before it.
      </p>

      <h3 className="tab-subtitle">Local transcript mirror</h3>
      <div className="transcript">
        {transcript.map((message, index) => (
          <div key={index} className="transcript-row">
            <span className="transcript-role">{message.role}</span>
            {message.content}
          </div>
        ))}
      </div>
      <p className="note">Our own copy for display. The model does not read this.</p>

      <h3 className="tab-subtitle">Server items (best effort)</h3>
      {loading && <p className="placeholder">Asking the service…</p>}
      {serverItems?.status === 'unavailable' && (
        <p className="placeholder">Could not load this from the server.</p>
      )}
      {serverItems?.status === 'loaded' &&
        (serverItems.data.server_items ? (
          <details className="raw">
            <summary>Input items stored for the last response</summary>
            <pre className="code">{JSON.stringify(serverItems.data.server_items, null, 2)}</pre>
          </details>
        ) : (
          <p className="placeholder">
            {serverItems.data.server_items_note ?? 'Not available from this endpoint.'}
          </p>
        ))}
    </div>
  )
}
