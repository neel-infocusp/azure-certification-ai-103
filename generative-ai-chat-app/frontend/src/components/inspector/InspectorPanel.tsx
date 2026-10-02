import { useState } from 'react'
import type { SessionTotals } from '../../hooks/useChat'
import type { InspectorSnapshot } from '../../types'
import { ContextTab } from './ContextTab'
import { MemoryTab } from './MemoryTab'
import { MetricsTab } from './MetricsTab'
import { RawEventsTab } from './RawEventsTab'

const TABS = [
  { id: 'context', label: 'Context' },
  { id: 'memory', label: 'Memory' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'events', label: 'Raw events' },
] as const

type TabId = (typeof TABS)[number]['id']

interface Props {
  snapshot: InspectorSnapshot | null
  totals: SessionTotals
}

export function InspectorPanel({ snapshot, totals }: Props) {
  const [active, setActive] = useState<TabId>('context')

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Inspector">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls="inspector-body"
            className={`tab ${active === tab.id ? 'tab--active' : ''}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="inspector-body" id="inspector-body" role="tabpanel" aria-labelledby={`tab-${active}`}>
        {active === 'context' && <ContextTab snapshot={snapshot} />}
        {active === 'memory' && <MemoryTab />}
        {active === 'metrics' && <MetricsTab snapshot={snapshot} totals={totals} />}
        {active === 'events' && <RawEventsTab />}
      </div>
    </>
  )
}
