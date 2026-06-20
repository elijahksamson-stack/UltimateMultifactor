// Pure buy-point read on a price series: where does the latest close sit relative
// to its own regression channel, and is the trend rising? A favorable entry is an
// uptrend that hasn't overextended above its centerline.
import { linearFit } from './sparkline'

export type BuyLabel = 'oversold' | 'pullback' | 'at trend' | 'extended' | 'downtrend'

export interface BuyPoint {
  channelPos: number    // σ-units of last close vs the regression centerline (− = below trend)
  trendUp: boolean
  trendPctPerMo: number // centerline slope as % per ~21 trading days
  pctFromHigh: number   // % below the window high
  pctFromLow: number    // % above the window low
  label: BuyLabel
  strength: number      // 0..100 — higher = more favorable entry
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function buyPoint(closes: readonly number[]): BuyPoint {
  const n = closes.length
  const last = closes[n - 1]
  const { slope, intercept } = linearFit(closes)
  const centerlineLast = slope * (n - 1) + intercept
  let ss = 0
  for (let i = 0; i < n; i++) { const e = closes[i] - (slope * i + intercept); ss += e * e }
  const sigma = Math.sqrt(ss / Math.max(1, n)) || 1
  const channelPos = (last - centerlineLast) / sigma
  const trendUp = slope > 0
  const trendPctPerMo = centerlineLast ? (slope * 21 / centerlineLast) * 100 : 0

  const hi = Math.max(...closes), lo = Math.min(...closes)
  const pctFromHigh = hi ? ((hi - last) / hi) * 100 : 0
  const pctFromLow = lo ? ((last - lo) / lo) * 100 : 0

  const label: BuyLabel =
    !trendUp ? 'downtrend'
      : channelPos <= -1.5 ? 'oversold'
        : channelPos < -0.3 ? 'pullback'
          : channelPos <= 0.8 ? 'at trend'
            : 'extended'

  // Favor uptrends; reward pullbacks below the centerline, penalize extension above it.
  const trendBase = trendUp ? 20 : -25
  const pullbackBonus = Math.max(0, -channelPos) * 15
  const extensionPenalty = Math.max(0, channelPos) * 15
  const strength = Math.round(clamp(50 + trendBase + pullbackBonus - extensionPenalty, 0, 100))

  return { channelPos, trendUp, trendPctPerMo, pctFromHigh, pctFromLow, label, strength }
}
