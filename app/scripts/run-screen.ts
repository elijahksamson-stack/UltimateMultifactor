import { scoreUniverse } from '@/lib/pipeline/scoreUniverse'
import { resolveTargetDate } from '@/lib/pipeline/loadUniverse'

async function main() {
  const date = resolveTargetDate(process.argv[2], new Date())
  const { processed } = await scoreUniverse(date)
  console.log(`Scored ${processed} tickers for ${date.toISOString().slice(0, 10)}`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
