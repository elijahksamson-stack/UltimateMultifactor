import { NextRequest, NextResponse } from 'next/server'
import { otmPool } from '@/lib/db/otmClient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Tickers are short symbols; reject anything else before it reaches the query.
const TICKER_RE = /^[A-Z0-9.-]{1,10}$/

interface PriceRow { date: Date; close: string | number; high: string | number; low: string | number }

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get('ticker') ?? '').toUpperCase().trim()
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: 'invalid ticker' }, { status: 400 })
  }
  const days = Math.min(1000, Math.max(20, Number(req.nextUrl.searchParams.get('days')) || 504))
  // Parameterized — ticker is also validated above. umf_readonly has SELECT on price_history.
  const { rows } = await otmPool().query<PriceRow>(
    `SELECT date, close, high, low FROM price_history WHERE ticker = $1 ORDER BY date DESC LIMIT $2`,
    [ticker, days],
  )
  if (!rows.length) {
    return NextResponse.json({ error: 'no price history' }, { status: 404 })
  }
  const bars = rows.reverse().map(r => ({
    date: r.date.toISOString().slice(0, 10),
    close: Number(r.close), high: Number(r.high), low: Number(r.low),
  }))
  return NextResponse.json({ ticker, bars })
}
