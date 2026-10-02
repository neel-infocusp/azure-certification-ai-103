import type { HealthState } from '../hooks/useHealth'
import type { Theme } from '../hooks/useTheme'
import { ThemeToggle } from './ThemeToggle'

interface Props {
  health: HealthState
  canReset: boolean
  onNewChat: () => void
  theme: Theme
  onToggleTheme: () => void
}

export function Header({ health, canReset, onNewChat, theme, onToggleTheme }: Props) {
  const label =
    health.status === 'ok'
      ? 'Connected'
      : health.status === 'checking'
        ? 'Checking…'
        : 'Backend offline'

  return (
    <header className="header">
      <h1 className="header-title">Generative AI Chat</h1>
      <div className="header-meta">
        {health.status === 'ok' && (
          <>
            <span className="badge" title="Model deployment">
              {health.data.model_deployment}
            </span>
            <span className="badge badge--accent">Round {health.data.round}</span>
          </>
        )}
        <span className={`status status--${health.status}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {label}
        </span>
      </div>
      <div className="header-actions">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <button type="button" className="btn" onClick={onNewChat} disabled={!canReset}>
          New chat
        </button>
      </div>
    </header>
  )
}
