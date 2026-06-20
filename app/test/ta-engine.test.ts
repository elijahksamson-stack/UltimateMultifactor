import { describe, test, expect } from 'vitest'
import { atr, stopAndTarget, supportResistanceLevels, cluster } from '@/lib/ta/engine'

describe('atr', () => {
  test('constant range', () => {
    expect(atr(Array(30).fill(11.0), Array(30).fill(9.0), Array(30).fill(10.0), 14)).toBeCloseTo(2.0, 6)
  })
})

describe('stopAndTarget', () => {
  test('uses nearest levels', () => {
    const r = stopAndTarget(100, 2.0, [95, 80], [110, 130])
    expect(r.stop).toBeCloseTo(93.0)
    expect(r.target).toBeCloseTo(112.0)
    expect(r.risk).toBeCloseTo(7.0)
    expect(r.reward).toBeCloseTo(12.0)
  })

  test('fallback when no levels', () => {
    const r = stopAndTarget(100, 2.0, [], [])
    expect(r.stop).toBeCloseTo(96.0)
    expect(r.risk).toBeCloseTo(4.0)
    expect(r.target).toBeCloseTo(108.0)
  })
})

describe('supportResistanceLevels', () => {
  test('splits by price', () => {
    const highs = [10, 12, 14, 12, 10, 12, 16, 12, 10, 12, 14, 12, 10, 12, 18, 12, 10]
    const lows = [8, 7, 6, 7, 8, 7, 5, 7, 8, 7, 6, 7, 8, 7, 4, 7, 8]
    const closes = Array(highs.length).fill(9)
    const levels = supportResistanceLevels(highs, lows, closes, 1.0, 9.0, 3)
    expect(levels.resistances.every(r => r > 9.0)).toBe(true)
    expect(levels.supports.every(s => s < 9.0)).toBe(true)
    expect(levels.resistances.length).toBeGreaterThanOrEqual(1)
    expect(levels.supports.length).toBeGreaterThanOrEqual(1)
  })
})

describe('cluster', () => {
  test('does not chain-link', () => {
    // band = 0.75; 100.0 and 101.1 are > 0.75 apart, must NOT merge
    expect(cluster([100.0, 100.5, 101.1, 101.7], 1.0).length).toBe(2)
  })
})
