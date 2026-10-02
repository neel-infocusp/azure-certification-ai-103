import { useEffect, useState } from 'react'
import { getHealth } from '../api/client'
import type { HealthResponse } from '../types'

export type HealthState =
  | { status: 'checking' }
  | { status: 'ok'; data: HealthResponse }
  | { status: 'down' }

const RETRY_MS = 5000

/** Reads /api/health once, and retries every few seconds while the backend is down. */
export function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ status: 'checking' })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const check = async () => {
      try {
        const data = await getHealth()
        if (!cancelled) setState({ status: 'ok', data })
      } catch {
        if (cancelled) return
        setState({ status: 'down' })
        timer = setTimeout(check, RETRY_MS)
      }
    }
    void check()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  return state
}
