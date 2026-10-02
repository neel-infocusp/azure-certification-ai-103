import { useEffect, useRef } from 'react'
import type { ChatMessage, ChatStatus } from '../types'
import { Markdown } from './Markdown'

interface Props {
  messages: ChatMessage[]
  status: ChatStatus
  onPickSuggestion: (text: string) => void
}

const SUGGESTIONS = ['Tell me about the ELIZA chatbot.', 'How does it compare to modern LLMs?']

export function MessageList({ messages, status, onPickSuggestion }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages, status])

  if (messages.length === 0 && status !== 'waiting') {
    return (
      <div className="message-list message-list--empty">
        <p className="empty-title">Start a conversation</p>
        <p className="empty-hint">
          Each message is sent on its own, so the AI will not remember earlier ones (yet).
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
    <div className="message-list" role="log" aria-live="polite">
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
      <div ref={endRef} />
    </div>
  )
}
