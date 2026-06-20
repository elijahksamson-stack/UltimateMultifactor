import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/ownClient'
import { parseDiscoveryParams, toCsv } from '@/lib/http/discoveryQuery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const p = parseDiscoveryParams(req.nextUrl.searchParams)
  // Serve the latest run that actually has persisted results, independent of any
  // in-progress run. `advanced_screen_results` is only ever written by finalize's
  // atomic swap, so its newest runDate is always a complete, consistent screen —
  // this keeps the page populated while a re-run is mid-flight.
  const latestRun = await prisma.advancedScreenResult.findFirst({ orderBy: { runDate: 'desc' }, select: { runDate: true } })
  if (!latestRun) return NextResponse.json({ error: 'no completed screen yet' }, { status: 404 })
  const rows = await prisma.advancedScreenResult.findMany({
    where: { runDate: latestRun.runDate, ...(p.sector ? { sector: p.sector } : {}) },
    orderBy: { rank: 'asc' },
    take: p.limit,
    select: { rank: true, ticker: true, sector: true, discoveryScore: true, technicalScore: true, valuationScore: true,
      zX: true, zY: true, zZ: true, zPB: true, zPS: true, zEQStability: true, zEQGrowth: true },
  })
  // Prisma Decimal columns serialize to JSON strings; coerce every numeric field
  // to a real number so the UI's formatters (which reject non-numbers) render them.
  const num = (v: unknown): number | null => (v == null ? null : Number(v))
  const data = rows.map(r => ({
    rank: r.rank, ticker: r.ticker, sector: r.sector,
    discoveryScore: num(r.discoveryScore), technicalScore: num(r.technicalScore), valuationScore: num(r.valuationScore),
    zX: num(r.zX), zY: num(r.zY), zZ: num(r.zZ), zPB: num(r.zPB), zPS: num(r.zPS),
    zEQStability: num(r.zEQStability), zEQGrowth: num(r.zEQGrowth),
  }))
  if (p.format === 'csv') {
    return new NextResponse(toCsv(data as any), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="discovery-${latestRun.runDate.toISOString().slice(0,10)}.csv"` } })
  }
  return NextResponse.json({ runDate: latestRun.runDate, count: data.length, results: data })
}
