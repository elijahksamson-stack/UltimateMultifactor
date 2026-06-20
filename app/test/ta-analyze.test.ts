import { describe, test, expect } from 'vitest'
import { analyzeBars } from '@/lib/ta/analyze'

describe('analyzeBars', () => {
  test('insufficient bars -> error, no throw', () => {
    const r = analyzeBars('AAA', [1, 2], [0, 1], [1, 1])
    expect(r.error).toBe('insufficient_bars')
    expect(r.xVar).toBeNull()
  })

  test('non-finite bars -> error, no throw', () => {
    const closes = [...Array(40).fill(10), NaN]
    const r = analyzeBars('BBB', closes.map(c => c + 0.5), closes.map(c => c - 0.5), closes)
    expect(r.error).toBe('non_finite_bars')
  })

  test('valid series -> numeric factors, no error', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 40 + i + (i % 3 === 0 ? 1.5 : -1.0))
    const r = analyzeBars('CCC', closes.map(c => c + 0.5), closes.map(c => c - 0.5), closes)
    expect(r.error).toBeUndefined()
    expect(typeof r.xVar).toBe('number')
    expect(typeof r.yVar).toBe('number')
    expect(typeof r.zVar).toBe('number')
    expect(Number.isFinite(r.xVar as number)).toBe(true)
  })
})
