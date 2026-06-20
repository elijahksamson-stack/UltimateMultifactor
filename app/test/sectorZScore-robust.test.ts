import { describe, it, expect } from 'vitest'
import { sectorZScores } from '@/lib/factors/sectorZScore'

interface Row { ticker: string; sector: string | null; x: number }

const mkSector = (vals: number[]): Row[] =>
  vals.map((x, i) => ({ ticker: `T${i}`, sector: 'Tech', x }))

describe('sectorZScores — winsorization', () => {
  it('caps an extreme outlier so it cannot dominate the ranking', () => {
    // 50 normal values 1..50 + one 1e9 artifact
    const rows = mkSector([...Array.from({ length: 50 }, (_, i) => i + 1), 1e9])
    const out = sectorZScores(rows, [{ key: 'x', invert: false }], r => r.sector)
    const outlier = out.get('T50')!.x!   // the 1e9 row
    const topNormal = out.get('T49')!.x! // x = 50, the largest normal value
    // The artifact is winsorized to the same cap as the top normal value:
    expect(outlier).toBeCloseTo(topNormal, 6)
    // ...and its z is a sane handful of sigma, not hundreds.
    expect(Math.abs(outlier)).toBeLessThan(5)
  })

  it('keeps normal mid values near zero z despite an outlier', () => {
    const rows = mkSector([...Array.from({ length: 50 }, (_, i) => i + 1), 1e9])
    const out = sectorZScores(rows, [{ key: 'x', invert: false }], r => r.sector)
    expect(Math.abs(out.get('T24')!.x!)).toBeLessThan(1) // x = 25, mid
  })
})

describe('sectorZScores — log transform', () => {
  const wideSpread = [10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000]

  it('compresses order-of-magnitude spread and preserves ordering', () => {
    const rows = mkSector(wideSpread)
    const out = sectorZScores(rows, [{ key: 'x', invert: false, log: true }], r => r.sector)
    const zs = rows.map(r => out.get(r.ticker)!.x!)
    for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeGreaterThan(zs[i - 1]) // monotonic
    expect(Math.abs(zs[zs.length - 1])).toBeLessThan(3)
  })

  it('keeps the top z smaller with log than without, for the same spread', () => {
    const rows = mkSector(wideSpread)
    const withLog = sectorZScores(rows, [{ key: 'x', invert: false, log: true }], r => r.sector)
    const noLog = sectorZScores(rows, [{ key: 'x', invert: false }], r => r.sector)
    expect(Math.abs(withLog.get('T6')!.x!)).toBeLessThan(Math.abs(noLog.get('T6')!.x!))
  })
})
