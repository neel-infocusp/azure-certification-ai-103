import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { formatLatency, formatNumber, formatSpeed } from './lib/format'

const HEALTH = { status: 'ok', model_deployment: 'gpt-test', endpoint_host: 'x.openai.azure.com', round: 5 }

const REPLY_1 = 'ELIZA was an early chatbot.'
const REPLY_2 = 'It was far simpler than modern LLMs.'

// ---------- fake SSE backend ----------

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function inspector(n: number, reply: string, input: string) {
  return {
    api: 'responses',
    request: {
      model: 'gpt-test',
      stream: true,
      instructions: 'Test system prompt.',
      input,
      previous_response_id: n > 1 ? `resp_${n - 1}` : null,
    },
    response: { id: `resp_${n}`, status: 'completed' },
    usage: { input_tokens: 38 * n, output_tokens: 400, total_tokens: 38 * n + 400, reasoning_tokens: null, cached_tokens: null },
    metrics: { latency_ms: 4200, ttft_ms: 900, chunk_count: 2 },
    memory: {
      mode: 'previous_response_id',
      response_chain: Array.from({ length: n }, (_, i) => `resp_${i + 1}`),
      transcript: [
        { role: 'user', content: input },
        { role: 'assistant', content: reply },
      ],
    },
    raw: { id: `resp_${n}`, status: 'completed' },
  }
}

const META = (input = 'hi') =>
  sse('meta', { turn_id: 't_1', request: inspector(1, '', input).request })

const RAW_CREATED = sse('raw', { seq: 1, type: 'response.created', summary: 'resp_1 in_progress' })

function delta(text: string, seq = 2) {
  return sse('delta', { text }) + sse('raw', { seq, type: 'response.output_text.delta', summary: text })
}

/** A whole streamed answer as SSE text. */
function fullStream(n: number, reply: string, input = 'hi'): string {
  const half = Math.floor(reply.length / 2)
  return (
    META(input) +
    RAW_CREATED +
    delta(reply.slice(0, half), 2) +
    delta(reply.slice(half), 3) +
    sse('raw', { seq: 4, type: 'response.completed', summary: `resp_${n} completed` }) +
    sse('completed', { reply, inspector: inspector(n, reply, input) })
  )
}

function sseResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

/** A streamed response the test feeds by hand. Aborting the request errors the stream. */
function controlledStream(signal?: AbortSignal) {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      signal?.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')))
    },
  })
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  }
}

interface Backend {
  stream: (n: number, body: { message: string; session_id: string }, signal?: AbortSignal) => Response | Promise<Response>
  memory: () => Promise<Response>
  stats: () => Promise<Response>
}

