import { useCallback, useRef, useState } from 'react'
import { ApiError, postChat } from '../api/client'
import type { ChatMessage, ChatRole, ChatStatus, InspectorSnapshot } from '../types'

export interface SessionTotals {
  turns: number
  tokens: number
}

export interface UseChat {
  messages: ChatMessage[]
  status: ChatStatus
  snapshot: InspectorSnapshot | null
  totals: SessionTotals
  send: (text: string) => Promise<void>
  clear: () => void
}

const EMPTY_TOTALS: SessionTotals = { turns: 0, tokens: 0 }

export function useChat(): UseChat {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [snapshot, setSnapshot] = useState<InspectorSnapshot | null>(null)
  const [totals, setTotals] = useState<SessionTotals>(EMPTY_TOTALS)

  const nextId = useRef(1)
  // Bumped by clear() so a reply that arrives after "Clear chat" is dropped.
  const epoch = useRef(0)
  const waiting = useRef(false)

  const addMessage = useCallback((role: ChatRole, content: string) => {
    setMessages((prev) => [...prev, { id: nextId.current++, role, content }])
  }, [])

  const send = useCallback(
    async (text: string) => {
      const message = text.trim()
      if (!message || waiting.current) return

      waiting.current = true
      const myEpoch = epoch.current
      addMessage('user', message)
      setStatus('waiting')

      try {
        const result = await postChat(message)
        if (myEpoch !== epoch.current) return
        addMessage('assistant', result.reply)
        setSnapshot(result.inspector)
        setTotals((prev) => ({
          turns: prev.turns + 1,
          tokens: prev.tokens + (result.inspector.usage.total_tokens ?? 0),
        }))
        setStatus('idle')
      } catch (err) {
        if (myEpoch !== epoch.current) return
        addMessage('error', err instanceof ApiError ? err.message : 'Something went wrong.')
        setStatus('error')
      } finally {
        if (myEpoch === epoch.current) waiting.current = false
      }
    },
    [addMessage],
  )

  const clear = useCallback(() => {
    epoch.current += 1
    waiting.current = false
    setMessages([])
    setSnapshot(null)
    setTotals(EMPTY_TOTALS)
    setStatus('idle')
  }, [])

  return { messages, status, snapshot, totals, send, clear }
}
