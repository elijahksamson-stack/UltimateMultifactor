// Read-only diagnostic: compute X/Y/Z across the whole universe and report
// factor magnitudes vs the Decimal(18,6) staging column limit (~1e12).
import { loadActiveUniverse } from '@/lib/pipeline/loadUniverse'
import { analyzeBatch } from '@/lib/ta'

const DECIMAL_18_6_MAX = 1e12 // 12 integer digits

async function main() {
  const universe = await loadActiveUniverse()
  const tickers = universe.map(u => u.ticker)
  const BATCH = 50
  let maxX = 0, maxY = 0
  const overX: Array<[string, number]> = []
  const overY: Array<[string, number]> = []
  for (let i = 0; i < tickers.length; i += BATCH) {
    const slice = tickers.slice(i, i + BATCH)
    const res = await analyzeBatch(slice, 504)
    for (const r of res) {
      if (r.xVar != null) {
        if (Math.abs(r.xVar) > maxX) maxX = Math.abs(r.xVar)
        if (Math.abs(r.xVar) >= DECIMAL_18_6_MAX) overX.push([r.ticker, r.xVar])
      }
      if (r.yVar != null) {
        if (Math.abs(r.yVar) > maxY) maxY = Math.abs(r.yVar)
        if (Math.abs(r.yVar) >= DECIMAL_18_6_MAX) overY.push([r.ticker, r.yVar])
      }
    }
    if (i % 500 === 0) console.log(`...scanned ${i + slice.length}/${tickers.length}`)
  }
  console.log(`\nmax |xVar| = ${maxX.toExponential(3)}  | max |yVar| = ${maxY.toExponential(3)}`)
  console.log(`xVar over 1e12: ${overX.length}`, overX.slice(0, 10).map(([t, v]) => `${t}=${v.toExponential(2)}`).join(', '))
  console.log(`yVar over 1e12: ${overY.length}`, overY.slice(0, 10).map(([t, v]) => `${t}=${v.toExponential(2)}`).join(', '))
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
