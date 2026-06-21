// Read-only: re-score the already-persisted raw factors with the current
// scoring code and print the new top ranks. Lets us validate the z-score
// changes against real data without recomputing TA/FMP or writing anything.
import { prisma } from '@/lib/db/ownClient'
import { scoreRawRows, type RawRow } from '@/lib/pipeline/batch'

async function main() {
  const latest = await prisma.advancedScreenResult.findFirst({ orderBy: { runDate: 'desc' }, select: { runDate: true } })
  if (!latest) { console.log('no results yet'); return }
  const rows = await prisma.advancedScreenResult.findMany({ where: { runDate: latest.runDate } })
  const raw: RawRow[] = rows.map(r => ({
    ticker: r.ticker, sector: r.sector,
    xVar: r.xVar, yVar: r.yVar, zVar: r.zVar,
    pb: r.pb, ps: r.ps, eqStability: r.eqStability, eqGrowth: r.eqGrowth, marketCap: r.marketCap,
  }))
  const ranked = scoreRawRows(raw)
  console.log(`re-scored ${ranked.length} rows for ${String(latest.runDate).slice(0, 10)}\n`)
  console.log('rank ticker   sector                 disc    zX     zY     zZ   rawX')
  for (const r of ranked.slice(0, 15)) {
    const f = (v: number | null) => (v == null ? '  —  ' : v.toFixed(2).padStart(6))
    console.log(
      `${String(r.rank).padStart(3)}  ${r.ticker.padEnd(7)} ${(r.sector ?? '—').padEnd(22)}` +
      `${f(r.discoveryScore)} ${f(r.zX)} ${f(r.zY)} ${f(r.zZ)}  ${r.xVar == null ? '—' : r.xVar.toExponential(1)}`,
    )
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
