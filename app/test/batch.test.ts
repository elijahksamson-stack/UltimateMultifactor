import { describe, it, expect } from 'vitest'
import { scoreRawRows } from '@/lib/pipeline/batch'

describe('scoreRawRows', () => {
  it('z-scores, composites, and ranks raw rows', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      ticker: `T${i}`, sector: 'Tech',
      xVar: i, yVar: i, zVar: i, pb: 6 - i, ps: 6 - i, eqStability: i, eqGrowth: i,
    }))
    const scored = scoreRawRows(rows)
    expect(scored).toHaveLength(6)
    expect(scored[0].rank).toBe(1)
    expect(scored[0].ticker).toBe('T5')
  })
})
