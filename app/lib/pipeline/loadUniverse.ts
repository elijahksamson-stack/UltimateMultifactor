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

// Refuse an auto (cron) run if OTM's latest bar is implausibly old — i.e. the
// upstream price ingest is broken, not just a weekend/holiday.
export const MAX_OTM_STALENESS_DAYS = 7
const MS_PER_DAY = 86_400_000

// Resolve + gate the run's target date against OTM's latest available bar.
// - Explicit date (manual trigger): must equal OTM's max date, else throw (stale).
// - No date (cron/auto): target OTM's latest trading day so the gate always
//   passes, with a staleness guard against a broken ingest.
export function resolveScreenTarget(maxDate: Date | null, explicit: string | undefined, now: Date): Date {
  if (!maxDate) throw new Error('OTM price_history is empty')
  const maxYmd = maxDate.toISOString().slice(0, 10)
  const target = resolveTargetDate(explicit ?? maxYmd, now)
  if (!latestDateIsToday(maxDate, target)) {
    throw new Error(`OTM price_history not fresh for ${target.toISOString().slice(0, 10)} (max ${maxYmd})`)
  }
  if (!explicit) {
    const ageDays = Math.floor((now.getTime() - maxDate.getTime()) / MS_PER_DAY)
    if (ageDays > MAX_OTM_STALENESS_DAYS) {
      throw new Error(`OTM price_history stale: max ${maxYmd} is ${ageDays}d old`)
    }
  }
  return target
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
