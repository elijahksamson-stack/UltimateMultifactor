// Pure technical-var math. No I/O. Ported 1:1 from ta-worker/app/factors.py.

export class InsufficientBars extends Error {}

export const MIN_BARS_X = 20
export const MIN_BARS_Z = 30

/** Degree-1 least-squares fit. Returns [slope, intercept] for y over x = 0..n-1. */
function linfit(y: readonly number[]): [number, number] {
  const n = y.length
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let i = 0; i < n; i++) {
    sx += i; sy += y[i]; sxx += i * i; sxy += i * y[i]
  }
  const denom = n * sxx - sx * sx
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  return [slope, intercept]
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

/**
 * X Var (vol factor): symmetric crowding × magnitude dispersion around the
 * fitted regression centerline. Returns 0 when all residuals sit on one side.
 */
export function computeXVar(closes: readonly number[]): number {
  const n = closes.length
  if (n < MIN_BARS_X) throw new InsufficientBars(`need >= ${MIN_BARS_X} closes, got ${n}`)
  if (!closes.every(Number.isFinite)) throw new Error('closes contains NaN or Inf values')
  const [slope, intercept] = linfit(closes)
  const below: number[] = [], above: number[] = []
  for (let i = 0; i < n; i++) {
    const resid = closes[i] - (slope * i + intercept)
    if (resid < 0) below.push(resid)
    else if (resid > 0) above.push(resid)
  }
  if (below.length === 0 || above.length === 0) return 0.0
  const avgBelow = mean(below.map(Math.abs))
  const avgAbove = mean(above.map(Math.abs))
  const result = (below.length * avgBelow) * (above.length * avgAbove)
  if (!Number.isFinite(result)) throw new Error('x_var overflow: outlier price data')
  return result
}

/** Y Var (risk/reward): distance-to-target / distance-to-stop. 0 when risk <= 0. */
export function computeYVar(price: number, target: number, stop: number): number {
  const risk = price - stop
  if (risk <= 0) return 0.0
  return (target - price) / risk
}

/** Local maxima: index i where highs[i] equals the max of the ±w window. */
export function pivotHighs(highs: readonly number[], w = 5): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const n = highs.length
  for (let i = w; i < n - w; i++) {
    let m = -Infinity
    for (let k = i - w; k <= i + w; k++) if (highs[k] > m) m = highs[k]
    if (highs[i] === m) out.push([i, highs[i]])
  }
  return out
}

/**
 * Z Var (momentum): count of resistance levels that later flipped to support
 * within the last `lookback` bars. A flip = a pivot-high level that price
 * closed above by > tol band (breakout), then returned so a bar low touched
 * within tol while its close held at/above the level (acted as support).
 */
export function computeZVar(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  atr: number,
  lookback = 252,
  tolAtr = 0.5,
): number {
  const n = closes.length
  if (n < MIN_BARS_Z) throw new InsufficientBars(`need >= ${MIN_BARS_Z} bars, got ${n}`)
  if (atr <= 0) return 0
  const band = tolAtr * atr
  const windowStart = Math.max(0, n - lookback)
  let flips = 0
  const seenLevels = new Set<number>()
  for (const [pidx, level] of pivotHighs(highs, 5)) {
    if (pidx >= n - 10) continue
    const levelKey = Math.round(level / band) * band
    if (seenLevels.has(levelKey)) continue
    let broke = false
    for (let j = pidx + 1; j < n; j++) {
      if (!broke) {
        if (closes[j] > level + band) broke = true
      } else {
        const touchedAsSupport =
          lows[j] <= level + band && closes[j] >= level - band && j >= windowStart
        if (touchedAsSupport) {
          flips += 1
          seenLevels.add(levelKey)
          break
        }
      }
    }
  }
  return flips
}
