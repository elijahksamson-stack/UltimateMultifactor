// Ticker → market-cap map for a run, from FMP's company screener across the US
// exchanges (NASDAQ / NYSE / AMEX). Filtering by exchange rather than country
// keeps US-listed ADRs (e.g. PDD) — a country=US filter drops them. Best-effort:
// any failure just yields fewer entries; the column then shows em-dashes.

export async function fetchMarketCaps(): Promise<Map<string, number>> {
  const key = process.env.FMP_API_KEY
  const base = process.env.FMP_BASE_URL || 'https://financialmodelingprep.com/stable'
  const map = new Map<string, number>()
  for (const exchange of ['NASDAQ', 'NYSE', 'AMEX']) {
    try {
      const url = `${base}/company-screener?exchange=${exchange}&isEtf=false&isFund=false&isActivelyTrading=true&limit=10000&apikey=${key}`
      const res = await fetch(url)
      if (!res.ok) continue
      const data = await res.json()
      if (!Array.isArray(data)) continue
      for (const r of data) {
        const sym = String(r?.symbol ?? '').toUpperCase()
        const mc = Number(r?.marketCap)
        if (sym && Number.isFinite(mc) && mc > 0) map.set(sym, mc)
      }
    } catch { /* best-effort per exchange */ }
  }
  return map
}
