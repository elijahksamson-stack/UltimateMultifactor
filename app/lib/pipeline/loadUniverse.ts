import { otmPool } from '@/lib/db/otmClient'

export interface UniverseRow { ticker: string; sector: string | null }

export function latestDateIsToday(maxDate: Date, target: Date): boolean {
  return maxDate.toISOString().slice(0, 10) === target.toISOString().slice(0, 10)
}

export async function loadActiveUniverse(): Promise<UniverseRow[]> {
  const { rows } = await otmPool().query<UniverseRow>(
    `SELECT ticker, sector FROM tickers WHERE is_active = true ORDER BY ticker`
  )
  return rows
}

export async function otmPriceMaxDate(): Promise<Date | null> {
  const { rows } = await otmPool().query<{ max: Date | null }>(`SELECT MAX(date) AS max FROM price_history`)
  return rows[0]?.max ?? null
}
