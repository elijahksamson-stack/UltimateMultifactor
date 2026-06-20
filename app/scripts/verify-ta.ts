// Dry-run: compute X/Y/Z in-process for a small slice of the real universe to
// verify the TS technical pass against live OTM bars. Reads only; persists nothing.
import { loadActiveUniverse } from '@/lib/pipeline/loadUniverse'
import { analyzeBatch } from '@/lib/ta'

async function main() {
  const n = Number(process.argv[2] ?? 20)
  const universe = await loadActiveUniverse()
  const slice = universe.slice(0, n).map(u => u.ticker)
  console.log(`universe=${universe.length}; analyzing first ${slice.length}: ${slice.join(',')}`)
  const t0 = Date.now()
  const results = await analyzeBatch(slice, 504)
  const ms = Date.now() - t0
  const ok = results.filter(r => !r.error)
  const errs = results.filter(r => r.error)
  console.log(`computed ${results.length} in ${ms}ms | ok=${ok.length} err=${errs.length}`)
  for (const r of results.slice(0, 12)) {
    console.log(`  ${r.ticker.padEnd(6)} x=${fmt(r.xVar)} y=${fmt(r.yVar)} z=${r.zVar ?? '—'} ${r.error ?? ''}`)
  }
  const byErr = errs.reduce<Record<string, number>>((a, r) => { a[r.error!] = (a[r.error!] ?? 0) + 1; return a }, {})
  if (errs.length) console.log('error breakdown:', JSON.stringify(byErr))
}
const fmt = (v: number | null) => v == null ? '—' : v.toFixed(3)
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
