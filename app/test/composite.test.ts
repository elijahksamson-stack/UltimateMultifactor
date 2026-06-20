import { describe, it, expect } from 'vitest'
import { composite, rankRows } from '@/lib/factors/composite'

describe('composite', () => {
  it('averages technical and valuation buckets equally', () => {
    const c = composite({ zX: 1, zY: 1, zZ: 1, zPB: 2, zPS: 2, zEQStability: 2, zEQGrowth: 2 })
    expect(c.technicalScore).toBeCloseTo(1, 6)
    expect(c.valuationScore).toBeCloseTo(2, 6)
    expect(c.discoveryScore).toBeCloseTo(1.5, 6)
  })
  it('ignores null factors in a bucket mean', () => {
    const c = composite({ zX: 2, zY: null, zZ: null, zPB: null, zPS: null, zEQStability: null, zEQGrowth: null })
    expect(c.technicalScore).toBeCloseTo(2, 6)
    expect(c.valuationScore).toBeNull()
    expect(c.discoveryScore).toBeCloseTo(2, 6)
  })
})

describe('rankRows', () => {
  it('ranks by discoveryScore descending, nulls last', () => {
    const ranked = rankRows([{ ticker: 'A', discoveryScore: 1 }, { ticker: 'B', discoveryScore: 3 }, { ticker: 'C', discoveryScore: null }])
    expect(ranked.map(r => r.ticker)).toEqual(['B', 'A', 'C'])
    expect(ranked[0].rank).toBe(1)
  })
})
