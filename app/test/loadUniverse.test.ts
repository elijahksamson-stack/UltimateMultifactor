import { describe, it, expect } from 'vitest'
import { latestDateIsToday, resolveTargetDate } from '@/lib/pipeline/loadUniverse'

describe('latestDateIsToday', () => {
  it('true when max date equals target', () => { expect(latestDateIsToday(new Date('2026-06-19'), new Date('2026-06-19'))).toBe(true) })
  it('false when stale', () => { expect(latestDateIsToday(new Date('2026-06-18'), new Date('2026-06-19'))).toBe(false) })
})

describe('resolveTargetDate', () => {
  it('uses an explicit ISO arg pinned to UTC midnight', () => {
    expect(resolveTargetDate('2026-06-19', new Date('2026-01-01T00:00:00Z')).toISOString()).toBe('2026-06-19T00:00:00.000Z')
  })
  it('derives the Eastern calendar date when no arg (late-night UTC rollover)', () => {
    // 2026-06-20T02:30:00Z == 2026-06-19 22:30 ET -> ET date is the 19th
    expect(resolveTargetDate(undefined, new Date('2026-06-20T02:30:00Z')).toISOString()).toBe('2026-06-19T00:00:00.000Z')
  })
})
