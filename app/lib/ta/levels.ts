// Technical-analysis layer for the price-detail chart: swing pivots, clustered
// support/resistance (with touch strength), a pivot-fit trend channel, and an
// ATR + S/R trade setup (stop / target / risk-reward). Pure; reuses engine math.
import { atr, stopAndTarget } from './engine'
import { pivotHighs } from './factors'

export interface OHLC { open: number[]; high: number[]; low: number[]; close: number[] }
export interface Pivot { i: number; price: number }
export interface SRLevel {
  price: number
  type: 'support' | 'resistance'
  touches: number      // pivots that converged here
  strength: number     // 1..5 (touch count, capped) — for the dots
  distPct: number      // signed % from the current price
}
export interface TrendLine { slope: number; intercept: number } // price = slope * barIndex + intercept
export interface Channel { upper: TrendLine; lower: TrendLine; mid: TrendLine; rising: boolean }
export interface TradeSetup {
  price: number; stop: number; target: number
  rr: number; riskPct: number; rewardPct: number
}
export interface Technicals {
  pivotHighs: Pivot[]; pivotLows: Pivot[]
  levels: SRLevel[]; channel: Channel; setup: TradeSetup; atr: number; n: number
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1)

function pivotLowsIdx(lows: readonly number[], w: number): Pivot[] {
  const out: Pivot[] = []
  for (let i = w; i < lows.length - w; i++) {
    let m = Infinity
    for (let k = i - w; k <= i + w; k++) if (lows[k] < m) m = lows[k]
    if (lows[i] === m) out.push({ i, price: lows[i] })
  }
  return out
}

// Least-squares line through arbitrary (index, price) pivots.
function fitLine(pts: readonly Pivot[]): TrendLine {
  const n = pts.length
  if (n < 2) return { slope: 0, intercept: pts[0]?.price ?? 0 }
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (const p of pts) { sx += p.i; sy += p.price; sxx += p.i * p.i; sxy += p.i * p.price }
  const d = n * sxx - sx * sx
  const slope = d === 0 ? 0 : (n * sxy - sx * sy) / d
  return { slope, intercept: (sy - slope * sx) / n }
}

// Cluster nearby pivot prices into S/R levels; strength = how many pivots converge.
function clusterLevels(prices: readonly number[], band: number, lastPrice: number): SRLevel[] {
  if (!prices.length) return []
  const ordered = [...prices].sort((a, b) => a - b)
  const groups: number[][] = [[ordered[0]]]
  for (const p of ordered.slice(1)) {
    const g = groups[groups.length - 1]
    if (p - g[0] <= band) g.push(p)
    else groups.push([p])
  }
  return groups.map(g => {
    const price = mean(g)
    return {
      price,
      type: (price < lastPrice ? 'support' : 'resistance') as 'support' | 'resistance',
      touches: g.length,
      strength: Math.min(5, g.length),
      distPct: ((price - lastPrice) / lastPrice) * 100,
    }
  })
}

/** Full TA read on an OHLC series. `w` is the pivot half-window (swing sensitivity). */
export function analyzeTechnicals(bars: OHLC, w = 6): Technicals {
  const { high, low, close } = bars
  const n = close.length
  const last = close[n - 1]
  const a = atr(high, low, close) || last * 0.02 // fall back to ~2% if ATR is 0

  const phs: Pivot[] = pivotHighs(high, w).map(([i, price]) => ({ i, price }))
  const pls = pivotLowsIdx(low, w)

  // Convergence clusters from all swing points, ranked by strength then proximity.
  const levels = clusterLevels([...phs.map(p => p.price), ...pls.map(p => p.price)], a * 0.9, last)
    .sort((x, y) => y.strength - x.strength || Math.abs(x.distPct) - Math.abs(y.distPct))

  const mid = fitLine(close.map((price, i) => ({ i, price })))
  const channel: Channel = {
    upper: phs.length >= 2 ? fitLine(phs) : mid,
    lower: pls.length >= 2 ? fitLine(pls) : mid,
    mid,
    rising: mid.slope > 0,
  }

  const supports = levels.filter(l => l.price < last).map(l => l.price)
  const resistances = levels.filter(l => l.price > last).map(l => l.price)
  const st = stopAndTarget(last, a, supports, resistances)
  const setup: TradeSetup = {
    price: last, stop: st.stop, target: st.target,
    rr: st.risk > 0 ? st.reward / st.risk : 0,
    riskPct: (st.risk / last) * 100,
    rewardPct: (st.reward / last) * 100,
  }

  return { pivotHighs: phs, pivotLows: pls, levels, channel, setup, atr: a, n }
}
