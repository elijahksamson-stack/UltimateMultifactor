export const calculateZScore = (value: number, mean: number, stdDev: number): number => {
  if (stdDev === 0) return 0
  const z = (value - mean) / stdDev
  return Math.max(-999, Math.min(999, z))
}
const getMean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const getStdDev = (a: number[], m: number) => Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)

export interface FactorSpec<T> {
  key: keyof T & string
  invert: boolean
  // Log-compress before standardizing. For multiplicative, non-negative factors
  // (e.g. X Var) that span many orders of magnitude, so a few extreme values
  // can't dominate the sector mean/σ. Values are clamped at 0 before log1p.
  log?: boolean
}

const MIN_SECTOR = 5
// Winsorize each factor to its [WINSOR_Q, 1-WINSOR_Q] peer percentiles before
// standardizing, so outliers (penny-stock data artifacts) can't hijack mean/σ.
const WINSOR_Q = 0.02

const transform = (v: number, log: boolean): number => (log ? Math.log1p(Math.max(0, v)) : v)

// Linear-interpolated percentile of an ascending-sorted array.
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]
  const idx = q * (sorted.length - 1)
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

interface Stat { mean: number; sd: number; n: number; lo: number; hi: number; log: boolean }

function statsFor<T>(rows: T[], key: keyof T & string, log: boolean): Stat {
  const vals = rows
    .map(r => r[key] as unknown as number)
    .filter(v => typeof v === 'number' && Number.isFinite(v))
    .map(v => transform(v, log))
  if (!vals.length) return { mean: 0, sd: 0, n: 0, lo: 0, hi: 0, log }
  const sorted = [...vals].sort((a, b) => a - b)
  const lo = percentile(sorted, WINSOR_Q)
  const hi = percentile(sorted, 1 - WINSOR_Q)
  const clipped = vals.map(v => clamp(v, lo, hi))
  const mean = getMean(clipped)
  return { mean, sd: getStdDev(clipped, mean), n: vals.length, lo, hi, log }
}

export function sectorZScores<T extends { ticker: string }>(
  rows: T[],
  factors: FactorSpec<T>[],
  sectorOf: (r: T) => string | null,
): Map<string, Record<string, number | null>> {
  const market = new Map(factors.map(f => [f.key, statsFor(rows, f.key, f.log ?? false)]))
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    const s = sectorOf(r)
    if (s) { if (!groups.has(s)) groups.set(s, []); groups.get(s)!.push(r) }
  }
  const sectorStats = new Map<string, Map<string, Stat>>()
  for (const [sec, peers] of groups) {
    sectorStats.set(sec, new Map(factors.map(f => [f.key, statsFor(peers, f.key, f.log ?? false)])))
  }
  const out = new Map<string, Record<string, number | null>>()
  for (const r of rows) {
    const sector = sectorOf(r)
    // Rows with a null sector fall back to the full-universe (market) peer set.
    const peers = sector ? groups.get(sector)! : rows
    const useSector = peers.length >= MIN_SECTOR
    const rec: Record<string, number | null> = {}
    for (const f of factors) {
      const raw = r[f.key] as unknown as number
      if (typeof raw !== 'number' || Number.isNaN(raw)) { rec[f.key] = null; continue }
      const st = useSector ? sectorStats.get(sector!)!.get(f.key)! : market.get(f.key)!
      // Transform + winsorize the scored value identically to the peer stats.
      const v = clamp(transform(raw, st.log), st.lo, st.hi)
      const z = calculateZScore(v, st.mean, st.sd)
      rec[f.key] = f.invert ? -z : z
    }
    out.set(r.ticker, rec)
  }
  return out
}
