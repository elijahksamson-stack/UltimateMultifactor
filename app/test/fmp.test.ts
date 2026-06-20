import { describe, it, expect, vi } from 'vitest'
import { fetchValuationRatios } from '@/lib/fmp/fundamentals-lite'

describe('fetchValuationRatios', () => {
  it('returns pb/ps from a mocked client', async () => {
    const fakeClient = { getRatiosTTM: vi.fn().mockResolvedValue({ priceToBookRatioTTM: 2.5, priceToSalesRatioTTM: 1.3 }) }
    const r = await fetchValuationRatios('AAPL', fakeClient as any)
    expect(r).toEqual({ pb: 2.5, ps: 1.3 })
  })
  it('falls back to legacy field names and nulls when absent', async () => {
    const fakeClient = { getRatiosTTM: vi.fn().mockResolvedValue({ priceBookValueRatioTTM: 4, priceSalesRatioTTM: null }) }
    const r = await fetchValuationRatios('X', fakeClient as any)
    expect(r).toEqual({ pb: 4, ps: null })
  })
})
