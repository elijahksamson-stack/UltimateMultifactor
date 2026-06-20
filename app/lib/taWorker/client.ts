export interface TechnicalVars { ticker: string; xVar: number | null; yVar: number | null; zVar: number | null; error?: string }

export async function analyzeBatch(tickers: string[], lookbackDays = 504): Promise<TechnicalVars[]> {
  const url = process.env.TA_WORKER_URL, secret = process.env.TA_WORKER_SECRET
  if (!url || !secret) throw new Error('TA_WORKER_URL and TA_WORKER_SECRET must be set')
  const res = await fetch(`${url}/analyze-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ tickers, lookback_days: lookbackDays }),
  })
  if (!res.ok) throw new Error(`TA worker error: ${res.status}`)
  const data = await res.json() as { results: Array<{ ticker: string; x_var: number | null; y_var: number | null; z_var: number | null; error?: string }> }
  return data.results.map(r => ({ ticker: r.ticker, xVar: r.x_var, yVar: r.y_var, zVar: r.z_var, error: r.error }))
}
