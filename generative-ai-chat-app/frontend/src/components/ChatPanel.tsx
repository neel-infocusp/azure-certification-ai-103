import type { ChatMessage, ChatStatus } from '../types'
import { MessageInput } from './MessageInput'
import { MessageList } from './MessageList'

interface Props {
  messages: ChatMessage[]
  status: ChatStatus
  onSend: (text: string) => void
}

export function ChatPanel({ messages, status, onSend }: Props) {
  return (
    <>
      <MessageList messages={messages} status={status} onPickSuggestion={onSend} />
      <MessageInput disabled={status === 'waiting' || status === 'starting'} onSend={onSend} />
    </>
  )
}
