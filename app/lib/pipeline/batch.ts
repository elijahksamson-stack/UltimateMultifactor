import { prisma } from '@/lib/db/ownClient'
import { fetchValuationRatios, fetchIncomeStatements } from '@/lib/fmp/fundamentals-lite'
import { computeEqGrowth, computeEqStability } from '@/lib/factors/eqDecomposition'
import { analyzeBatch } from '@/lib/ta'
import { sectorZScores, type FactorSpec } from '@/lib/factors/sectorZScore'
import { composite, rankRows } from '@/lib/factors/composite'

export interface RawRow {
  ticker: string; sector: string | null
  pb: number | null; ps: number | null; eqStability: number | null; eqGrowth: number | null
  xVar: number | null; yVar: number | null; zVar: number | null
  marketCap: number | null
}

const FACTORS: FactorSpec<RawRow>[] = [
  { key: 'xVar', invert: false, log: true }, { key: 'yVar', invert: false }, { key: 'zVar', invert: false },
  { key: 'pb', invert: true }, { key: 'ps', invert: true },
  { key: 'eqStability', invert: false }, { key: 'eqGrowth', invert: false },
  // Market cap is z-scored for display gradient only (log-transformed; spans
  // orders of magnitude). It is NOT in Z_KEYS or the composite, so it neither
  // filters rows nor affects the discovery ranking. Inverted: a SMALLER cap
  // scores greener (more runway for future growth).
  { key: 'marketCap', invert: true, log: true },
]

// Per-factor z-score keys on a scored row. A row is dropped from the discovery
// list if ANY of these is negative (below-sector on that factor) — the screen
// only surfaces names that are at or above their sector peers on every metric.
const Z_KEYS = ['zX', 'zY', 'zZ', 'zPB', 'zPS', 'zEQStability', 'zEQGrowth'] as const

// A null z (missing data, e.g. no FMP EQ) is not negative, so it does not drop the row.
type ScoredZ = Record<(typeof Z_KEYS)[number], number | null>
const hasNoNegativeZ = (r: ScoredZ): boolean =>
  Z_KEYS.every(k => { const v = r[k]; return v == null || v >= 0 })

export function scoreRawRows(rows: RawRow[]) {
  // Z-score against the FULL universe first (sector stats need every row),
  // then drop any name with a negative z on any factor, then rank the survivors.
  const z = sectorZScores(rows, FACTORS, r => r.sector)
  const scored = rows.map(r => {
    const zr = z.get(r.ticker)!
    const zRec = { zX: zr.xVar, zY: zr.yVar, zZ: zr.zVar, zPB: zr.pb, zPS: zr.ps, zEQStability: zr.eqStability, zEQGrowth: zr.eqGrowth }
    // zMarketCap rides along for the display gradient but is excluded from
    // composite() and the negative-z filter (it is not a quality factor).
    return { ...r, ...zRec, zMarketCap: zr.marketCap, ...composite(zRec) }
  })
  return rankRows(scored.filter(hasNoNegativeZ))
}

// FMP fundamentals are fetched concurrently across tickers. Kept gentle: in
// production, higher concurrency bursts trip FMP's 429 circuit breaker (60s
// global pauses) and the run stalls erratically. 3 overlaps latency for a solid
// speedup while staying under the sustained limit. Tune via FMP_CALLS_PER_MINUTE.
const FMP_CONCURRENCY = Number(process.env.FMP_CONCURRENCY) || 3

// Bounded-concurrency map that preserves input order.
async function mapWithConcurrency<I, O>(
  items: readonly I[],
  limit: number,
  fn: (item: I) => Promise<O>,
): Promise<O[]> {
  const out = new Array<O>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export async function computeBatchRawFactors(
  slice: { ticker: string; sector: string | null; marketCap?: number | null }[],
  lookbackDays = 504,
): Promise<RawRow[]> {
  const tech = await analyzeBatch(slice.map(s => s.ticker), lookbackDays)
  const byTicker = new Map(tech.map(t => [t.ticker, t]))
  return mapWithConcurrency(slice, FMP_CONCURRENCY, async (u): Promise<RawRow> => {
    const t = byTicker.get(u.ticker)
    let pb: number | null = null, ps: number | null = null, eqStability: number | null = null, eqGrowth: number | null = null
    try {
      const ratios = await fetchValuationRatios(u.ticker); pb = ratios.pb; ps = ratios.ps
      const stmts = await fetchIncomeStatements(u.ticker, 6)
      const mapped = stmts.map(s => ({ revenue: s.revenue, eps: s.eps, netIncome: s.netIncome }))
      eqGrowth = computeEqGrowth(mapped, Math.max(1, mapped.length - 1))
      eqStability = computeEqStability(mapped)
    } catch { /* per-ticker failure -> nulls */ }
    return { ticker: u.ticker, sector: u.sector, pb, ps, eqStability, eqGrowth, xVar: t?.xVar ?? null, yVar: t?.yVar ?? null, zVar: t?.zVar ?? null, marketCap: u.marketCap ?? null }
  })
}

export async function persistStaging(targetDate: Date, rows: RawRow[]): Promise<void> {
  await prisma.rawFactorStaging.createMany({
    data: rows.map(r => ({ runDate: targetDate, ticker: r.ticker, sector: r.sector, xVar: r.xVar, yVar: r.yVar, zVar: r.zVar, pb: r.pb, ps: r.ps, eqStability: r.eqStability, eqGrowth: r.eqGrowth, marketCap: r.marketCap })),
    skipDuplicates: true,
  })
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

export async function finalizeScreen(targetDate: Date): Promise<{ processed: number }> {
  const staged = await prisma.rawFactorStaging.findMany({ where: { runDate: targetDate } })
  const rows: RawRow[] = staged.map(s => ({
    ticker: s.ticker, sector: s.sector,
    xVar: s.xVar == null ? null : Number(s.xVar), yVar: s.yVar == null ? null : Number(s.yVar), zVar: s.zVar,
    pb: s.pb == null ? null : Number(s.pb), ps: s.ps == null ? null : Number(s.ps),
    eqStability: s.eqStability == null ? null : Number(s.eqStability), eqGrowth: s.eqGrowth == null ? null : Number(s.eqGrowth),
    marketCap: s.marketCap == null ? null : Number(s.marketCap),
  }))
  const ranked = scoreRawRows(rows)
  await prisma.$transaction([
    prisma.advancedScreenResult.deleteMany({ where: { runDate: targetDate } }),
    ...chunk(ranked, 1000).map(c => prisma.advancedScreenResult.createMany({ data: c.map(r => ({
      runDate: targetDate, ticker: r.ticker, sector: r.sector,
      xVar: r.xVar, yVar: r.yVar, zVar: r.zVar, pb: r.pb, ps: r.ps, eqStability: r.eqStability, eqGrowth: r.eqGrowth,
      marketCap: r.marketCap, zMarketCap: r.zMarketCap,
      zX: r.zX, zY: r.zY, zZ: r.zZ, zPB: r.zPB, zPS: r.zPS, zEQStability: r.zEQStability, zEQGrowth: r.zEQGrowth,
      technicalScore: r.technicalScore, valuationScore: r.valuationScore, discoveryScore: r.discoveryScore, rank: r.rank,
    })) })),
    prisma.rawFactorStaging.deleteMany({ where: { runDate: targetDate } }),
  ])
  return { processed: ranked.length }
}
