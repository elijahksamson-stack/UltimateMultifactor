// One-shot ticker → market-cap map for a run, from FMP's company screener
// (a single call covers the US universe). Best-effort: any failure yields an
// empty map and the column simply shows em-dashes — it never blocks a screen.

export async function fetchMarketCaps(): Promise<Map<string, number>> {
  const key = process.env.FMP_API_KEY
  const base = process.env.FMP_BASE_URL || 'https://financialmodelingprep.com/stable'
  const url = `${base}/company-screener?country=US&isEtf=false&isFund=false&isActivelyTrading=true&limit=10000&apikey=${key}`
  const map = new Map<string, number>()
  try {
    const res = await fetch(url)
    if (!res.ok) return map
    const data = await res.json()
    if (!Array.isArray(data)) return map
    for (const r of data) {
      const sym = String(r?.symbol ?? '').toUpperCase()
      const mc = Number(r?.marketCap)
      if (sym && Number.isFinite(mc) && mc > 0) map.set(sym, mc)
    }
  } catch { /* best-effort — leave the map empty */ }
  return map
}
