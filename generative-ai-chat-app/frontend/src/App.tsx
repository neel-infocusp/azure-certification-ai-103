import { useState } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { Header } from './components/Header'
import { InspectorPanel } from './components/inspector/InspectorPanel'
import { useChat } from './hooks/useChat'
import { useHealth } from './hooks/useHealth'
import { useTheme } from './hooks/useTheme'

type MobileView = 'chat' | 'inspector'

export default function App() {
  const chat = useChat()
  const health = useHealth()
  const { theme, toggle: toggleTheme } = useTheme()
  // On narrow screens only one panel is shown at a time; on wide screens both are visible.
  const [mobileView, setMobileView] = useState<MobileView>('chat')

  return (
    <div className="app">
      <Header
        health={health}
        canClear={chat.messages.length > 0}
        onClear={chat.clear}
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
          <ChatPanel messages={chat.messages} status={chat.status} onSend={chat.send} />
        </section>
        <aside
          className={`panel ${mobileView === 'inspector' ? '' : 'panel--hidden-mobile'}`}
          aria-label="Inspector"
        >
          <InspectorPanel snapshot={chat.snapshot} totals={chat.totals} />
        </aside>
      </main>
    </div>
  )
}
