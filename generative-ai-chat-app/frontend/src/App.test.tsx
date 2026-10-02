import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { formatLatency, formatNumber } from './lib/format'

const HEALTH = { status: 'ok', model_deployment: 'gpt-test', endpoint_host: 'x.openai.azure.com', round: 3 }

function chatReply(n: number, reply = 'ELIZA was an early chatbot.', input = 'Tell me about the ELIZA chatbot.') {
  const chain = Array.from({ length: n }, (_, i) => `resp_${i + 1}`)
  return {
    reply,
    inspector: {
      api: 'responses',
      request: {
        model: 'gpt-test',
        stream: false,
        instructions: 'Test system prompt.',
        input,
        previous_response_id: n > 1 ? `resp_${n - 1}` : null,
      },
      response: { id: `resp_${n}`, status: 'completed' },
      usage: { input_tokens: 38 * n, output_tokens: 410, total_tokens: 38 * n + 410, reasoning_tokens: null, cached_tokens: null },
      metrics: { latency_ms: 4200 },
      memory: {
        mode: 'previous_response_id',
        response_chain: chain,
        transcript: [
          { role: 'user', content: input },
          { role: 'assistant', content: reply },
        ],
      },
      raw: { id: `resp_${n}`, status: 'completed' },
    },
  }
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

interface Backend {
  chat: (n: number, body: { message: string; session_id: string }) => Promise<Response>
  memory?: () => Promise<Response>
}

/** Fake backend: health, sessions, chat and memory. Records every call. */
function mockBackend(backend: Partial<Backend> = {}) {
  let sessions = 0
  let turn = 0
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/health') return jsonResponse(HEALTH)
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
    if (url === '/api/chat') {
      turn += 1
      const body = JSON.parse(String(init?.body))
      return backend.chat ? backend.chat(turn, body) : jsonResponse(chatReply(turn))
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function chatCalls(fetchMock: ReturnType<typeof mockBackend>) {
  return fetchMock.mock.calls
    .filter(([url]) => url === '/api/chat')
    .map(([, init]) => JSON.parse(String(init?.body)))
}

async function sendMessage(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = await screen.findByLabelText('Message')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled())
  await user.type(input, text)
  await user.click(screen.getByRole('button', { name: 'Send' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('App', () => {
  it('creates a session, shows health info, sends a message and fills the inspector', async () => {
    const fetchMock = mockBackend()
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('gpt-test')).toBeInTheDocument()
    expect(screen.getByText('Round 3')).toBeInTheDocument()

    await sendMessage(user, 'Tell me about the ELIZA chatbot.')

    expect(await screen.findByText('ELIZA was an early chatbot.')).toBeInTheDocument()
    expect(chatCalls(fetchMock)).toEqual([
      { message: 'Tell me about the ELIZA chatbot.', session_id: 's_1' },
    ])
    // Context tab is open by default and shows the instructions and input sent.
    expect(screen.getByText('Test system prompt.')).toBeInTheDocument()
    expect(screen.getByText('none (first message)')).toBeInTheDocument()
    expect(screen.getByText('Raw response')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Metrics' }))
    expect(screen.getByText('4.2 s', { selector: '.stat-value' })).toBeInTheDocument()
    expect(screen.getByText('resp_1')).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
  })

  it('keeps using the same session, and shows the previous response id on a follow-up', async () => {
    const fetchMock = mockBackend({
      chat: (n) =>
        jsonResponse(
          n === 1
            ? chatReply(1)
            : chatReply(2, 'It was far simpler than modern LLMs.', 'How does it compare to modern LLMs?'),
        ),
    })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'Tell me about the ELIZA chatbot.')
    await screen.findByText('ELIZA was an early chatbot.')
    await sendMessage(user, 'How does it compare to modern LLMs?')
    await screen.findByText('It was far simpler than modern LLMs.')

    expect(chatCalls(fetchMock).map((c) => c.session_id)).toEqual(['s_1', 's_1'])
    expect(screen.getByText('resp_1', { selector: '.mono--accent' })).toBeInTheDocument()
  })

  it('shows the response chain, transcript mirror and token growth', async () => {
    mockBackend({
      chat: (n) =>
        jsonResponse(
          n === 1
            ? chatReply(1)
            : chatReply(2, 'It was far simpler than modern LLMs.', 'How does it compare to modern LLMs?'),
        ),
    })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'first')
    await screen.findByText('ELIZA was an early chatbot.')
    await sendMessage(user, 'second')
    await screen.findByText('It was far simpler than modern LLMs.')

    await user.click(screen.getByRole('tab', { name: 'Memory' }))
    const chain = within(document.querySelector('.chain') as HTMLElement)
    expect(chain.getByText('resp_1')).toBeInTheDocument()
    expect(chain.getByText('resp_2')).toBeInTheDocument()
    expect(chain.getByText('latest')).toBeInTheDocument()
    expect(screen.getByText('How does it compare to modern LLMs?', { selector: '.transcript-row' })).toBeInTheDocument()
    expect(await screen.findByText(/did not return stored input items/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Metrics' }))
    const rows = document.querySelectorAll('.turn-table tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('38')
    expect(rows[1].textContent).toContain('76')
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
    await screen.findByText('ELIZA was an early chatbot.')
    await user.click(screen.getByRole('tab', { name: 'Memory' }))

    expect(await screen.findByText('Input items stored for the last response')).toBeInTheDocument()
  })

  it('shows a readable error and stays usable when the backend fails', async () => {
    mockBackend({
      chat: () =>
        jsonResponse({ error: { code: 'auth_failed', message: 'Authentication failed. Check the API key.' } }, 401),
    })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'hello')

    await waitFor(() => expect(screen.getByText(/Check the API key/)).toBeInTheDocument())
    expect(screen.getByLabelText('Message')).toBeEnabled()
  })

  it('starts a new session when the server has forgotten the old one', async () => {
    const fetchMock = mockBackend({
      chat: (n) =>
        n === 1
          ? jsonResponse({ error: { code: 'session_not_found', message: 'The server forgot this conversation.' } }, 404)
          : jsonResponse(chatReply(2)),
    })
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'hello')
    expect(await screen.findByText('The server forgot this conversation.')).toBeInTheDocument()

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url, init]) => url === '/api/sessions' && init?.method === 'POST')).toHaveLength(2),
    )
    await sendMessage(user, 'hello again')
    await screen.findByText('ELIZA was an early chatbot.')
    expect(chatCalls(fetchMock).map((c) => c.session_id)).toEqual(['s_1', 's_2'])
  })

  it('New chat deletes the old session, clears the screen and starts a new session', async () => {
    const fetchMock = mockBackend()
    const user = userEvent.setup()
    render(<App />)

    await sendMessage(user, 'hi')
    await screen.findByText('ELIZA was an early chatbot.')

    await user.click(screen.getByRole('button', { name: 'New chat' }))

    expect(screen.queryByText('ELIZA was an early chatbot.')).not.toBeInTheDocument()
    expect(screen.getByText('Start a conversation')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled())
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s_1', { method: 'DELETE' })

    await sendMessage(user, 'fresh start')
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(2))
    expect(chatCalls(fetchMock)[1]).toEqual({ message: 'fresh start', session_id: 's_2' })
  })
})

describe('markdown in AI replies', () => {
  const markdownReply = {
    ...chatReply(1),
    reply: [
      'I can help with:',
      '',
      '- **Writing**: emails and essays',
      '- **Coding**: debugging',
      '',
      'Use `pip install` to start.',
      '',
      '<script>alert(1)</script>',
    ].join('\n'),
  }

  it('renders bold text, lists and inline code instead of raw markdown symbols', async () => {
    mockBackend({ chat: () => jsonResponse(markdownReply) })
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
    mockBackend({ chat: () => jsonResponse(markdownReply) })
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
    await screen.findByText('ELIZA was an early chatbot.')

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
  })
})
