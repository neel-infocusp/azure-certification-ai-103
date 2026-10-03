import { useEffect, useState } from 'react'
import { getStats } from '../api/client'
import type { Stats } from '../types'

export const STATS_POLL_MS = 2000

/**
 * How busy the backend is (model calls running now, served so far).
 *
 * Polls every few seconds while `enabled`, and also straight away whenever `refreshKey`
 * changes, so the number reacts the moment a message is sent or an answer finishes.
 * Returns null while disabled or when the backend cannot be reached.
 */
export function useStats(enabled: boolean, refreshKey: unknown): Stats | null {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const poll = async () => {
      try {
        const next = await getStats()
        if (!cancelled) setStats(next)
      } catch {
        if (!cancelled) setStats(null)
      }
    }

    void poll()
    const timer = setInterval(poll, STATS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enabled, refreshKey])

  return enabled ? stats : null
}
