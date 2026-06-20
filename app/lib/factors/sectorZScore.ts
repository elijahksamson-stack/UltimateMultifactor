export const calculateZScore = (value: number, mean: number, stdDev: number): number => {
  if (stdDev === 0) return 0
  const z = (value - mean) / stdDev
  return Math.max(-999, Math.min(999, z))
}
const getMean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const getStdDev = (a: number[], m: number) => Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)

export interface FactorSpec<T> { key: keyof T & string; invert: boolean }
const MIN_SECTOR = 5

function statsFor<T>(rows: T[], key: keyof T & string): { mean: number; sd: number; n: number } {
  const vals = rows.map(r => r[key] as unknown as number).filter(v => typeof v === 'number' && Number.isFinite(v))
  if (!vals.length) return { mean: 0, sd: 0, n: 0 }
  const mean = getMean(vals)
  return { mean, sd: getStdDev(vals, mean), n: vals.length }
}

export function sectorZScores<T extends { ticker: string }>(
  rows: T[],
  factors: FactorSpec<T>[],
  sectorOf: (r: T) => string | null,
): Map<string, Record<string, number | null>> {
  const market = new Map(factors.map(f => [f.key, statsFor(rows, f.key)]))
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    const s = sectorOf(r)
    if (s) { if (!groups.has(s)) groups.set(s, []); groups.get(s)!.push(r) }
  }
  const sectorStats = new Map<string, Map<string, { mean: number; sd: number; n: number }>>()
  for (const [sec, peers] of groups) {
    sectorStats.set(sec, new Map(factors.map(f => [f.key, statsFor(peers, f.key)])))
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
      const z = calculateZScore(raw, st.mean, st.sd)
      rec[f.key] = f.invert ? -z : z
    }
    out.set(r.ticker, rec)
  }
  return out
}
