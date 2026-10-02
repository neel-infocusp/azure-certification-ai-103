import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

interface Props {
  disabled: boolean
  onSend: (text: string) => void
}

const MAX_HEIGHT_PX = 160

export function MessageInput({ disabled, onSend }: Props) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  // Grow with the content, up to a limit.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [text])

  const submit = () => {
    const value = text.trim()
    if (!value || disabled) return
    onSend(value)
    setText('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      className="message-input"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <textarea
        ref={ref}
        value={text}
        rows={1}
        placeholder="Type your message… (Enter to send, Shift+Enter for a new line)"
        aria-label="Message"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className="btn btn--primary" disabled={disabled || !text.trim()}>
        Send
      </button>
    </form>
  )
}
