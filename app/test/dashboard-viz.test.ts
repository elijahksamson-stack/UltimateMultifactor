import { describe, it, expect } from 'vitest'
import { donut } from '@/lib/ui/donut'
import { buyPoint } from '@/lib/ui/buyPoint'

describe('donut', () => {
  const d = donut([{ label: 'A', value: 10 }, { label: 'B', value: 6 }, { label: 'C', value: 4 }])
  it('sorts slices by value desc and sums to 100%', () => {
    expect(d.slices.map(s => s.label)).toEqual(['A', 'B', 'C'])
    expect(d.slices.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 4)
  })
  it('emits closed ring-segment paths', () => {
    expect(d.slices[0].path.startsWith('M')).toBe(true)
    expect(d.slices[0].path.endsWith('Z')).toBe(true)
  })
  it('shades the biggest slice brightest', () => {
    const op = (s: { shade: string }) => Number(s.shade.match(/,\s*([\d.]+)\)$/)![1])
    expect(op(d.slices[0])).toBeGreaterThan(op(d.slices[2]))
  })
  it('drops zero-value entries', () => {
    expect(donut([{ label: 'A', value: 5 }, { label: 'Z', value: 0 }]).slices).toHaveLength(1)
  })
})

describe('buyPoint', () => {
  const rising = Array.from({ length: 20 }, (_, i) => 10 + i) // 10..29
  const pullback = buyPoint([...rising, 25])   // up-trend, last dips below centerline
  const extended = buyPoint([...rising, 45])   // up-trend, last spikes above centerline
  const downtrend = buyPoint(Array.from({ length: 21 }, (_, i) => 30 - i))

  it('flags an up-trend pullback as a favorable entry', () => {
    expect(pullback.trendUp).toBe(true)
    expect(['pullback', 'oversold']).toContain(pullback.label)
    expect(pullback.strength).toBeGreaterThan(50)
  })
  it('rates an extended price as a weaker entry than a pullback', () => {
    expect(extended.label).toBe('extended')
    expect(extended.strength).toBeLessThan(pullback.strength)
  })
  it('flags a down-trend as unfavorable', () => {
    expect(downtrend.trendUp).toBe(false)
    expect(downtrend.label).toBe('downtrend')
    expect(downtrend.strength).toBeLessThan(50)
  })
  it('keeps strength within 0..100', () => {
    for (const b of [pullback, extended, downtrend]) {
      expect(b.strength).toBeGreaterThanOrEqual(0)
      expect(b.strength).toBeLessThanOrEqual(100)
    }
  })
})
