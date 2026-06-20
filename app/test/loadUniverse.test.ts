import { describe, it, expect } from 'vitest'
import { latestDateIsToday } from '@/lib/pipeline/loadUniverse'

describe('latestDateIsToday', () => {
  it('true when max date equals target', () => { expect(latestDateIsToday(new Date('2026-06-19'), new Date('2026-06-19'))).toBe(true) })
  it('false when stale', () => { expect(latestDateIsToday(new Date('2026-06-18'), new Date('2026-06-19'))).toBe(false) })
})
