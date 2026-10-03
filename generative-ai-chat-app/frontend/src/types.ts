// Mirrors backend/app/schemas.py. Keep the two in sync.

export interface RequestView {
  model: string
  instructions: string
  input: string
  previous_response_id: string | null
  stream: boolean
}

export interface ResponseView {
  id: string | null
  status: string | null
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

export interface TranscriptMessage {
  role: string
  content: string
}

export interface MemoryView {
  mode: 'none' | 'previous_response_id'
  response_chain: string[]
  transcript: TranscriptMessage[]
}

export interface MemoryResponse extends MemoryView {
  last_response_id: string | null
  server_items: Record<string, unknown>[] | null
  server_items_note: string | null
}

export interface InspectorSnapshot {
  api: 'responses'
  request: RequestView
  response: ResponseView
  usage: Usage
  metrics: TurnMetrics
  memory: MemoryView
  raw: Record<string, unknown> | null
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
  | 'session_not_found'
  | 'upstream_error'
  | 'network_error'

// UI-only types

export type ChatRole = 'user' | 'assistant' | 'error'

export interface ChatMessage {
  id: number
  role: ChatRole
  content: string
}

export type ChatStatus = 'starting' | 'idle' | 'waiting' | 'error'

/** One row of the per-turn token table in the Metrics tab. */
export interface TurnStat {
  index: number
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  latency_ms: number
}
