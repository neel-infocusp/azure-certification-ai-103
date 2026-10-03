import type { ChatMessage, ChatStatus } from '../types'
import { MessageInput } from './MessageInput'
import { MessageList } from './MessageList'

interface Props {
  messages: ChatMessage[]
  status: ChatStatus
  onSend: (text: string) => void
  onStop: () => void
}

export function ChatPanel({ messages, status, onSend, onStop }: Props) {
  return (
    <>
      <MessageList messages={messages} status={status} onPickSuggestion={onSend} />
      <MessageInput
        disabled={status === 'starting'}
        generating={status === 'waiting' || status === 'streaming'}
        onSend={onSend}
        onStop={onStop}
      />
    </>
  )
}
