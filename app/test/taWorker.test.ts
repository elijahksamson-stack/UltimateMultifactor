import { describe, it, expect, vi, beforeEach } from 'vitest'
import { analyzeBatch } from '@/lib/taWorker/client'

beforeEach(() => { process.env.TA_WORKER_URL = 'http://worker'; process.env.TA_WORKER_SECRET = 'sek' })

describe('analyzeBatch', () => {
  it('posts tickers with bearer auth and maps results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [{ ticker: 'AAPL', x_var: 1, y_var: 2, z_var: 3 }] }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await analyzeBatch(['AAPL'])
    expect(out[0]).toMatchObject({ ticker: 'AAPL', xVar: 1, yVar: 2, zVar: 3 })
    const opts = fetchMock.mock.calls[0][1]
    expect(opts.headers.Authorization).toBe('Bearer sek')
  })
  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(analyzeBatch(['X'])).rejects.toThrow()
  })
})
