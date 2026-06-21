import { NextRequest, NextResponse } from 'next/server'
import { fetchDailyBars, type DailyBar } from '@/lib/fmp/historical'
import { otmPool } from '@/lib/db/otmClient'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Tickers are short symbols; reject anything else before it reaches the request.
const TICKER_RE = /^[A-Z0-9.-]{1,10}$/

interface OtmRow { date: Date; open: string | number; close: string | number; high: string | number; low: string | number }

// OTM has every screened ticker; recent bars may be close-only (flat candles),
// but it's a reliable fallback when FMP historical is unavailable.
async function otmBars(ticker: string, days: number): Promise<DailyBar[]> {
  try {
    const { rows } = await otmPool().query<OtmRow>(
      `SELECT date, open, close, high, low FROM price_history WHERE ticker = $1 ORDER BY date DESC LIMIT $2`,
      [ticker, days],
    )
    return rows.reverse().map(r => ({
      date: r.date.toISOString().slice(0, 10),
      open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close),
    }))
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get('ticker') ?? '').toUpperCase().trim()
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: 'invalid ticker' }, { status: 400 })
  }
  const days = Math.min(1260, Math.max(20, Number(req.nextUrl.searchParams.get('days')) || 504))
  // Prefer FMP (real intraday OHLC); fall back to OTM. Neither path throws.
  const fmpBars = await fetchDailyBars(ticker, days)
  const bars = fmpBars.length ? fmpBars : await otmBars(ticker, days)
  if (!bars.length) {
    return NextResponse.json({ error: 'no price history' }, { status: 404 })
  }
  return NextResponse.json({ ticker, source: fmpBars.length ? 'fmp' : 'otm', bars })
}
