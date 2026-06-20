import { describe, it, expect } from 'vitest'
import { safeCagr, trendR2, computeEqGrowth, computeEqStability } from '@/lib/factors/eqDecomposition'

describe('safeCagr', () => {
  it('computes positive CAGR', () => { expect(safeCagr(100, 200, 2)!).toBeCloseTo(Math.sqrt(2) - 1, 6) })
  it('returns null on zero years', () => { expect(safeCagr(100, 200, 0)).toBeNull() })
  it('returns null when start is zero (undefined growth rate)', () => { expect(safeCagr(0, 50, 1)).toBeNull() })
})

describe('trendR2', () => {
  it('returns ~1 for a clean exponential series', () => {
    const vals = Array.from({ length: 8 }, (_, i) => 100 * Math.pow(1.1, i))
    expect(trendR2(vals)!).toBeGreaterThan(0.99)
  })
  it('returns null for < 6 points', () => { expect(trendR2([1, 2, 3])).toBeNull() })
})

describe('computeEqGrowth', () => {
  it('averages available CAGRs', () => {
    const stmts = [{ revenue: 200, eps: 4, netIncome: 40 }, { revenue: 100, eps: 2, netIncome: 20 }]
    expect(computeEqGrowth(stmts as any, 1)).toBeCloseTo(1.0, 6)
  })
  it('returns null when no statements', () => { expect(computeEqGrowth([], 1)).toBeNull() })
})

describe('computeEqStability', () => {
  it('high finite value for steady-growth series', () => {
    const stmts = Array.from({ length: 8 }, (_, i) => ({ eps: 1 * Math.pow(1.08, 7 - i), netIncome: 10 * Math.pow(1.08, 7 - i) }))
    const s = computeEqStability(stmts as any)
    expect(s).not.toBeNull()
    expect(s!).toBeGreaterThan(0.5)
  })
})
