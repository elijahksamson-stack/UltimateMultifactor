import { describe, it, expect } from 'vitest'
import { toCsv, parseDiscoveryParams } from '@/lib/http/discoveryQuery'

describe('toCsv', () => {
  it('emits a header and rows', () => {
    const csv = toCsv([{ rank: 1, ticker: 'AAPL', sector: 'Tech', discoveryScore: 1.23 }])
    expect(csv.split('\n')[0]).toBe('rank,ticker,sector,discoveryScore')
    expect(csv.split('\n')[1]).toBe('1,AAPL,Tech,1.23')
  })
})

describe('parseDiscoveryParams', () => {
  it('defaults limit to 100 and clamps to 1000', () => {
    expect(parseDiscoveryParams(new URLSearchParams('')).limit).toBe(100)
    expect(parseDiscoveryParams(new URLSearchParams('limit=99999')).limit).toBe(1000)
  })
  it('reads sector + format', () => {
    const p = parseDiscoveryParams(new URLSearchParams('sector=Tech&format=csv'))
    expect(p.sector).toBe('Tech'); expect(p.format).toBe('csv')
  })
})
