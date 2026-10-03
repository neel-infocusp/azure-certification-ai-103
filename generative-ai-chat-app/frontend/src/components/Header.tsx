import type { HealthState } from '../hooks/useHealth'
import type { Stats } from '../types'
import type { Theme } from '../hooks/useTheme'
import { ThemeToggle } from './ThemeToggle'

interface Props {
  health: HealthState
  stats: Stats | null
  canReset: boolean
  onNewChat: () => void
  theme: Theme
  onToggleTheme: () => void
}

export function Header({ health, stats, canReset, onNewChat, theme, onToggleTheme }: Props) {
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
        {stats && (
          <span
            className={`badge badge--live ${stats.in_flight > 0 ? 'badge--busy' : ''}`}
            title={`Model calls running right now. ${stats.total_requests} served since the backend started.`}
          >
            In flight: {stats.in_flight}
          </span>
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
