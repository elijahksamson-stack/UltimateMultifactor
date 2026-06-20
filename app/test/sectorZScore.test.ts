import { describe, it, expect } from 'vitest'
import { sectorZScores } from '@/lib/factors/sectorZScore'

interface Row { ticker: string; sector: string | null; pb: number | null }

describe('sectorZScores', () => {
  it('z-scores within sector when >=5 members', () => {
    const rows: Row[] = [1, 2, 3, 4, 5].map((v, i) => ({ ticker: `T${i}`, sector: 'Tech', pb: v }))
    const out = sectorZScores(rows, [{ key: 'pb', invert: false }], r => r.sector)
    expect(out.get('T2')!.pb).toBeCloseTo(0, 6)
  })
  it('falls back to market-wide when sector has <5 members', () => {
    const tech: Row[] = [1, 2].map((v, i) => ({ ticker: `A${i}`, sector: 'Tech', pb: v }))
    const fin: Row[] = [3, 4, 5, 6, 7, 8].map((v, i) => ({ ticker: `B${i}`, sector: 'Fin', pb: v }))
    const out = sectorZScores([...tech, ...fin], [{ key: 'pb', invert: false }], r => r.sector)
    expect(Number.isFinite(out.get('A0')!.pb!)).toBe(true)
  })
  it('inverts when invert=true (lower raw => higher z)', () => {
    const rows: Row[] = [1, 2, 3, 4, 5].map((v, i) => ({ ticker: `T${i}`, sector: 'Tech', pb: v }))
    const out = sectorZScores(rows, [{ key: 'pb', invert: true }], r => r.sector)
    expect(out.get('T0')!.pb!).toBeGreaterThan(0)
  })
  it('excludes non-finite raw values from sector stats', () => {
    const rows: Row[] = [1, 2, 3, 4, Infinity].map((v, i) => ({ ticker: `T${i}`, sector: 'Tech', pb: v as number }))
    const out = sectorZScores(rows, [{ key: 'pb', invert: false }], r => r.sector)
    expect(Number.isFinite(out.get('T0')!.pb!)).toBe(true)
    expect(out.get('T1')!.pb!).not.toBeNaN()
  })
})
