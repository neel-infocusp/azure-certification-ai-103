const DASH = '—'

export function formatNumber(value: number | null | undefined): string {
  return value == null ? DASH : value.toLocaleString('en-US')
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return DASH
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** Approximate output speed: tokens written per second after the first token arrived. */
export function formatSpeed(
  outputTokens: number | null,
  metrics: { latency_ms: number; ttft_ms: number | null },
): string {
  if (outputTokens == null || metrics.ttft_ms == null) return DASH
  const seconds = (metrics.latency_ms - metrics.ttft_ms) / 1000
  if (seconds <= 0) return DASH
  return `~${Math.round(outputTokens / seconds)} tok/s`
}

export function formatText(value: string | null | undefined): string {
  return value ? value : DASH
}
