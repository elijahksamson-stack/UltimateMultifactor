// Per-ticker X/Y/Z orchestration with failure isolation.
// Ported 1:1 from ta-worker/app/analyze.py.
import { atr, supportResistanceLevels, stopAndTarget } from './engine'
import { computeXVar, computeYVar, computeZVar, InsufficientBars } from './factors'

export const MIN_BARS = 30

export interface TickerResult {
  ticker: string
  xVar: number | null
  yVar: number | null
  zVar: number | null
  error?: string
}

/**
 * Compute X/Y/Z for one ticker. Never throws — failures land in `error` so a
 * single bad ticker can't fail a batch.
 */
export function analyzeBars(
  ticker: string,
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
): TickerResult {
  const n = closes.length
  const nulls = { xVar: null, yVar: null, zVar: null }
  if (n < MIN_BARS) return { ticker, ...nulls, error: 'insufficient_bars' }
  const allFinite = [highs, lows, closes].every(seq => seq.every(Number.isFinite))
  if (!allFinite) return { ticker, ...nulls, error: 'non_finite_bars' }
  try {
    const price = closes[n - 1]
    const a = atr(highs, lows, closes)
    const levels = supportResistanceLevels(highs, lows, closes, a, price)
    const st = stopAndTarget(price, a, levels.supports, levels.resistances)
    return {
      ticker,
      xVar: computeXVar(closes),
      yVar: computeYVar(price, st.target, st.stop),
      zVar: computeZVar(highs, lows, closes, a),
    }
  } catch (e) {
    if (e instanceof InsufficientBars) return { ticker, ...nulls, error: 'insufficient_bars' }
    const name = e instanceof Error ? e.constructor.name : 'Unknown'
    return { ticker, ...nulls, error: `compute_error:${name}` }
  }
}
