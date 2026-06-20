// Read-only: time a real 50-ticker batch through computeBatchRawFactors (TA +
// parallel FMP) to validate the parallelization speedup and rate-limit safety.
import { loadActiveUniverse } from '@/lib/pipeline/loadUniverse'
import { computeBatchRawFactors } from '@/lib/pipeline/batch'

async function main() {
  const uni = await loadActiveUniverse()
  const slice = uni.slice(0, 50).map(u => ({ ticker: u.ticker, sector: u.sector }))
  const t0 = Date.now()
  const rows = await computeBatchRawFactors(slice, 504)
  const ms = Date.now() - t0
  const withPb = rows.filter(r => r.pb != null).length
  const withEq = rows.filter(r => r.eqGrowth != null).length
  const withX = rows.filter(r => r.xVar != null).length
  console.log(`batch of ${rows.length}: ${ms}ms  (${Math.round(ms / rows.length)}ms/ticker)`)
  console.log(`populated: xVar=${withX} pb=${withPb} eqGrowth=${withEq}`)
  console.log(`projected full run (111 batches, FMP only): ~${Math.round((ms * 111) / 1000)}s + Inngest overhead`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
