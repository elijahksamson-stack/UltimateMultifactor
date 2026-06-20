import { prisma } from '@/lib/db/ownClient'
import { loadActiveUniverse, otmPriceMaxDate, latestDateIsToday } from './loadUniverse'
import { fetchValuationRatios, fetchIncomeStatements } from '@/lib/fmp/fundamentals-lite'
import { computeEqGrowth, computeEqStability } from '@/lib/factors/eqDecomposition'
import { analyzeBatch } from '@/lib/taWorker/client'
import { sectorZScores, type FactorSpec } from '@/lib/factors/sectorZScore'
import { composite, rankRows } from '@/lib/factors/composite'

const BATCH = 50

interface RawRow {
  ticker: string; sector: string | null
  pb: number | null; ps: number | null; eqStability: number | null; eqGrowth: number | null
  xVar: number | null; yVar: number | null; zVar: number | null
}

export async function scoreUniverse(targetDate: Date): Promise<{ processed: number }> {
  const maxDate = await otmPriceMaxDate()
  if (!maxDate || !latestDateIsToday(maxDate, targetDate)) {
    throw new Error(`OTM price_history not fresh (max=${maxDate?.toISOString().slice(0,10)}, target=${targetDate.toISOString().slice(0,10)})`)
  }
  const universe = await loadActiveUniverse()
  const raw: RawRow[] = []

  for (let i = 0; i < universe.length; i += BATCH) {
    const slice = universe.slice(i, i + BATCH)
    const tech = await analyzeBatch(slice.map(s => s.ticker))
    const techByTicker = new Map(tech.map(t => [t.ticker, t]))
    for (const u of slice) {
      const t = techByTicker.get(u.ticker)
      let pb: number | null = null, ps: number | null = null, eqStability: number | null = null, eqGrowth: number | null = null
      try {
        const ratios = await fetchValuationRatios(u.ticker); pb = ratios.pb; ps = ratios.ps
        const stmts = await fetchIncomeStatements(u.ticker, 6)
        const mapped = stmts.map(s => ({ revenue: s.revenue, eps: s.eps, netIncome: s.netIncome }))
        eqGrowth = computeEqGrowth(mapped, Math.max(1, mapped.length - 1))
        eqStability = computeEqStability(mapped)
      } catch { /* per-ticker fundamentals failure -> nulls */ }
      raw.push({ ticker: u.ticker, sector: u.sector, pb, ps, eqStability, eqGrowth, xVar: t?.xVar ?? null, yVar: t?.yVar ?? null, zVar: t?.zVar ?? null })
    }
  }

  const factors: FactorSpec<RawRow>[] = [
    { key: 'xVar', invert: false }, { key: 'yVar', invert: false }, { key: 'zVar', invert: false },
    { key: 'pb', invert: true }, { key: 'ps', invert: true },
    { key: 'eqStability', invert: false }, { key: 'eqGrowth', invert: false },
  ]
  const z = sectorZScores(raw, factors, r => r.sector)

  const scored = raw.map(r => {
    const zr = z.get(r.ticker)!
    const zRec = { zX: zr.xVar, zY: zr.yVar, zZ: zr.zVar, zPB: zr.pb, zPS: zr.ps, zEQStability: zr.eqStability, zEQGrowth: zr.eqGrowth }
    return { ...r, ...zRec, ...composite(zRec) }
  })
  const ranked = rankRows(scored)

  await prisma.advancedScreenResult.deleteMany({ where: { runDate: targetDate } })
  for (let i = 0; i < ranked.length; i += 1000) {
    await prisma.advancedScreenResult.createMany({
      data: ranked.slice(i, i + 1000).map(r => ({
        runDate: targetDate, ticker: r.ticker, sector: r.sector,
        xVar: r.xVar, yVar: r.yVar, zVar: r.zVar, pb: r.pb, ps: r.ps, eqStability: r.eqStability, eqGrowth: r.eqGrowth,
        zX: r.zX, zY: r.zY, zZ: r.zZ, zPB: r.zPB, zPS: r.zPS, zEQStability: r.zEQStability, zEQGrowth: r.zEQGrowth,
        technicalScore: r.technicalScore, valuationScore: r.valuationScore, discoveryScore: r.discoveryScore, rank: r.rank,
      })),
    })
  }
  return { processed: ranked.length }
}
