import { describe, it, expect } from 'vitest'
import { scoreRawRows } from '@/lib/pipeline/batch'

describe('scoreRawRows', () => {
  it('drops rows with any negative z-score and ranks the survivors', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      ticker: `T${i}`, sector: 'Tech',
      xVar: i, yVar: i, zVar: i, pb: 6 - i, ps: 6 - i, eqStability: i, eqGrowth: i,
    }))
    const scored = scoreRawRows(rows)
    expect(scored.length).toBeGreaterThan(0)
    expect(scored.length).toBeLessThan(6)               // weakest names filtered out
    expect(scored[0].ticker).toBe('T5')                  // strongest survives at rank 1
    expect(scored.map(r => r.ticker)).not.toContain('T0') // weakest dropped
    const Z = ['zX', 'zY', 'zZ', 'zPB', 'zPS', 'zEQStability', 'zEQGrowth'] as const
    for (const r of scored) for (const k of Z) {
      const v = (r as unknown as Record<string, number | null>)[k]
      expect(v == null || v >= 0).toBe(true)             // no negative z on any survivor
    }
    scored.forEach((r, i) => expect(r.rank).toBe(i + 1)) // contiguous ranks
  })

  it('keeps a row whose only non-positive z is null (missing data, not negative)', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      ticker: `T${i}`, sector: 'Tech',
      xVar: i, yVar: i, zVar: i, pb: 6 - i, ps: 6 - i,
      eqStability: i, eqGrowth: i === 5 ? null : i, // T5 strong everywhere, EQ-growth missing
    }))
    const scored = scoreRawRows(rows)
    const t5 = scored.find(r => r.ticker === 'T5')
    expect(t5).toBeDefined()
    expect(t5!.zEQGrowth).toBeNull()
  })
})
