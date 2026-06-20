// Continuous mint-intensity cell background, normalized within a column so the
// standout (high) values glow and the rest stay dark. Pure: value → CSS color.

const ACCENT_RGB = '94, 230, 168' // --accent
const MAX_OPACITY = 0.24

export interface Range { min: number; max: number }

/** Min/max of the finite numbers in `values` (for per-column normalization). */
export function rangeOf(values: ReadonlyArray<number | null | undefined>): Range {
  let min = Infinity, max = -Infinity
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v }
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 }
}

/** Normalize `value` into [0,1] across `range`, then to a faint mint background.
 *  Returns undefined for missing data (cell keeps the default background). */
export function heatBg(value: number | null | undefined, range: Range): string | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  const span = range.max - range.min
  const t = span <= 0 ? 0.5 : (value - range.min) / span
  const op = Math.max(0, Math.min(1, t)) * MAX_OPACITY
  return `rgba(${ACCENT_RGB}, ${op.toFixed(3)})`
}
