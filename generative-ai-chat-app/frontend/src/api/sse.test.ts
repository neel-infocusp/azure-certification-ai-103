import { describe, expect, it } from 'vitest'
import { createSseParser } from './sse'

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

describe('SSE parser', () => {
  it('parses a complete frame', () => {
    const parser = createSseParser()

    expect(parser.push(frame('delta', { text: 'Hi' }))).toEqual([{ event: 'delta', data: { text: 'Hi' } }])
  })

  it('parses several frames that arrive in one chunk', () => {
    const parser = createSseParser()

    const frames = parser.push(frame('delta', { text: 'a' }) + frame('delta', { text: 'b' }))

    expect(frames.map((f) => f.data)).toEqual([{ text: 'a' }, { text: 'b' }])
  })

  it('waits for the rest of a frame that is split across chunks', () => {
    const parser = createSseParser()
    const text = frame('delta', { text: 'split me' })

    expect(parser.push(text.slice(0, 10))).toEqual([])
    expect(parser.push(text.slice(10, 30))).toEqual([])
    expect(parser.push(text.slice(30))).toEqual([{ event: 'delta', data: { text: 'split me' } }])
  })

  it('handles a frame split right between its two newlines', () => {
    const parser = createSseParser()
    const text = frame('completed', { ok: true })

    expect(parser.push(text.slice(0, -1))).toEqual([])
    expect(parser.push(text.slice(-1))).toEqual([{ event: 'completed', data: { ok: true } }])
  })

  it('accepts CRLF line endings, even when the CR and LF arrive separately', () => {
    const parser = createSseParser()

    expect(parser.push('event: delta\r\ndata: {"text":"x"}\r')).toEqual([])
    expect(parser.push('\n\r\n')).toEqual([{ event: 'delta', data: { text: 'x' } }])
  })

  it('ignores comments and frames without data, and defaults the event name', () => {
    const parser = createSseParser()

    const frames = parser.push(': keep-alive\n\nevent: ping\n\ndata: {"a":1}\n\n')

    expect(frames).toEqual([{ event: 'message', data: { a: 1 } }])
  })

  it('joins multi-line data and keeps non-JSON data as text', () => {
    const parser = createSseParser()

    expect(parser.push('event: note\ndata: line one\ndata: line two\n\n')).toEqual([
      { event: 'note', data: 'line one\nline two' },
    ])
  })

  it('keeps text with special characters intact', () => {
    const parser = createSseParser()
    const text = 'Line one\nLine "two" — ünïcode ✓'

    expect(parser.push(frame('delta', { text }))[0].data).toEqual({ text })
  })
})
