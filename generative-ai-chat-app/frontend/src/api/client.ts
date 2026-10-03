import type { ErrorCode, HealthResponse, MemoryResponse, Stats, StreamEvent } from '../types'
import { createSseParser } from './sse'

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

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

const BACKEND_UNREACHABLE = 'Cannot reach the backend. Is it running on port 8000?'

/** Turns a non-2xx response into an ApiError, using the backend's error shape when present. */
async function errorFromResponse(response: Response): Promise<ApiError> {
  // Backend errors look like { error: { code, message } }.
  try {
    const body = await response.json()
    if (body?.error?.message) {
      return new ApiError(body.error.code ?? 'upstream_error', body.error.message, response.status)
    }
  } catch {
    // not JSON, fall through
  }
  // e.g. the dev proxy answering 500 with an empty body while the backend is down
  return new ApiError(
    'network_error',
    `The backend answered with HTTP ${response.status}. Is it running on port 8000?`,
    response.status,
  )
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new ApiError('network_error', BACKEND_UNREACHABLE, 0)
  }

  if (!response.ok) throw await errorFromResponse(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health')
}

export function getStats(): Promise<Stats> {
  return request<Stats>('/api/stats')
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

/**
 * Sends a message and reports the streamed answer through `onEvent`, one event at a time.
 *
 * Resolves when the stream ends (the caller checks whether a `completed` or `error` event
 * arrived). Rejects with an ApiError for HTTP errors and lost connections, and with an
 * AbortError when `signal` is aborted (use isAbortError).
 */
export async function streamChat(
  message: string,
  sessionId: string,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id: sessionId }),
      signal,
    })
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new ApiError('network_error', BACKEND_UNREACHABLE, 0)
  }

  if (!response.ok) throw await errorFromResponse(response)
  if (!response.body) {
    throw new ApiError('network_error', 'The browser could not read the streamed answer.', 0)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
        onEvent(frame as StreamEvent)
      }
    }
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new ApiError(
      'network_error',
      'The connection was lost while the answer was streaming. Is the backend still running?',
      0,
    )
  }
}
