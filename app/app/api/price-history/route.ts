import { NextRequest, NextResponse } from 'next/server'
import { fetchDailyBars } from '@/lib/fmp/historical'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Tickers are short symbols; reject anything else before it reaches the request.
const TICKER_RE = /^[A-Z0-9.-]{1,10}$/

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get('ticker') ?? '').toUpperCase().trim()
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: 'invalid ticker' }, { status: 400 })
  }
  const days = Math.min(1260, Math.max(20, Number(req.nextUrl.searchParams.get('days')) || 504))
  // Real OHLC from FMP (OTM's recent bars are close-only → flat candles).
  const bars = await fetchDailyBars(ticker, days)
  if (!bars.length) {
    return NextResponse.json({ error: 'no price history' }, { status: 404 })
  }
  return NextResponse.json({ ticker, bars })
}
