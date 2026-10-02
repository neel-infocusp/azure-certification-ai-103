import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { formatLatency, formatNumber } from './lib/format'

const HEALTH = { status: 'ok', model_deployment: 'gpt-test', endpoint_host: 'x.openai.azure.com', round: 2 }

const CHAT = {
  reply: 'ELIZA was an early chatbot.',
  inspector: {
    api: 'responses',
    request: {
      model: 'gpt-test',
      stream: false,
      instructions: 'Test system prompt.',
      input: 'Tell me about the ELIZA chatbot.',
    },
    response: { id: 'resp_1', status: 'completed' },
    usage: { input_tokens: 38, output_tokens: 410, total_tokens: 448, reasoning_tokens: null, cached_tokens: null },
    metrics: { latency_ms: 4200 },
    memory: { mode: 'none' },
    raw: { id: 'resp_1', status: 'completed' },
  },
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

function mockBackend(chatResponse: () => Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => (url === '/api/health' ? jsonResponse(HEALTH) : chatResponse())),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('App', () => {
  it('shows health info, sends a message and fills the inspector', async () => {
    mockBackend(() => jsonResponse(CHAT))
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('gpt-test')).toBeInTheDocument()
    expect(screen.getByText('Round 2')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Message'), 'Tell me about the ELIZA chatbot.')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('ELIZA was an early chatbot.')).toBeInTheDocument()
    // Context tab is open by default and shows the instructions and input sent.
    expect(screen.getByText('Test system prompt.')).toBeInTheDocument()
    expect(screen.getAllByText('Tell me about the ELIZA chatbot.').length).toBeGreaterThan(1)
    expect(screen.getByText('Raw response')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Metrics' }))
    expect(screen.getByText('4.2 s')).toBeInTheDocument()
    expect(screen.getAllByText('448')).not.toHaveLength(0)
    expect(screen.getByText('resp_1')).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
  })

  it('explains in the Memory tab that nothing is remembered', async () => {
    mockBackend(() => jsonResponse(CHAT))
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('tab', { name: 'Memory' }))
    expect(screen.getByText('No memory in this round.')).toBeInTheDocument()
  })

  it('shows a readable error and stays usable when the backend fails', async () => {
    mockBackend(() =>
      jsonResponse({ error: { code: 'auth_failed', message: 'Authentication failed. Run `az login`.' } }, 401),
    )
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('Message'), 'hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByText(/Run `az login`/)).toBeInTheDocument())
    expect(screen.getByLabelText('Message')).toBeEnabled()
  })

  it('clears the conversation', async () => {
    mockBackend(() => jsonResponse(CHAT))
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByLabelText('Message'), 'hi')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('ELIZA was an early chatbot.')

    await user.click(screen.getByRole('button', { name: 'Clear chat' }))
    expect(screen.queryByText('ELIZA was an early chatbot.')).not.toBeInTheDocument()
    expect(screen.getByText('Start a conversation')).toBeInTheDocument()
  })
})

describe('markdown in AI replies', () => {
  const MARKDOWN_REPLY = {
    ...CHAT,
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
    mockBackend(() => jsonResponse(MARKDOWN_REPLY))
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.type(screen.getByLabelText('Message'), 'what can you do?')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    const bold = await screen.findByText('Writing')
    expect(bold.tagName).toBe('STRONG')
    expect(container.querySelectorAll('.markdown li')).toHaveLength(2)
    expect(screen.getByText('pip install').tagName).toBe('CODE')
    expect(container.textContent).not.toContain('**')
  })

  it('does not turn raw HTML in a reply into real elements', async () => {
    mockBackend(() => jsonResponse(MARKDOWN_REPLY))
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.type(screen.getByLabelText('Message'), 'hi')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('Writing')

    expect(container.querySelector('.markdown script')).toBeNull()
  })

  it('keeps the user message as plain text', async () => {
    mockBackend(() => jsonResponse(CHAT))
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.type(screen.getByLabelText('Message'), '**not bold**')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText('ELIZA was an early chatbot.')

    expect(container.querySelector('.bubble--user .bubble-text')?.textContent).toBe('**not bold**')
  })
})

describe('theme toggle', () => {
  it('switches between light and dark and remembers the choice', async () => {
    mockBackend(() => jsonResponse(CHAT))
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
    mockBackend(() => jsonResponse(CHAT))
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
