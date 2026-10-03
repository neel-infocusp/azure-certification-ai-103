import { useEffect, useRef } from 'react'
import type { ChatMessage, ChatStatus } from '../types'
import { Markdown } from './Markdown'

interface Props {
  messages: ChatMessage[]
  status: ChatStatus
  onPickSuggestion: (text: string) => void
}

const SUGGESTIONS = ['Tell me about the ELIZA chatbot.', 'How does it compare to modern LLMs?']

/** How close to the bottom (px) counts as "following" the answer as it streams in. */
const FOLLOW_THRESHOLD_PX = 80

export function MessageList({ messages, status, onPickSuggestion }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)

  // Keep the newest text in view, unless the user scrolled up to read something earlier.
  useEffect(() => {
    const el = listRef.current
    if (el && following.current) el.scrollTop = el.scrollHeight
  }, [messages, status])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX
  }

  if (messages.length === 0 && status !== 'waiting') {
    return (
      <div className="message-list message-list--empty">
        <p className="empty-title">Start a conversation</p>
        <p className="empty-hint">
          The AI remembers this conversation, so you can ask follow-up questions. Use New chat
          to start fresh.
        </p>
        <div className="suggestions">
          {SUGGESTIONS.map((text) => (
            <button key={text} type="button" className="chip" onClick={() => onPickSuggestion(text)}>
              {text}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="message-list" role="log" aria-live="polite" ref={listRef} onScroll={onScroll}>
      {messages.map((m) => (
        <div key={m.id} className={`bubble bubble--${m.role}`}>
          <span className="bubble-author">
            {m.role === 'user' ? 'You' : m.role === 'assistant' ? 'AI' : 'Error'}
          </span>
          {m.role === 'assistant' ? (
            <Markdown>{m.content}</Markdown>
          ) : (
            <div className="bubble-text">{m.content}</div>
          )}
          {m.streaming && <span className="caret" aria-hidden="true" />}
          {m.stopped && (
            <span className="bubble-note">Stopped. This answer is not saved to the conversation.</span>
          )}
        </div>
      ))}
      {status === 'waiting' && (
        <div className="bubble bubble--assistant bubble--thinking" aria-label="The AI is thinking">
          <span className="bubble-author">AI</span>
          <div className="bubble-text">
            <span className="dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            Thinking…
          </div>
        </div>
      )}
    </div>
  )
}
