import { describe, it, expect } from 'vitest'
import { analyzeTechnicals, type OHLC } from '@/lib/ta/levels'

function ohlcFromLows(lows: number[]): OHLC {
  return { low: lows, open: lows.map(l => l), close: lows.map(l => l + 1), high: lows.map(l => l + 2) }
}

function risingChannel(n = 120): OHLC {
  const open: number[] = [], high: number[] = [], low: number[] = [], close: number[] = []
  for (let i = 0; i < n; i++) {
    const trend = 100 + i * 0.4
    const c = trend + Math.sin(i / 3) * 6
    const o = trend + Math.sin((i - 1) / 3) * 6
    open.push(o); close.push(c)
    high.push(Math.max(o, c) + 1.5); low.push(Math.min(o, c) - 1.5)
  }
  return { open, high, low, close }
}

describe('analyzeTechnicals', () => {
  it('detects swings and a rising channel in an uptrend', () => {
    const t = analyzeTechnicals(risingChannel(), 4)
    expect(t.pivotHighs.length).toBeGreaterThan(1)
    expect(t.pivotLows.length).toBeGreaterThan(1)
    expect(t.channel.rising).toBe(true)
    expect(t.channel.lower.slope).toBeGreaterThan(0) // rising support
  })

  it('produces a coherent stop < price < target setup', () => {
    const t = analyzeTechnicals(risingChannel(), 4)
    expect(t.setup.stop).toBeLessThan(t.setup.price)
    expect(t.setup.target).toBeGreaterThan(t.setup.price)
    expect(t.setup.rr).toBeGreaterThan(0)
    expect(Number.isFinite(t.setup.rr)).toBe(true)
  })

  it('clusters repeated touches into a strong support level', () => {
    // two clear pivot lows at 90, price ends at 106
    const lows = [100, 98, 96, 94, 92, 90, 92, 94, 96, 98, 100, 98, 96, 94, 92, 90, 92, 94, 96, 98, 105]
    const t = analyzeTechnicals(ohlcFromLows(lows), 3)
    const support90 = t.levels.find(l => Math.abs(l.price - 90) < 1.5)
    expect(support90).toBeDefined()
    expect(support90!.type).toBe('support')
    expect(support90!.touches).toBeGreaterThanOrEqual(2)
    expect(support90!.distPct).toBeLessThan(0) // below current price
  })

  it('marks a falling series as not rising', () => {
    const lows = Array.from({ length: 60 }, (_, i) => 100 - i)
    expect(analyzeTechnicals(ohlcFromLows(lows), 4).channel.rising).toBe(false)
  })
})
