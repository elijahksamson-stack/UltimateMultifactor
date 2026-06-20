// In-process technical pass: reads OHLC from OTM and computes X/Y/Z locally,
// replacing the former HTTP call to the Railway TA worker. Same shape and
// signature as the old `analyzeBatch` so the pipeline is a drop-in swap.
import { fetchBarsBatch } from './bars'
import { analyzeBars, type TickerResult } from './analyze'

export type TechnicalVars = TickerResult

/** Compute X/Y/Z for a batch of tickers entirely in-process. Never rejects on
 *  per-ticker issues — missing bars/compute errors surface in `error`. */
export async function analyzeBatch(
  tickers: readonly string[],
  lookbackDays = 504,
): Promise<TechnicalVars[]> {
  const barsByTicker = await fetchBarsBatch(tickers, lookbackDays)
  return tickers.map(ticker => {
    const b = barsByTicker.get(ticker)
    if (!b) return { ticker, xVar: null, yVar: null, zVar: null, error: 'fetch_error' }
    return analyzeBars(ticker, b.highs, b.lows, b.closes)
  })
}
