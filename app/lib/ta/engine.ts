// Technical engine: ATR + support/resistance clustering + stop/target.
// Ported 1:1 from ta-worker/app/engine.py.
import { pivotHighs } from './factors'

const STOP_ATR_MULT = 1.0
const TARGET_ATR_MULT = 1.0
const NO_SUPPORT_ATR_MULT = 2.0
const RR_TARGET = 2.0

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

/** Average True Range — simple mean of true ranges over `period`. */
export function atr(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  period = 14,
): number {
  const n = closes.length
  if (n < 2) return 0.0
  const trs: number[] = []
  for (let i = 1; i < n; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ))
  }
  const window = trs.length >= period ? trs.slice(-period) : trs
  return window.length ? mean(window) : 0.0
}

export interface StopTarget { stop: number; target: number; risk: number; reward: number }

/** Stop = nearest support below price padded by ATR; target = nearest resistance above, padded. */
export function stopAndTarget(
  price: number,
  atrValue: number,
  supports: readonly number[],
  resistances: readonly number[],
): StopTarget {
  const below = supports.filter(s => s < price).sort((a, b) => b - a)
  const above = resistances.filter(r => r > price).sort((a, b) => a - b)
  const stop = below.length
    ? below[0] - STOP_ATR_MULT * atrValue
    : price - NO_SUPPORT_ATR_MULT * atrValue
  const risk = price - stop
  const target = above.length
    ? above[0] + TARGET_ATR_MULT * atrValue
    : price + RR_TARGET * risk
  return { stop, target, risk, reward: target - price }
}

/** Local minima: index i where lows[i] equals the min of the ±w window. */
function pivotLows(lows: readonly number[], w: number): number[] {
  const out: number[] = []
  const n = lows.length
  for (let i = w; i < n - w; i++) {
    let m = Infinity
    for (let k = i - w; k <= i + w; k++) if (lows[k] < m) m = lows[k]
    if (lows[i] === m) out.push(lows[i])
  }
  return out
}

/** Collapse nearby levels into cluster means (band = mult * atr). */
export function cluster(levels: readonly number[], atrValue: number, mult = 0.75): number[] {
  if (!levels.length) return []
  const band = Math.max(mult * atrValue, 1e-9)
  const ordered = [...levels].sort((a, b) => a - b)
  const clusters: number[][] = [[ordered[0]]]
  for (const lv of ordered.slice(1)) {
    const head = clusters[clusters.length - 1][0]
    if (lv - head <= band) clusters[clusters.length - 1].push(lv)
    else clusters.push([lv])
  }
  return clusters.map(mean)
}

export interface Levels { resistances: number[]; supports: number[] }

/** Cluster pivot highs above price (resistance) and pivot lows below price (support). */
export function supportResistanceLevels(
  highs: readonly number[],
  lows: readonly number[],
  _closes: readonly number[],
  atrValue: number,
  price: number,
  w = 5,
): Levels {
  const resRaw = pivotHighs(highs, w).filter(([, lv]) => lv > price).map(([, lv]) => lv)
  const supRaw = pivotLows(lows, w).filter(lv => lv < price)
  return { resistances: cluster(resRaw, atrValue), supports: cluster(supRaw, atrValue) }
}

export { pivotLows as _pivotLows }
