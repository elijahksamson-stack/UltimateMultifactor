import { prisma } from '@/lib/db/ownClient'
import { loadActiveUniverse, otmPriceMaxDate, latestDateIsToday } from './loadUniverse'
import { computeBatchRawFactors, persistStaging, finalizeScreen } from './batch'

const BATCH = 50

export async function scoreUniverse(targetDate: Date): Promise<{ processed: number }> {
  const maxDate = await otmPriceMaxDate()
  if (!maxDate || !latestDateIsToday(maxDate, targetDate)) {
    throw new Error(`OTM price_history not fresh (max=${maxDate?.toISOString().slice(0,10)}, target=${targetDate.toISOString().slice(0,10)})`)
  }
  const universe = await loadActiveUniverse()
  await prisma.rawFactorStaging.deleteMany({ where: { runDate: targetDate } })

  for (let i = 0; i < universe.length; i += BATCH) {
    const slice = universe.slice(i, i + BATCH)
    const rows = await computeBatchRawFactors(slice)
    await persistStaging(targetDate, rows)
  }

  return finalizeScreen(targetDate)
}
