// Pure donut-chart geometry. Slices are sorted by value (desc) and shaded with a
// mint-intensity ramp — the biggest sector is brightest, so concentration vs
// breadth reads at a glance without a generic rainbow palette.

export interface DonutSlice {
  label: string
  value: number
  pct: number    // 0..100
  path: string   // SVG ring-segment path
  shade: string  // rgba mint
}
export interface Donut {
  slices: DonutSlice[]
  total: number
  cx: number; cy: number; r: number; ir: number
}

const ACCENT = '94, 230, 168'
const TWO_PI = Math.PI * 2

const polar = (cx: number, cy: number, rad: number, ang: number): [number, number] =>
  [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]

export function donut(
  entries: ReadonlyArray<{ label: string; value: number }>,
  size = 240,
  thickness = 36,
): Donut {
  const cx = size / 2, cy = size / 2, r = size / 2, ir = r - thickness
  const items = entries.filter(e => e.value > 0).sort((a, b) => b.value - a.value)
  const total = items.reduce((sum, e) => sum + e.value, 0) || 1
  const f = (x: number) => x.toFixed(2)

  let a0 = -Math.PI / 2 // start at 12 o'clock
  const slices = items.map((e, i) => {
    const frac = e.value / total
    const a1 = a0 + frac * TWO_PI
    const large = a1 - a0 > Math.PI ? 1 : 0
    const [ox0, oy0] = polar(cx, cy, r, a0)
    const [ox1, oy1] = polar(cx, cy, r, a1)
    const [ix1, iy1] = polar(cx, cy, ir, a1)
    const [ix0, iy0] = polar(cx, cy, ir, a0)
    const path =
      `M${f(ox0)},${f(oy0)}A${f(r)},${f(r)} 0 ${large} 1 ${f(ox1)},${f(oy1)}` +
      `L${f(ix1)},${f(iy1)}A${f(ir)},${f(ir)} 0 ${large} 0 ${f(ix0)},${f(iy0)}Z`
    a0 = a1
    const op = items.length <= 1 ? 0.85 : 0.85 - (i / (items.length - 1)) * 0.6 // 0.85 → 0.25
    return { label: e.label, value: e.value, pct: frac * 100, path, shade: `rgba(${ACCENT}, ${op.toFixed(2)})` }
  })
  return { slices, total, cx, cy, r, ir }
}
