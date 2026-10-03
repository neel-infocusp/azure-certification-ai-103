export interface SseFrame {
  event: string
  data: unknown
}

/**
 * Incremental parser for a Server-Sent Events stream.
 *
 * Network chunks can cut a frame anywhere, so push() keeps the unfinished tail and only
 * returns frames that are complete (they end with a blank line).
 */
export function createSseParser() {
  let buffer = ''

  return {
    push(chunk: string): SseFrame[] {
      buffer = (buffer + chunk).replace(/\r\n/g, '\n')
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      const frames: SseFrame[] = []
      for (const part of parts) {
        const frame = parseFrame(part)
        if (frame) frames.push(frame)
      }
      return frames
    },
  }
}

function parseFrame(text: string): SseFrame | null {
  let event = 'message'
  const dataLines: string[] = []

  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith(':')) continue // blank or comment
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }

  if (dataLines.length === 0) return null
  const raw = dataLines.join('\n')
  try {
    return { event, data: JSON.parse(raw) }
  } catch {
    return { event, data: raw }
  }
}
