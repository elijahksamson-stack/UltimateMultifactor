import { describe, it, expect } from 'vitest'
import { resolveScreenTarget } from '@/lib/pipeline/loadUniverse'

const NOW = new Date('2026-06-20T12:00:00Z')
const MAX = new Date('2026-06-18T00:00:00Z') // OTM's latest bar (6/19 = Juneteenth holiday)

describe('resolveScreenTarget', () => {
  it('explicit date matching the latest bar resolves to that date', () => {
    expect(resolveScreenTarget(MAX, '2026-06-18', NOW).toISOString().slice(0, 10)).toBe('2026-06-18')
  })

  it('explicit date that is not the latest bar throws (stale)', () => {
    expect(() => resolveScreenTarget(MAX, '2026-06-19', NOW)).toThrow(/not fresh/)
  })

  it('cron/auto run targets OTM latest trading day (gate self-passes)', () => {
    expect(resolveScreenTarget(MAX, undefined, NOW).toISOString().slice(0, 10)).toBe('2026-06-18')
  })

  it('auto run refuses an implausibly stale ingest', () => {
    const oldMax = new Date('2026-06-05T00:00:00Z') // 15 days before NOW
    expect(() => resolveScreenTarget(oldMax, undefined, NOW)).toThrow(/stale/)
  })

  it('auto run within the staleness window is allowed', () => {
    const recent = new Date('2026-06-16T00:00:00Z') // 4 days before NOW
    expect(resolveScreenTarget(recent, undefined, NOW).toISOString().slice(0, 10)).toBe('2026-06-16')
  })

  it('throws when OTM has no bars at all', () => {
    expect(() => resolveScreenTarget(null, undefined, NOW)).toThrow(/empty/)
  })
})
