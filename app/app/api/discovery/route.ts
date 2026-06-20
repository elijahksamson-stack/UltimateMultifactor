import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/ownClient'
import { parseDiscoveryParams, toCsv } from '@/lib/http/discoveryQuery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const p = parseDiscoveryParams(req.nextUrl.searchParams)
  const latest = await prisma.advancedScreenResult.findFirst({ orderBy: { runDate: 'desc' }, select: { runDate: true } })
  if (!latest) return NextResponse.json({ error: 'no screen results yet' }, { status: 404 })
  const rows = await prisma.advancedScreenResult.findMany({
    where: { runDate: latest.runDate, ...(p.sector ? { sector: p.sector } : {}) },
    orderBy: { rank: 'asc' },
    take: p.limit,
    select: { rank: true, ticker: true, sector: true, discoveryScore: true, technicalScore: true, valuationScore: true,
      zX: true, zY: true, zZ: true, zPB: true, zPS: true, zEQStability: true, zEQGrowth: true },
  })
  const data = rows.map(r => ({ ...r, discoveryScore: r.discoveryScore == null ? null : Number(r.discoveryScore) }))
  if (p.format === 'csv') {
    return new NextResponse(toCsv(data as any), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="discovery-${latest.runDate.toISOString().slice(0,10)}.csv"` } })
  }
  return NextResponse.json({ runDate: latest.runDate, count: data.length, results: data })
}
