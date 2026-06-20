import { describe, it, expect } from 'vitest'
import { linearFit, buildChart } from '@/lib/ui/sparkline'
import { rangeOf, heatBg } from '@/lib/ui/gradient'

describe('linearFit', () => {
  it('fits a perfect line', () => {
    const { slope, intercept } = linearFit([0, 1, 2, 3, 4])
    expect(slope).toBeCloseTo(1, 6)
    expect(intercept).toBeCloseTo(0, 6)
  })
  it('handles a single point', () => {
    expect(linearFit([42]).slope).toBe(0)
    expect(linearFit([42]).intercept).toBe(42)
  })
})

describe('buildChart', () => {
  const geo = buildChart([10, 12, 11, 14, 13, 16], 600, 160)
  it('emits a line path, a trend line, and a closed band', () => {
    expect(geo.line.startsWith('M')).toBe(true)
    expect(geo.trend.startsWith('M')).toBe(true)
    expect(geo.band.endsWith('Z')).toBe(true) // channel is a closed polygon
  })
  it('reports series extremes and endpoints', () => {
    expect(geo.min).toBe(10)
    expect(geo.max).toBe(16)
    expect(geo.first).toBe(10)
    expect(geo.last).toBe(16)
  })
  it('keeps all coordinates within the viewBox', () => {
    const nums = geo.line.match(/[\d.]+/g)!.map(Number)
    for (let i = 0; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThanOrEqual(0); expect(nums[i]).toBeLessThanOrEqual(600)
      expect(nums[i + 1]).toBeGreaterThanOrEqual(0); expect(nums[i + 1]).toBeLessThanOrEqual(160)
    }
  })
})

describe('gradient', () => {
  it('finds the finite range, ignoring nulls', () => {
    expect(rangeOf([1, null, 3, undefined, 2])).toEqual({ min: 1, max: 3 })
  })
  it('maps high values to a stronger mint, low to faint', () => {
    const r = { min: 0, max: 10 }
    const hi = heatBg(10, r)!, lo = heatBg(0, r)!
    const opHi = Number(hi.match(/,\s*([\d.]+)\)$/)![1])
    const opLo = Number(lo.match(/,\s*([\d.]+)\)$/)![1])
    expect(opHi).toBeGreaterThan(opLo)
    expect(hi.startsWith('rgba(94, 230, 168')).toBe(true)
  })
  it('returns undefined for missing data', () => {
    expect(heatBg(null, { min: 0, max: 10 })).toBeUndefined()
    expect(heatBg(undefined, { min: 0, max: 10 })).toBeUndefined()
  })
  it('does not divide by zero when all values are equal', () => {
    expect(heatBg(5, { min: 5, max: 5 })).toMatch(/^rgba\(/)
  })
})
