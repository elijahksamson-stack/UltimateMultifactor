import { describe, test, expect } from 'vitest'
import { computeXVar, computeYVar, computeZVar, pivotHighs, InsufficientBars } from '@/lib/ta/factors'

describe('computeXVar', () => {
  test('symmetric dispersion has known value', () => {
    // palindromic ±2 offsets => slope 0 => flat centerline at 10
    const offs = [2, -2, 2, -2, 2, -2, 2, -2, 2, -2, -2, 2, -2, 2, -2, 2, -2, 2, -2, 2]
    const closes = offs.map(o => 10.0 + o)
    expect(computeXVar(closes)).toBeCloseTo(400.0, 6) // (10*2)*(10*2)
  })

  test('flat series returns zero', () => {
    expect(computeXVar(Array(20).fill(5.0))).toBe(0.0)
  })

  test('throws on too few bars', () => {
    expect(() => computeXVar([1, 2, 3])).toThrow(InsufficientBars)
  })

  test('throws on non-finite', () => {
    expect(() => computeXVar([NaN, ...Array(19).fill(1.0)])).toThrow()
  })

  test('throws on overflow output', () => {
    expect(() => computeXVar([...Array(29).fill(1.0), 1e200])).toThrow()
  })
})

describe('computeYVar', () => {
  test('basic ratio', () => {
    expect(computeYVar(100, 110, 95)).toBeCloseTo(2.0)
  })
  test('zero or negative risk returns zero', () => {
    expect(computeYVar(100, 110, 100)).toBe(0.0)
    expect(computeYVar(100, 110, 105)).toBe(0.0)
  })
  test('negative reward allowed', () => {
    expect(computeYVar(100, 98, 95)).toBeCloseTo(-0.4)
  })
})

describe('pivotHighs', () => {
  test('detects local maxima', () => {
    const highs = [1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0]
    const idxs = pivotHighs(highs, 3).map(([i]) => i)
    expect(idxs).toContain(4)
    expect(idxs).toContain(13)
  })
})

function pushSeries(seqs: number[][]): { highs: number[]; lows: number[]; closes: number[] } {
  const highs: number[] = [], lows: number[] = [], closes: number[] = []
  for (const seq of seqs) for (const c of seq) { highs.push(c + 0.5); lows.push(c - 0.5); closes.push(c) }
  return { highs, lows, closes }
}

describe('computeZVar', () => {
  test('counts one flip', () => {
    const { highs, lows, closes } = pushSeries([
      [40, 42, 44, 46, 48, 50, 49, 48, 47, 46, 45, 44, 46, 47, 48],
      [47, 46, 45, 45, 46, 45, 44, 45, 46, 45, 46, 47, 48, 49, 50],
      [51, 52, 53, 54, 55, 55, 54, 53, 52, 51],
      [50, 50, 50, 51, 52, 51, 50, 51, 52, 53],
      [54, 55, 56, 57, 58, 59, 60, 59, 60, 61],
    ])
    expect(computeZVar(highs, lows, closes, 1.0, 252, 0.5)).toBe(1)
  })

  test('no flip when never retested', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 40 + i)
    const highs = closes.map(c => c + 0.5)
    const lows = closes.map(c => c - 0.5)
    expect(computeZVar(highs, lows, closes, 1.0)).toBe(0)
  })

  test('double top counts one flip', () => {
    const { highs, lows, closes } = pushSeries([
      [40, 42, 44, 46, 48, 50, 48, 47, 48, 50, 48, 46, 45, 46, 47],
      [47, 46, 45, 45, 46, 45, 44, 45, 46, 45, 46, 47, 48, 49, 50],
      [51, 52, 53, 54, 55, 55, 54, 53, 52, 51],
      [50, 50, 50, 51, 52, 51, 50, 51, 52, 53],
      [54, 55, 56, 57, 58, 59, 60, 59, 60, 61],
    ])
    expect(computeZVar(highs, lows, closes, 1.0)).toBe(1)
  })
})
