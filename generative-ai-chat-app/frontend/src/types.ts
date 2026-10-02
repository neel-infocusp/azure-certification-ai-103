// Mirrors backend/app/schemas.py. Keep the two in sync.

export interface ApiMessage {
  role: string
  content: string
}

export interface RequestView {
  model: string
  messages: ApiMessage[]
  stream: boolean
}

export interface ResponseView {
  id: string | null
  finish_reason: string | null
}

export interface Usage {
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  reasoning_tokens: number | null
  cached_tokens: number | null
}

export interface TurnMetrics {
  latency_ms: number
}

export interface InspectorSnapshot {
  api: 'chat.completions'
  request: RequestView
  response: ResponseView
  usage: Usage
  metrics: TurnMetrics
  memory: { mode: 'none' }
}

export interface ChatResponse {
  reply: string
  inspector: InspectorSnapshot
}

export interface HealthResponse {
  status: 'ok'
  model_deployment: string
  endpoint_host: string
  round: number
}

export type ErrorCode =
  | 'auth_failed'
  | 'deployment_not_found'
  | 'rate_limited'
  | 'bad_request'
  | 'upstream_error'
  | 'network_error'

// UI-only types

export type ChatRole = 'user' | 'assistant' | 'error'

export interface ChatMessage {
  id: number
  role: ChatRole
  content: string
}

export type ChatStatus = 'idle' | 'waiting' | 'error'
