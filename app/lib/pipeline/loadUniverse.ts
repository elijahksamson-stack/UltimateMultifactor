import { otmPool } from '@/lib/db/otmClient'

export interface UniverseRow { ticker: string; sector: string | null }

export function latestDateIsToday(maxDate: Date, target: Date): boolean {
  return maxDate.toISOString().slice(0, 10) === target.toISOString().slice(0, 10)
}

// Resolve the screen's target date. Explicit arg wins (ISO YYYY-MM-DD); otherwise
// use the US/Eastern calendar date of `now` (matches OTM price_history.date), pinned to UTC midnight.
export function resolveTargetDate(arg: string | undefined, now: Date): Date {
  const ymd = arg ?? now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  return new Date(`${ymd}T00:00:00Z`)
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
