import { useState } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { Header } from './components/Header'
import { InspectorPanel } from './components/inspector/InspectorPanel'
import { useChat } from './hooks/useChat'
import { useHealth } from './hooks/useHealth'
import { useStats } from './hooks/useStats'
import { useTheme } from './hooks/useTheme'

type MobileView = 'chat' | 'inspector'

export default function App() {
  const chat = useChat()
  const health = useHealth()
  // Refreshed on every status change, so the count reacts as soon as a message is sent.
  const stats = useStats(health.status === 'ok', chat.status)
  const { theme, toggle: toggleTheme } = useTheme()
  // On narrow screens only one panel is shown at a time; on wide screens both are visible.
  const [mobileView, setMobileView] = useState<MobileView>('chat')

  return (
    <div className="app">
      <Header
        health={health}
        stats={stats}
        canReset={chat.messages.length > 0 && chat.status !== 'starting'}
        onNewChat={chat.newChat}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <div className="mobile-switch" role="tablist" aria-label="Panel">
        {(['chat', 'inspector'] as const).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={mobileView === view}
            className={`tab ${mobileView === view ? 'tab--active' : ''}`}
            onClick={() => setMobileView(view)}
          >
            {view === 'chat' ? 'Chat' : 'Inspector'}
          </button>
        ))}
      </div>

      <main className="main">
        <section
          className={`panel ${mobileView === 'chat' ? '' : 'panel--hidden-mobile'}`}
          aria-label="Chat"
        >
          <ChatPanel
            messages={chat.messages}
            status={chat.status}
            onSend={chat.send}
            onStop={chat.stop}
          />
        </section>
        <aside
          className={`panel ${mobileView === 'inspector' ? '' : 'panel--hidden-mobile'}`}
          aria-label="Inspector"
        >
          <InspectorPanel
            snapshot={chat.snapshot}
            turns={chat.turns}
            rawEvents={chat.rawEvents}
            totals={chat.totals}
            sessionId={chat.sessionId}
            stats={stats}
          />
        </aside>
      </main>
    </div>
  )
}
