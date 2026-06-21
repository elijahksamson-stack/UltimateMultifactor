export function formatScore(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toFixed(2)
}

/** Raw valuation ratio, e.g. 2.3x (em-dash when missing). */
export function formatRatio(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(1)}x`
}

/** Compact market cap: K / M / B / T. */
export function formatMarketCap(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toFixed(0)
}

type Dir = 'asc' | 'desc'
export function compareBy<T>(key: keyof T, dir: Dir): (a: T, b: T) => number {
  return (a, b) => {
    const av = a[key] as unknown, bv = b[key] as unknown
    const an = av == null, bn = bv == null
    if (an && bn) return 0
    if (an) return 1
    if (bn) return -1
    if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av
    const cmp = String(av).localeCompare(String(bv))
    return dir === 'asc' ? cmp : -cmp
  }
}

export function zHeat(z: number | null | undefined): string {
  if (z == null || !Number.isFinite(z)) return 'z-null'
  const sign = z >= 0 ? 'pos' : 'neg'
  const m = Math.abs(z)
  const bucket = m >= 2 ? 3 : m >= 1 ? 2 : 1
  return `z-${sign}-${bucket}`
}
