// Read-only probe: measure real FMP throughput at increasing concurrency to
// size the parallelization fix. Hits ratios-ttm for distinct tickers and reports
// wall time + 429/402 counts. No writes.
import { loadActiveUniverse } from '@/lib/pipeline/loadUniverse'

const KEY = process.env.FMP_API_KEY!
const BASE = 'https://financialmodelingprep.com/stable'

async function call(sym: string): Promise<number> {
  const res = await fetch(`${BASE}/ratios-ttm?symbol=${sym}&apikey=${KEY}`)
  return res.status
}

async function runLevel(symbols: string[], concurrency: number) {
  let i = 0, ok = 0, rl = 0, other = 0
  const t0 = Date.now()
  async function worker() {
    while (i < symbols.length) {
      const s = symbols[i++]
      try {
        const st = await call(s)
        if (st === 200) ok++; else if (st === 429 || st === 402) rl++; else other++
      } catch { other++ }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  const ms = Date.now() - t0
  const rate = Math.round((symbols.length / ms) * 60000)
  console.log(`  concurrency=${String(concurrency).padStart(2)}  ${symbols.length} calls in ${ms}ms  -> ${rate}/min  ok=${ok} rateLimited=${rl} other=${other}`)
}

async function main() {
  const uni = await loadActiveUniverse()
  const syms = uni.slice(0, 240).map(u => u.ticker)
  console.log(`probing FMP ratios-ttm with ${syms.length} distinct tickers\n`)
  // distinct slices per level so caching doesn't skew results
  await runLevel(syms.slice(0, 30), 1)
  await runLevel(syms.slice(30, 90), 10)
  await runLevel(syms.slice(90, 170), 20)
  await runLevel(syms.slice(170, 240), 35)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
