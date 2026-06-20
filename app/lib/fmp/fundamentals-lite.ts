import { getFMPClient, type FMPClient } from './client'

export interface ValuationRatios { pb: number | null; ps: number | null }

export async function fetchValuationRatios(ticker: string, client?: Pick<FMPClient, 'getRatiosTTM'>): Promise<ValuationRatios> {
  const fmp = client ?? getFMPClient()
  const r: any = await fmp.getRatiosTTM(ticker)
  return {
    pb: r?.priceToBookRatioTTM ?? r?.priceBookValueRatioTTM ?? null,
    ps: r?.priceToSalesRatioTTM ?? r?.priceSalesRatioTTM ?? null,
  }
}

export async function fetchIncomeStatements(ticker: string, limit = 6, client?: Pick<FMPClient, 'getIncomeStatement'>) {
  const fmp = client ?? getFMPClient()
  return fmp.getIncomeStatement(ticker, 'annual', limit)
}
