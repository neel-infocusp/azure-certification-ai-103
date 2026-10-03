import type { ChatResponse, ErrorCode, HealthResponse, MemoryResponse } from '../types'

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number

  constructor(code: ErrorCode, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new ApiError(
      'network_error',
      'Cannot reach the backend. Is it running on port 8000?',
      0,
    )
  }

  if (response.ok) {
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  // Backend errors look like { error: { code, message } }.
  try {
    const body = await response.json()
    if (body?.error?.message) {
      throw new ApiError(body.error.code ?? 'upstream_error', body.error.message, response.status)
    }
  } catch (err) {
    if (err instanceof ApiError) throw err
  }
  // e.g. the dev proxy answering 500 with an empty body while the backend is down
  throw new ApiError(
    'network_error',
    `The backend answered with HTTP ${response.status}. Is it running on port 8000?`,
    response.status,
  )
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health')
}

export function postChat(message: string, sessionId: string): Promise<ChatResponse> {
  return request<ChatResponse>('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
  })
}

export async function createSession(): Promise<string> {
  const created = await request<{ session_id: string }>('/api/sessions', { method: 'POST' })
  return created.session_id
}

export function deleteSession(sessionId: string): Promise<void> {
  return request<void>(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
}

export function getMemory(sessionId: string): Promise<MemoryResponse> {
  return request<MemoryResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/memory`)
}
