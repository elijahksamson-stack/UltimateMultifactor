const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function safeCagr(start: number | null, end: number | null, years: number): number | null {
  if (years <= 0 || !Number.isFinite(years)) return null
  if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start > 0 && end > 0) return Math.pow(end / start, 1 / years) - 1
  const denom = Math.max(Math.abs(start), 1e-9)
  return ((end - start) / denom) / years
}

export function trendR2(values: (number | null)[]): number | null {
  const y = values.filter(isNum)
  if (y.length < 6) return null
  const n = y.length
  const x = Array.from({ length: n }, (_, i) => i)
  const yUse = y.every(v => v > 0) ? y.map(v => Math.log(v)) : y
  const xMean = x.reduce((a, b) => a + b, 0) / n
  const yMean = yUse.reduce((a, b) => a + b, 0) / n
  const ssX = x.reduce((s, xi) => s + (xi - xMean) ** 2, 0)
  if (ssX <= 0) return null
  const ssXY = x.reduce((s, xi, i) => s + (xi - xMean) * (yUse[i] - yMean), 0)
  const b = ssXY / ssX, a = yMean - b * xMean
  const yHat = x.map(xi => a + b * xi)
  const ssRes = yUse.reduce((s, yi, i) => s + (yi - yHat[i]) ** 2, 0)
  const ssTot = yUse.reduce((s, yi) => s + (yi - yMean) ** 2, 0)
  if (ssTot <= 0) return null
  return 1 - ssRes / ssTot
}

export function stdDev(values: (number | null)[]): number | null {
  const v = values.filter(isNum)
  if (v.length < 2) return null
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  return Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length)
}

export interface IncomeRow { revenue?: number; eps?: number; netIncome?: number }

export function computeEqGrowth(statements: IncomeRow[], years: number): number | null {
  if (!statements.length) return null
  const newest = statements[0], oldest = statements[statements.length - 1]
  const cagrs = [
    safeCagr(oldest.revenue ?? null, newest.revenue ?? null, years),
    safeCagr(oldest.eps ?? null, newest.eps ?? null, years),
    safeCagr(oldest.netIncome ?? null, newest.netIncome ?? null, years),
  ].filter(isNum)
  if (!cagrs.length) return null
  return cagrs.reduce((a, b) => a + b, 0) / cagrs.length
}

export function computeEqStability(statements: IncomeRow[]): number | null {
  const chrono = [...statements].reverse()
  const eps = chrono.map(s => s.eps ?? null)
  const ni = chrono.map(s => s.netIncome ?? null)
  const r2s = [trendR2(eps), trendR2(ni)].filter(isNum)
  if (!r2s.length) return null
  const r2 = r2s.reduce((a, b) => a + b, 0) / r2s.length
  const yoy: (number | null)[] = eps.map((v, i) => (i === 0 || eps[i - 1] == null || v == null || eps[i - 1] === 0) ? null : (v! / (eps[i - 1] as number)) - 1)
  const vol = stdDev(yoy)
  return r2 - (vol != null ? Math.min(vol, 1) * 0.25 : 0)
}