/** Fake backend: health, sessions, streaming chat and memory. Records every call. */
function mockBackend(backend: Partial<Backend> = {}) {
  let sessions = 0
  let turn = 0
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/health') return jsonResponse(HEALTH)
    if (url === '/api/stats') {
      return backend.stats?.() ?? jsonResponse({ in_flight: 0, total_requests: 3, avg_latency_ms: 1200 })
    }
    if (url === '/api/sessions' && method === 'POST') {
      sessions += 1
      return jsonResponse({ session_id: `s_${sessions}` }, 201)
    }
    if (url.startsWith('/api/sessions/') && method === 'DELETE') {
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    if (url.endsWith('/memory')) {
      return (
        backend.memory?.() ??
        jsonResponse({
          mode: 'previous_response_id',
          last_response_id: 'resp_1',
          response_chain: ['resp_1'],
          transcript: [],
          server_items: null,
          server_items_note: 'The service did not return stored input items for this response.',
        })
      )
    }
    if (url === '/api/chat/stream') {
      turn += 1
      const body = JSON.parse(String(init?.body))
      return Promise.resolve(
        backend.stream ? backend.stream(turn, body, init?.signal ?? undefined) : sseResponse(fullStream(turn, REPLY_1, body.message)),
      )
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

type FetchMock = ReturnType<typeof mockBackend>

function chatCalls(fetchMock: FetchMock) {
  return fetchMock.mock.calls
    .filter(([url]) => url === '/api/chat/stream')
    .map(([, init]) => JSON.parse(String(init?.body)))
}

function sessionCreations(fetchMock: FetchMock) {
  return fetchMock.mock.calls.filter(([url, init]) => url === '/api/sessions' && init?.method === 'POST').length
}

type User = ReturnType<typeof userEvent.setup>

async function sendMessage(user: User, text: string) {
  const input = await screen.findByLabelText('Message')
  await user.type(input, text)
  // Send is only enabled once the session exists and there is text.
  const send = await screen.findByRole('button', { name: 'Send' })
  await waitFor(() => expect(send).toBeEnabled())
  await user.click(send)
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

// ---------- streaming chat ----------

describe('streaming chat', () => {
  it('creates a session, streams the answer and fills the inspector', async () => {
    const fetchMock = mockBackend()
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('gpt-test')).toBeInTheDocument()
    expect(screen.getByText('Round 5')).toBeInTheDocument()

    await sendMessage(user, 'Tell me about the ELIZA chatbot.')

    expect(await screen.findByText(REPLY_1)).toBeInTheDocument()
    expect(chatCalls(fetchMock)).toEqual([
      { message: 'Tell me about the ELIZA chatbot.', session_id: 's_1' },
    ])
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()

    // Context tab is open by default.
    expect(screen.getByText('Test system prompt.')).toBeInTheDocument()
    expect(screen.getByText('none (first message)')).toBeInTheDocument()
    expect(screen.getByText('yes')).toBeInTheDocument() // Streaming: yes

    await user.click(screen.getByRole('tab', { name: 'Metrics' }))
    expect(screen.getByText('4.2 s', { selector: '.stat-value' })).toBeInTheDocument()
    expect(screen.getByText('900 ms', { selector: '.stat-value' })).toBeInTheDocument()
    expect(screen.getByText('Chunks').nextSibling?.textContent).toBe('2')
    expect(screen.getByText('~121 tok/s')).toBeInTheDocument() // 400 tokens / 3.3 s
    expect(screen.getByText('resp_1')).toBeInTheDocument()
  })

  it('shows the answer while it arrives and swaps Send for Stop', async () => {
    let feed!: ReturnType<typeof controlledStream>
    mockBackend({
      stream: (_n, _body, signal) => {
        feed = controlledStream(signal)
        return feed.response
      },
    })
    const user = userEvent.setup()
    const { container } = render(<App />)

    await sendMessage(user, 'hi')
    await screen.findByText('Thinking…')
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()

    feed.push(META() + delta('ELIZA was '))
    expect(await screen.findByText('ELIZA was')).toBeInTheDocument()
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument()
    expect(container.querySelector('.caret')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()

    feed.push(delta('an early chatbot.', 3))
    expect(await screen.findByText(REPLY_1)).toBeInTheDocument()

    feed.push(sse('completed', { reply: REPLY_1, inspector: inspector(1, REPLY_1, 'hi') }))
    feed.close()
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(container.querySelector('.caret')).toBeNull()
  })

  it('keeps the same session across turns and shows the previous response id', async () => {
    const fetchMock = mockBackend({
      stream: (n, body) => sseResponse(fullStream(n, n === 1 ? REPLY_1 : REPLY_2, body.message)),
    })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'Tell me about the ELIZA chatbot.')
    await screen.findByText(REPLY_1)
    await sendMessage(user, 'How does it compare to modern LLMs?')
    await screen.findByText(REPLY_2)

    expect(chatCalls(fetchMock).map((c) => c.session_id)).toEqual(['s_1', 's_1'])
    expect(screen.getByText('resp_1', { selector: '.mono--accent' })).toBeInTheDocument()
  })

  it('shows the response chain, transcript mirror and token growth', async () => {
    mockBackend({
      stream: (n, body) => sseResponse(fullStream(n, n === 1 ? REPLY_1 : REPLY_2, body.message)),
    })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'first')
    await screen.findByText(REPLY_1)
    await sendMessage(user, 'second')
    await screen.findByText(REPLY_2)

    await user.click(screen.getByRole('tab', { name: 'Memory' }))
    const chain = within(document.querySelector('.chain') as HTMLElement)
    expect(chain.getByText('resp_1')).toBeInTheDocument()
    expect(chain.getByText('resp_2')).toBeInTheDocument()
    expect(chain.getByText('latest')).toBeInTheDocument()
    expect(await screen.findByText(/did not return stored input items/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Metrics' }))
    const rows = document.querySelectorAll('.turn-table tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('38')
    expect(rows[1].textContent).toContain('76')
    expect(rows[1].textContent).toContain('900 ms') // first token
  })

  it('lists the model events live in the Raw events tab and resets them each turn', async () => {
    mockBackend({
      stream: (n, body) => sseResponse(fullStream(n, n === 1 ? REPLY_1 : REPLY_2, body.message)),
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('tab', { name: 'Raw events' }))
    expect(screen.getByText(/Send a message to see the live events/)).toBeInTheDocument()

    await sendMessage(user, 'first')
    await screen.findByText(REPLY_1)

    const log = within(screen.getByRole('log', { name: 'Raw events' }))
    expect(log.getAllByText('response.output_text.delta')).toHaveLength(2)
    expect(log.getByText('response.created')).toBeInTheDocument()
    expect(log.getByText('response.completed')).toBeInTheDocument()
    expect(screen.getByText(/4 events for the last turn/)).toBeInTheDocument()

    await sendMessage(user, 'second')
    await screen.findByText(REPLY_2)
    expect(screen.getByText(/4 events for the last turn/)).toBeInTheDocument()
  })

  it('shows server items when the service returns them', async () => {
    mockBackend({
      memory: () =>
        jsonResponse({
          mode: 'previous_response_id',
          last_response_id: 'resp_1',
          response_chain: ['resp_1'],
          transcript: [],
          server_items: [{ type: 'message', role: 'user' }],
          server_items_note: null,
        }),
    })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'hello')
    await screen.findByText(REPLY_1)
    await user.click(screen.getByRole('tab', { name: 'Memory' }))

    expect(await screen.findByText('Input items stored for the last response')).toBeInTheDocument()
  })
})

// ---------- failures and Stop ----------

describe('failures and Stop', () => {
  it('keeps the partial text and shows the error when the stream fails midway', async () => {
    mockBackend({
      stream: () =>
        sseResponse(
          META() + delta('Partial answer ') + sse('error', { code: 'upstream_error', message: 'The model service had a problem.' }),
        ),
    })
    const user = userEvent.setup()
    const { container } = render(<App />)

    await sendMessage(user, 'hello')

    expect(await screen.findByText('The model service had a problem.')).toBeInTheDocument()
    expect(screen.getByText('Partial answer')).toBeInTheDocument()
    expect(container.querySelector('.caret')).toBeNull()
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toBeEnabled()
  })

  it('shows a readable error when the request is rejected before streaming', async () => {
    mockBackend({
      stream: () =>
        new Response(JSON.stringify({ error: { code: 'auth_failed', message: 'Authentication failed. Check the API key.' } }), {
          status: 401,
        }),
    })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'hello')

    expect(await screen.findByText(/Check the API key/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('reports an answer that stops without finishing', async () => {
    mockBackend({ stream: () => sseResponse(META() + delta('Half an ans')) })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'hello')

    expect(await screen.findByText('The connection ended before the answer was complete.')).toBeInTheDocument()
    expect(screen.getByText('Half an ans')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('reports a lost connection while streaming', async () => {
    mockBackend({
      stream: (_n, _body, signal) => {
        const feed = controlledStream(signal)
        feed.push(META() + delta('Some text '))
        setTimeout(() => feed.close(), 0) // closes cleanly, but with no completed event
        return feed.response
      },
    })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'hello')

    expect(await screen.findByText(/connection ended before the answer was complete/)).toBeInTheDocument()
  })

  it('starts a new session when the server has forgotten the old one', async () => {
    const fetchMock = mockBackend({
      stream: (n) =>
        n === 1
          ? new Response(JSON.stringify({ error: { code: 'session_not_found', message: 'The server forgot this conversation.' } }), { status: 404 })
          : sseResponse(fullStream(2, REPLY_1)),
    })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'hello')
    expect(await screen.findByText('The server forgot this conversation.')).toBeInTheDocument()
    await waitFor(() => expect(sessionCreations(fetchMock)).toBe(2))

    await sendMessage(user, 'hello again')
    await screen.findByText(REPLY_1)
    expect(chatCalls(fetchMock).map((c) => c.session_id)).toEqual(['s_1', 's_2'])
  })

  it('also recovers when the lost session is reported inside the stream', async () => {
    const fetchMock = mockBackend({
      stream: (n) =>
        n === 1
          ? sseResponse(META() + sse('error', { code: 'session_not_found', message: 'Session gone.' }))
          : sseResponse(fullStream(2, REPLY_1)),
    })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'hello')
    expect(await screen.findByText('Session gone.')).toBeInTheDocument()
    await waitFor(() => expect(sessionCreations(fetchMock)).toBe(2))
  })

  it('Stop keeps the partial answer, marks it as not saved and allows a new message', async () => {
    const fetchMock = mockBackend({
      stream: (n, _body, signal) => {
        if (n > 1) return sseResponse(fullStream(n, REPLY_2))
        const feed = controlledStream(signal)
        feed.push(META() + delta('ELIZA was '))
        return feed.response
      },
    })
    const user = userEvent.setup()
    const { container } = render(<App />)

    await sendMessage(user, 'hi')
    expect(await screen.findByText('ELIZA was')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(await screen.findByText(/Stopped\. This answer is not saved/)).toBeInTheDocument()
    expect(screen.getByText('ELIZA was')).toBeInTheDocument()
    expect(container.querySelector('.caret')).toBeNull()
    expect(screen.queryByText(/connection/i)).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()

    await sendMessage(user, 'again')
    await screen.findByText(REPLY_2)
    expect(chatCalls(fetchMock)).toHaveLength(2)
  })

  it('Stop before the first word leaves no error behind', async () => {
    mockBackend({
      stream: (_n, _body, signal) => controlledStream(signal).response,
    })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'hi')
    await user.click(await screen.findByRole('button', { name: 'Stop' }))

    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument()
    expect(document.querySelector('.bubble--error')).toBeNull()
  })

  it('New chat during a stream cancels it and starts a fresh conversation', async () => {
    const fetchMock = mockBackend({
      stream: (n, _body, signal) => {
        if (n > 1) return sseResponse(fullStream(n, REPLY_2))
        const feed = controlledStream(signal)
        feed.push(META() + delta('ELIZA was '))
        return feed.response
      },
    })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'hi')
    await screen.findByText('ELIZA was')

    await user.click(screen.getByRole('button', { name: 'New chat' }))

    await waitFor(() => expect(screen.queryByText('ELIZA was')).not.toBeInTheDocument())
    expect(screen.getByText('Start a conversation')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s_1', { method: 'DELETE' })

    await sendMessage(user, 'fresh start')
    await screen.findByText(REPLY_2)
    expect(chatCalls(fetchMock)[1]).toEqual({ message: 'fresh start', session_id: 's_2' })
  })

  it('New chat deletes the old session, clears the screen and starts a new session', async () => {
    const fetchMock = mockBackend()
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'hi')
    await screen.findByText(REPLY_1)

    await user.click(screen.getByRole('button', { name: 'New chat' }))

    expect(screen.queryByText(REPLY_1)).not.toBeInTheDocument()
    expect(screen.getByText('Start a conversation')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s_1', { method: 'DELETE' })
  })
})

// ---------- backend activity (async backend) ----------

describe('backend activity', () => {
  it('shows how many model calls are running, with the total served as a tooltip', async () => {
    mockBackend()
    render(<App />)

    const badge = await screen.findByText('In flight: 0')
    expect(badge).toHaveAttribute('title', expect.stringContaining('3 served'))
  })

  it('hides the readout when the backend cannot report its stats', async () => {
    mockBackend({ stats: () => jsonResponse({ error: { code: 'upstream_error', message: 'no' } }, 500) })
    render(<App />)

    await screen.findByText('gpt-test')
    expect(screen.queryByText(/In flight/)).not.toBeInTheDocument()
  })

  it('lists the backend numbers in the Metrics tab, even before the first message', async () => {
    mockBackend()
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('tab', { name: 'Metrics' }))

    expect(await screen.findByText('Backend (all conversations)')).toBeInTheDocument()
    expect(screen.getByText('Served').nextSibling?.textContent).toBe('3')
    expect(screen.getByText('Avg latency').nextSibling?.textContent).toBe('1.2 s')
  })

  it('follows a running answer: busy while it streams, idle when it finishes', async () => {
    let inFlight = 0
    let feed!: ReturnType<typeof controlledStream>
    mockBackend({
      stats: () => jsonResponse({ in_flight: inFlight, total_requests: 3, avg_latency_ms: null }),
      stream: (_n, _body, signal) => {
        inFlight = 1
        feed = controlledStream(signal)
        return feed.response
      },
    })
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('In flight: 0')

    await sendMessage(user, 'hi')
    feed.push(META() + delta('ELIZA was '))
    expect(await screen.findByText('In flight: 1')).toBeInTheDocument()

    inFlight = 0
    feed.push(delta('an early chatbot.', 3))
    feed.push(sse('completed', { reply: REPLY_1, inspector: inspector(1, REPLY_1, 'hi') }))
    feed.close()
    expect(await screen.findByText('In flight: 0')).toBeInTheDocument()
  })
})

// ---------- markdown, theme, helpers ----------

describe('markdown in AI replies', () => {
  const markdown = [
    'I can help with:',
    '',
    '- **Writing**: emails and essays',
    '- **Coding**: debugging',
    '',
    'Use `pip install` to start.',
    '',
    '<script>alert(1)</script>',
  ].join('\n')

  it('renders bold text, lists and inline code instead of raw markdown symbols', async () => {
    mockBackend({ stream: (n) => sseResponse(fullStream(n, markdown)) })
    const user = userEvent.setup()
    const { container } = render(<App />)

    await sendMessage(user, 'what can you do?')

    const bold = await screen.findByText('Writing')
    expect(bold.tagName).toBe('STRONG')
    expect(container.querySelectorAll('.markdown li')).toHaveLength(2)
    expect(screen.getByText('pip install').tagName).toBe('CODE')
    expect(container.textContent).not.toContain('**')
  })

  it('does not turn raw HTML in a reply into real elements', async () => {
    mockBackend({ stream: (n) => sseResponse(fullStream(n, markdown)) })
    const user = userEvent.setup()
    const { container } = render(<App />)

    await sendMessage(user, 'hi')
    await screen.findByText('Writing')

    expect(container.querySelector('.markdown script')).toBeNull()
  })

  it('keeps the user message as plain text', async () => {
    mockBackend()
    const user = userEvent.setup()
    const { container } = render(<App />)

    await sendMessage(user, '**not bold**')
    await screen.findByText(REPLY_1)

    expect(container.querySelector('.bubble--user .bubble-text')?.textContent).toBe('**not bold**')
  })
})

describe('theme toggle', () => {
  it('switches between light and dark and remembers the choice', async () => {
    mockBackend()
    const user = userEvent.setup()
    render(<App />)

    expect(document.documentElement.dataset.theme).toBe('light')

    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')

    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('starts from the saved theme', () => {
    localStorage.setItem('theme', 'dark')
    mockBackend()
    render(<App />)

    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('format helpers', () => {
  it('formats numbers and latency, with a dash for missing values', () => {
    expect(formatNumber(1234)).toBe('1,234')
    expect(formatNumber(null)).toBe('—')
    expect(formatLatency(850)).toBe('850 ms')
    expect(formatLatency(4200)).toBe('4.2 s')
    expect(formatLatency(null)).toBe('—')
  })

  it('computes the approximate speed after the first token', () => {
    expect(formatSpeed(400, { latency_ms: 4200, ttft_ms: 900 })).toBe('~121 tok/s')
    expect(formatSpeed(400, { latency_ms: 4200, ttft_ms: null })).toBe('—')
    expect(formatSpeed(null, { latency_ms: 4200, ttft_ms: 900 })).toBe('—')
    expect(formatSpeed(400, { latency_ms: 900, ttft_ms: 900 })).toBe('—')
  })
})
