const DASH = '—'

export function formatNumber(value: number | null | undefined): string {
  return value == null ? DASH : value.toLocaleString('en-US')
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return DASH
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function formatText(value: string | null | undefined): string {
  return value ? value : DASH
}
