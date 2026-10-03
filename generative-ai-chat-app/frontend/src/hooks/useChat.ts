import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, createSession, deleteSession, isAbortError, streamChat } from '../api/client'
import type {
  ChatMessage,
  ChatRole,
  ChatStatus,
  InspectorSnapshot,
  RawEvent,
  StreamEvent,
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
  rawEvents: RawEvent[]
  sessionId: string | null
  send: (text: string) => Promise<void>
  stop: () => void
  newChat: () => void
}

/** The Raw events tab keeps only the latest events so a long answer cannot fill memory. */
export const MAX_RAW_EVENTS = 200

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.'
}

export function useChat(): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<ChatStatus>('starting')
  const [snapshot, setSnapshot] = useState<InspectorSnapshot | null>(null)
  const [turns, setTurns] = useState<TurnStat[]>([])
  const [rawEvents, setRawEvents] = useState<RawEvent[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)

  const nextId = useRef(1)
  // The session id is mirrored in a ref so callbacks always see the latest value.
  const sessionRef = useRef<string | null>(null)
  // Bumped by newChat() so events that arrive for the old conversation are dropped.
  const epoch = useRef(0)
  const busy = useRef(false)
  const started = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const addMessage = useCallback((role: ChatRole, content: string): number => {
    const id = nextId.current++
    setMessages((prev) => [...prev, { id, role, content }])
    return id
  }, [])

  const updateMessage = useCallback((id: number, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }, [])

  const resetInspector = useCallback(() => {
    setSnapshot(null)
    setTurns([])
    setRawEvents([])
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
      const controller = new AbortController()
      abortRef.current = controller

      addMessage('user', message)
      setStatus('waiting')
      setRawEvents([])

      let assistantId: number | null = null
      let streamed = ''
      let finished = false // a completed or error event arrived
      let sessionLost = false

      const fail = (text: string) => {
        if (assistantId !== null) updateMessage(assistantId, { streaming: false })
        addMessage('error', text)
        setStatus('error')
      }

      const onEvent = (event: StreamEvent) => {
        if (myEpoch !== epoch.current) return
        switch (event.event) {
          case 'raw':
            setRawEvents((prev) => [...prev, event.data].slice(-MAX_RAW_EVENTS))
            break
          case 'delta':
            streamed += event.data.text
            if (assistantId === null) {
              assistantId = nextId.current++
              const id = assistantId
              setMessages((prev) => [
                ...prev,
                { id, role: 'assistant', content: streamed, streaming: true },
              ])
              setStatus('streaming')
            } else {
              updateMessage(assistantId, { content: streamed })
            }
            break
          case 'completed': {
            finished = true
            const { reply, inspector } = event.data
            if (assistantId === null) {
              addMessage('assistant', reply)
            } else {
              // The server's text is the one stored in memory, so show exactly that.
              updateMessage(assistantId, { content: reply, streaming: false })
            }
            setSnapshot(inspector)
            setTurns((prev) => [
              ...prev,
              {
                index: prev.length + 1,
                input_tokens: inspector.usage.input_tokens,
                output_tokens: inspector.usage.output_tokens,
                total_tokens: inspector.usage.total_tokens,
                ttft_ms: inspector.metrics.ttft_ms,
                latency_ms: inspector.metrics.latency_ms,
              },
            ])
            setStatus('idle')
            break
          }
          case 'error':
            finished = true
            sessionLost = event.data.code === 'session_not_found'
            fail(event.data.message)
            break
          default:
            break
        }
      }

      try {
        // If the first attempt to create a session failed, try again now.
        const id = sessionRef.current ?? (await startSession())
        if (!id) {
          setStatus('error')
          return
        }

        await streamChat(message, id, onEvent, controller.signal)
        if (myEpoch === epoch.current && !finished) {
          fail('The connection ended before the answer was complete.')
        }
      } catch (err) {
        if (myEpoch !== epoch.current) return
        if (isAbortError(err)) {
          // The user pressed Stop. The server saves nothing for an unfinished answer.
          if (assistantId !== null) updateMessage(assistantId, { streaming: false, stopped: true })
          setStatus('idle')
        } else {
          sessionLost = err instanceof ApiError && err.code === 'session_not_found'
          fail(errorMessage(err))
        }
      } finally {
        if (myEpoch === epoch.current) {
          busy.current = false
          abortRef.current = null
        }
      }

      if (sessionLost && myEpoch === epoch.current) {
        // The server forgot this conversation (e.g. it restarted): start a fresh one.
        resetInspector()
        await startSession()
      }
    },
    [addMessage, updateMessage, resetInspector, startSession],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const newChat = useCallback(() => {
    epoch.current += 1
    abortRef.current?.abort()
    abortRef.current = null
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

  return { messages, status, snapshot, turns, totals, rawEvents, sessionId, send, stop, newChat }
}
