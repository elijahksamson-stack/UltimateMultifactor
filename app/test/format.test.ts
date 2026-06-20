import { describe, it, expect } from 'vitest'
import { formatScore, compareBy, zHeat } from '@/lib/ui/format'

describe('formatScore', () => {
  it('formats to 2 decimals, em-dash for null', () => {
    expect(formatScore(1.2345)).toBe('1.23')
    expect(formatScore(null)).toBe('—')
    expect(formatScore(-0.5)).toBe('-0.50')
  })
})

describe('compareBy', () => {
  it('sorts numbers desc with nulls last', () => {
    const rows = [{ s: 1 }, { s: null }, { s: 3 }]
    expect([...rows].sort(compareBy('s', 'desc')).map(r => r.s)).toEqual([3, 1, null])
  })
  it('sorts asc with nulls last', () => {
    const rows = [{ s: 3 }, { s: null }, { s: 1 }]
    expect([...rows].sort(compareBy('s', 'asc')).map(r => r.s)).toEqual([1, 3, null])
  })
  it('sorts strings', () => {
    const rows = [{ s: 'B' }, { s: 'A' }]
    expect([...rows].sort(compareBy('s', 'asc')).map(r => r.s)).toEqual(['A', 'B'])
  })
})

describe('zHeat', () => {
  it('buckets by sign and magnitude', () => {
    expect(zHeat(null)).toBe('z-null')
    expect(zHeat(0.1)).toBe('z-pos-1')
    expect(zHeat(1.2)).toBe('z-pos-2')
    expect(zHeat(2.5)).toBe('z-pos-3')
    expect(zHeat(-0.1)).toBe('z-neg-1')
    expect(zHeat(-2.5)).toBe('z-neg-3')
  })
})
