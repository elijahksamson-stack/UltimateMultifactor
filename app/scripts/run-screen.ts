import { scoreUniverse } from '@/lib/pipeline/scoreUniverse'

async function main() {
  const arg = process.argv[2]
  const date = arg ? new Date(arg) : new Date(new Date().toISOString().slice(0, 10))
  const { processed } = await scoreUniverse(date)
  console.log(`Scored ${processed} tickers for ${date.toISOString().slice(0, 10)}`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
