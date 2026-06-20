// Reads OHLC bars for a batch of tickers from OTM's price_history (read-only).
// Replaces the HTTP round-trip to the former Railway TA worker: one windowed
// query returns the newest `lookbackDays` bars per ticker, ascending by date.
import { otmPool } from '@/lib/db/otmClient'

export interface Bars { highs: number[]; lows: number[]; closes: number[] }

// Newest `lookbackDays` rows per ticker via a window, then ascending by date.
const BATCH_BARS_QUERY = `
  SELECT ticker, high, low, close FROM (
    SELECT ticker, date, high, low, close,
           row_number() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn
    FROM price_history
    WHERE ticker = ANY($1::text[])
  ) t
  WHERE rn <= $2
  ORDER BY ticker, date ASC
`

interface Row { ticker: string; high: string | number; low: string | number; close: string | number }

/** Fetch ascending OHLC bars for many tickers in a single query. */
export async function fetchBarsBatch(
  tickers: readonly string[],
  lookbackDays = 504,
): Promise<Map<string, Bars>> {
  const out = new Map<string, Bars>()
  if (!tickers.length) return out
  const { rows } = await otmPool().query<Row>(BATCH_BARS_QUERY, [tickers, lookbackDays])
  for (const r of rows) {
    let b = out.get(r.ticker)
    if (!b) { b = { highs: [], lows: [], closes: [] }; out.set(r.ticker, b) }
    b.highs.push(Number(r.high))
    b.lows.push(Number(r.low))
    b.closes.push(Number(r.close))
  }
  return out
}
