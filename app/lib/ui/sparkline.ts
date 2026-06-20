// Pure SVG geometry for the price-detail sparkline. No DOM, no I/O — returns
// path `d` strings scaled to a viewBox so the component just renders them.

export interface ChartGeometry {
  line: string   // the price polyline
  trend: string  // linear-regression centerline
  band: string   // ±kσ dispersion channel (filled polygon) — visualizes X Var
  width: number
  height: number
  min: number
  max: number
  first: number
  last: number
}

/** Ordinary least-squares fit of `ys` over x = 0..n-1. */
export function linearFit(ys: readonly number[]): { slope: number; intercept: number } {
  const n = ys.length
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 }
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxx += i * i; sxy += i * ys[i] }
  const denom = n * sxx - sx * sx
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom
  return { slope, intercept: (sy - slope * sx) / n }
}

/**
 * Build the price line, regression centerline, and ±kσ dispersion channel,
 * all scaled into a `width`×`height` box with `pad` inset. The channel mirrors
 * the X-Var factor (residual dispersion around the fitted centerline).
 */
export function buildChart(
  values: readonly number[],
  width = 640,
  height = 168,
  pad = 10,
  kSigma = 1,
): ChartGeometry {
  const n = values.length
  const min = Math.min(...values)
  const max = Math.max(...values)
  const { slope, intercept } = linearFit(values)
  let ss = 0
  for (let i = 0; i < n; i++) { const e = values[i] - (slope * i + intercept); ss += e * e }
  const band = kSigma * Math.sqrt(ss / Math.max(1, n))
  const t0 = intercept, t1 = slope * (n - 1) + intercept
  // Vertical range spans both the series and the channel so nothing clips.
  const lo = Math.min(min, t0 - band, t1 - band)
  const hi = Math.max(max, t0 + band, t1 + band)
  const span = hi - lo || 1
  const X = (i: number) => pad + (n <= 1 ? 0 : (i / (n - 1)) * (width - 2 * pad))
  const Y = (v: number) => height - pad - ((v - lo) / span) * (height - 2 * pad)
  const f = (x: number) => x.toFixed(1)

  const line = values.map((v, i) => `${i ? 'L' : 'M'}${f(X(i))},${f(Y(v))}`).join('')
  const trend = `M${f(X(0))},${f(Y(t0))}L${f(X(n - 1))},${f(Y(t1))}`
  const bandPath =
    `M${f(X(0))},${f(Y(t0 + band))}L${f(X(n - 1))},${f(Y(t1 + band))}` +
    `L${f(X(n - 1))},${f(Y(t1 - band))}L${f(X(0))},${f(Y(t0 - band))}Z`

  return { line, trend, band: bandPath, width, height, min, max, first: values[0], last: values[n - 1] }
}
