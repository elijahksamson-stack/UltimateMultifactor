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
}

const FACTORS: FactorSpec<RawRow>[] = [
  { key: 'xVar', invert: false }, { key: 'yVar', invert: false }, { key: 'zVar', invert: false },
  { key: 'pb', invert: true }, { key: 'ps', invert: true },
  { key: 'eqStability', invert: false }, { key: 'eqGrowth', invert: false },
]

export function scoreRawRows(rows: RawRow[]) {
  const z = sectorZScores(rows, FACTORS, r => r.sector)
  const scored = rows.map(r => {
    const zr = z.get(r.ticker)!
    const zRec = { zX: zr.xVar, zY: zr.yVar, zZ: zr.zVar, zPB: zr.pb, zPS: zr.ps, zEQStability: zr.eqStability, zEQGrowth: zr.eqGrowth }
    return { ...r, ...zRec, ...composite(zRec) }
  })
  return rankRows(scored)
}

export async function computeBatchRawFactors(
  slice: { ticker: string; sector: string | null }[],
  lookbackDays = 504,
): Promise<RawRow[]> {
  const tech = await analyzeBatch(slice.map(s => s.ticker), lookbackDays)
  const byTicker = new Map(tech.map(t => [t.ticker, t]))
  const out: RawRow[] = []
  for (const u of slice) {
    const t = byTicker.get(u.ticker)
    let pb: number | null = null, ps: number | null = null, eqStability: number | null = null, eqGrowth: number | null = null
    try {
      const ratios = await fetchValuationRatios(u.ticker); pb = ratios.pb; ps = ratios.ps
      const stmts = await fetchIncomeStatements(u.ticker, 6)
      const mapped = stmts.map(s => ({ revenue: s.revenue, eps: s.eps, netIncome: s.netIncome }))
      eqGrowth = computeEqGrowth(mapped, Math.max(1, mapped.length - 1))
      eqStability = computeEqStability(mapped)
    } catch { /* per-ticker failure -> nulls */ }
    out.push({ ticker: u.ticker, sector: u.sector, pb, ps, eqStability, eqGrowth, xVar: t?.xVar ?? null, yVar: t?.yVar ?? null, zVar: t?.zVar ?? null })
  }
  return out
}

export async function persistStaging(targetDate: Date, rows: RawRow[]): Promise<void> {
  await prisma.rawFactorStaging.createMany({
    data: rows.map(r => ({ runDate: targetDate, ticker: r.ticker, sector: r.sector, xVar: r.xVar, yVar: r.yVar, zVar: r.zVar, pb: r.pb, ps: r.ps, eqStability: r.eqStability, eqGrowth: r.eqGrowth })),
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
  }))
  const ranked = scoreRawRows(rows)
  await prisma.$transaction([
    prisma.advancedScreenResult.deleteMany({ where: { runDate: targetDate } }),
    ...chunk(ranked, 1000).map(c => prisma.advancedScreenResult.createMany({ data: c.map(r => ({
      runDate: targetDate, ticker: r.ticker, sector: r.sector,
      xVar: r.xVar, yVar: r.yVar, zVar: r.zVar, pb: r.pb, ps: r.ps, eqStability: r.eqStability, eqGrowth: r.eqGrowth,
      zX: r.zX, zY: r.zY, zZ: r.zZ, zPB: r.zPB, zPS: r.zPS, zEQStability: r.zEQStability, zEQGrowth: r.zEQGrowth,
      technicalScore: r.technicalScore, valuationScore: r.valuationScore, discoveryScore: r.discoveryScore, rank: r.rank,
    })) })),
    prisma.rawFactorStaging.deleteMany({ where: { runDate: targetDate } }),
  ])
  return { processed: ranked.length }
}
