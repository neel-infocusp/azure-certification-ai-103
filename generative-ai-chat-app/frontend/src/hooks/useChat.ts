import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, createSession, deleteSession, postChat } from '../api/client'
import type {
  ChatMessage,
  ChatRole,
  ChatStatus,
  InspectorSnapshot,
  TurnStat,
} from '../types'

export interface SessionTotals {
  turns: number
  tokens: number
}

export interface UseChat {
  messages: ChatMessage[]
  status: ChatStatus
  snapshot: InspectorSnapshot | null
  turns: TurnStat[]
  totals: SessionTotals
  sessionId: string | null
  send: (text: string) => Promise<void>
  newChat: () => void
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.'
}

export function useChat(): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<ChatStatus>('starting')
  const [snapshot, setSnapshot] = useState<InspectorSnapshot | null>(null)
  const [turns, setTurns] = useState<TurnStat[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)

  const nextId = useRef(1)
  // The session id is mirrored in a ref so callbacks always see the latest value.
  const sessionRef = useRef<string | null>(null)
  // Bumped by newChat() so a reply that arrives for the old conversation is dropped.
  const epoch = useRef(0)
  const busy = useRef(false)
  const started = useRef(false)

  const addMessage = useCallback((role: ChatRole, content: string) => {
    setMessages((prev) => [...prev, { id: nextId.current++, role, content }])
  }, [])

  const resetInspector = useCallback(() => {
    setSnapshot(null)
    setTurns([])
  }, [])

  const startSession = useCallback(async (): Promise<string | null> => {
    try {
      const id = await createSession()
      sessionRef.current = id
      setSessionId(id)
      return id
    } catch (err) {
      sessionRef.current = null
      setSessionId(null)
      addMessage('error', errorMessage(err))
      return null
    }
  }, [addMessage])

  // One new conversation when the page opens (the guard keeps StrictMode from making two).
  useEffect(() => {
    if (started.current) return
    started.current = true
    void startSession().then((id) => setStatus(id ? 'idle' : 'error'))
  }, [startSession])

  const send = useCallback(
    async (text: string) => {
      const message = text.trim()
      if (!message || busy.current) return

      busy.current = true
      const myEpoch = epoch.current
      addMessage('user', message)
      setStatus('waiting')

      try {
        // If the first attempt to create a session failed, try again now.
        const id = sessionRef.current ?? (await startSession())
        if (!id) {
          setStatus('error')
          return
        }

        const result = await postChat(message, id)
        if (myEpoch !== epoch.current) return

        addMessage('assistant', result.reply)
        setSnapshot(result.inspector)
        setTurns((prev) => [
          ...prev,
          {
            index: prev.length + 1,
            input_tokens: result.inspector.usage.input_tokens,
            output_tokens: result.inspector.usage.output_tokens,
            total_tokens: result.inspector.usage.total_tokens,
            latency_ms: result.inspector.metrics.latency_ms,
          },
        ])
        setStatus('idle')
      } catch (err) {
        if (myEpoch !== epoch.current) return
        addMessage('error', errorMessage(err))
        if (err instanceof ApiError && err.code === 'session_not_found') {
          // The server forgot this conversation (e.g. it restarted): start a fresh one.
          resetInspector()
          await startSession()
        }
        setStatus('error')
      } finally {
        if (myEpoch === epoch.current) busy.current = false
      }
    },
    [addMessage, resetInspector, startSession],
  )

  const newChat = useCallback(() => {
    epoch.current += 1
    busy.current = false
    const old = sessionRef.current
    if (old) void deleteSession(old).catch(() => {}) // best effort, the server also caps sessions

    sessionRef.current = null
    setSessionId(null)
    setMessages([])
    resetInspector()
    setStatus('starting')
    void startSession().then((id) => setStatus(id ? 'idle' : 'error'))
  }, [resetInspector, startSession])

  const totals: SessionTotals = {
    turns: turns.length,
    tokens: turns.reduce((sum, turn) => sum + (turn.total_tokens ?? 0), 0),
  }

  return { messages, status, snapshot, turns, totals, sessionId, send, newChat }
}
