import { inngest } from './client'
import { prisma } from '@/lib/db/ownClient'
import { otmPriceMaxDate, latestDateIsToday, loadActiveUniverse, resolveTargetDate } from '@/lib/pipeline/loadUniverse'
import { computeBatchRawFactors, persistStaging, finalizeScreen } from '@/lib/pipeline/batch'

const BATCH = 50

export const runScreen = inngest.createFunction(
  { id: 'run-screen', retries: 2 },
  [{ cron: 'TZ=America/New_York 0 3 * * *' }, { event: 'screen/run.trigger' }],
  async ({ event, step }) => {
    const targetIso = await step.run('resolve-and-gate', async () => {
      const d = resolveTargetDate((event as any)?.data?.targetDate, new Date())
      const maxDate = await otmPriceMaxDate()
      if (!maxDate || !latestDateIsToday(maxDate, d)) {
        throw new Error(`OTM price_history not fresh for ${d.toISOString().slice(0, 10)}`)
      }
      return d.toISOString()
    })
    const date = new Date(targetIso)

    const tickers = await step.run('load-universe', async () => {
      const u = await loadActiveUniverse()
      await prisma.screenerRun.upsert({
        where: { runDate: date },
        create: { runDate: date, status: 'running', totalBatches: Math.ceil(u.length / BATCH) },
        update: { status: 'running', totalBatches: Math.ceil(u.length / BATCH), completedBatches: 0, completedAt: null, errorLog: null },
      })
      await prisma.rawFactorStaging.deleteMany({ where: { runDate: date } })
      return u
    })

    for (let i = 0; i < tickers.length; i += BATCH) {
      const slice = tickers.slice(i, i + BATCH)
      await step.run(`batch-${i / BATCH}`, async () => {
        const rows = await computeBatchRawFactors(slice)
        await persistStaging(date, rows)
        await prisma.screenerRun.update({ where: { runDate: date }, data: { completedBatches: { increment: 1 } } })
      })
    }

    const result = await step.run('finalize', async () => {
      const r = await finalizeScreen(date)
      await prisma.screenerRun.update({ where: { runDate: date }, data: { status: 'complete', tickersProcessed: r.processed, completedAt: new Date() } })
      return r
    })
    return { date: targetIso, processed: result.processed }
  },
)

export const functions = [runScreen]
