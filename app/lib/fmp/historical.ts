// On-demand daily OHLC for the price-detail chart. Sourced from FMP (real
// intraday OHLC + multi-year history) — OTM's recent bars store close-only,
// which would render as flat dojis. Used by GET /api/price-history.

export interface DailyBar { date: string; open: number; high: number; low: number; close: number }

interface FmpBar { date?: string; open?: number; high?: number; low?: number; close?: number }

export async function fetchDailyBars(ticker: string, limit = 504): Promise<DailyBar[]> {
  const key = process.env.FMP_API_KEY
  const base = process.env.FMP_BASE_URL || 'https://financialmodelingprep.com/stable'
  const res = await fetch(`${base}/historical-price-eod/full?symbol=${encodeURIComponent(ticker)}&apikey=${key}`)
  if (!res.ok) throw new Error(`FMP historical ${res.status}`)
  const data = await res.json()
  const arr: FmpBar[] = Array.isArray(data) ? data : (data?.historical ?? [])
  // FMP returns newest-first; keep `limit`, flip to ascending for charting.
  return arr
    .slice(0, limit)
    .reverse()
    .map(b => ({
      date: String(b.date ?? '').slice(0, 10),
      open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close),
    }))
    .filter(b => Number.isFinite(b.close) && Number.isFinite(b.open))
}
