# UltimateMultifactor — Plan 4: Discovery UI (coder-minimalist)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A single-page discovery screener UI for the Next.js app — a dense, sortable ranked table reading `GET /api/discovery`, with per-factor z-score columns (subtle heat coloring), a sector filter, and a CSV download. Aesthetic: **modern minimalist coder-interface** — near-black canvas, monospace data, hairline borders, one distinctive accent, tabular numerics. Distinctive, not generic-AI dashboard.

**Architecture:** App Router root layout + `app/page.tsx` (server shell) + `app/ui/DiscoveryTable.tsx` (client component: fetch/sort/filter). Plain CSS (design-token `globals.css` + one CSS module) — no UI framework dep. Pure presentation helpers (format, sort comparator, z→heat bucket) are unit-tested in node; the React markup is verified by typecheck + `next build` + a browser smoke.

**Tech Stack:** Next.js 15 App Router, React 19, plain CSS modules, vitest (helpers only).

**Design tokens (coder-minimalist):**
```
--bg: #0B0D0F (canvas)   --panel: #111418   --line: #1E2329 (hairline)
--text: #E6E8EB   --muted: #8A9099   --accent: #5EE6A8 (mint/terminal, used sparingly)
--pos: #5EE6A8 (z>0)   --neg: #E0556B (z<0)   --zero: #5A626B
font: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace ; 13px ; tabular-nums
```
Sparing accent: rank-1 marker, active sort caret, links, focus. Heat = low-saturation tint of cell text by z sign+magnitude (3 buckets/side). No gradients/shadows beyond 1px lines; dense 28px rows; hover row = `--panel`.

**Standing convention:** update CLAUDE.md (Task 4).

---

## File Structure (additions to UltimateMultifactor/app/)
```
next.config.js                 # minimal (Task 1)
app/layout.tsx                 # root layout, theme (Task 1)
app/globals.css                # design tokens + base (Task 1)
app/page.tsx                   # server shell -> DiscoveryTable (Task 3)
app/ui/DiscoveryTable.tsx      # client component (Task 3)
app/ui/discovery.module.css    # table styles (Task 3)
lib/ui/format.ts               # formatScore, compareBy, zHeat (Task 2)
test/format.test.ts
```

---

## Task 1: Root layout + theme

**Files:** create `next.config.js`, `app/layout.tsx`, `app/globals.css`.

- [ ] **Step 1: next.config.js**
```js
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true }
module.exports = nextConfig
```

- [ ] **Step 2: app/globals.css**
```css
:root {
  --bg: #0B0D0F; --panel: #111418; --line: #1E2329;
  --text: #E6E8EB; --muted: #8A9099; --accent: #5EE6A8;
  --pos: #5EE6A8; --neg: #E0556B; --zero: #5A626B;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); }
body {
  font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;
  font-size: 13px; line-height: 1.4; -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
::selection { background: rgba(94,230,168,0.25); }
```

- [ ] **Step 3: app/layout.tsx**
```tsx
import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'UltimateMultifactor — Discovery',
  description: 'Technical/valuation stock discovery screener',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 4: typecheck + commit**
```bash
cd UltimateMultifactor/app && npx tsc --noEmit
git add UltimateMultifactor/app/next.config.js UltimateMultifactor/app/app/layout.tsx UltimateMultifactor/app/app/globals.css
git commit -m "feat(ui): root layout + coder-minimalist theme tokens"
```

---

## Task 2: Presentation helpers (TDD)

**Files:** create `lib/ui/format.ts`; Test: `test/format.test.ts`.

- [ ] **Step 1: failing test**
```ts
import { describe, it, expect } from 'vitest'
import { formatScore, compareBy, zHeat } from '@/lib/ui/format'

describe('formatScore', () => {
  it('formats to 2 decimals, em-dash for null', () => {
    expect(formatScore(1.2345)).toBe('1.23')
    expect(formatScore(null)).toBe('—')
    expect(formatScore(-0.5)).toBe('-0.50')
  })
})

describe('compareBy', () => {
  it('sorts numbers desc with nulls last', () => {
    const rows = [{ s: 1 }, { s: null }, { s: 3 }]
    expect([...rows].sort(compareBy('s', 'desc')).map(r => r.s)).toEqual([3, 1, null])
  })
  it('sorts asc with nulls last', () => {
    const rows = [{ s: 3 }, { s: null }, { s: 1 }]
    expect([...rows].sort(compareBy('s', 'asc')).map(r => r.s)).toEqual([1, 3, null])
  })
  it('sorts strings', () => {
    const rows = [{ s: 'B' }, { s: 'A' }]
    expect([...rows].sort(compareBy('s', 'asc')).map(r => r.s)).toEqual(['A', 'B'])
  })
})

describe('zHeat', () => {
  it('buckets by sign and magnitude', () => {
    expect(zHeat(null)).toBe('z-null')
    expect(zHeat(0.1)).toBe('z-pos-1')
    expect(zHeat(1.2)).toBe('z-pos-2')
    expect(zHeat(2.5)).toBe('z-pos-3')
    expect(zHeat(-0.1)).toBe('z-neg-1')
    expect(zHeat(-2.5)).toBe('z-neg-3')
  })
})
```

- [ ] **Step 2: run → FAIL** (`cd UltimateMultifactor/app && npx vitest run test/format.test.ts`)

- [ ] **Step 3: implement lib/ui/format.ts**
```ts
export function formatScore(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toFixed(2)
}

type Dir = 'asc' | 'desc'
export function compareBy<T>(key: keyof T, dir: Dir): (a: T, b: T) => number {
  return (a, b) => {
    const av = a[key] as unknown, bv = b[key] as unknown
    const an = av == null, bn = bv == null
    if (an && bn) return 0
    if (an) return 1            // nulls always last
    if (bn) return -1
    if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av
    const cmp = String(av).localeCompare(String(bv))
    return dir === 'asc' ? cmp : -cmp
  }
}

// subtle heat class for a z-score cell
export function zHeat(z: number | null | undefined): string {
  if (z == null || !Number.isFinite(z)) return 'z-null'
  const sign = z >= 0 ? 'pos' : 'neg'
  const m = Math.abs(z)
  const bucket = m >= 2 ? 3 : m >= 1 ? 2 : 1
  return `z-${sign}-${bucket}`
}
```

- [ ] **Step 4: run → PASS. Commit.**
```bash
git add UltimateMultifactor/app/lib/ui/format.ts UltimateMultifactor/app/test/format.test.ts
git commit -m "feat(ui): presentation helpers (format, sort comparator, z-heat) with tests"
```

---

## Task 3: Discovery table page

**Files:** create `app/page.tsx`, `app/ui/DiscoveryTable.tsx`, `app/ui/discovery.module.css`.

- [ ] **Step 1: app/ui/discovery.module.css** (coder-minimalist)
```css
.wrap { max-width: 1200px; margin: 0 auto; padding: 32px 24px 80px; }
.header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 4px; }
.title { font-size: 15px; font-weight: 600; letter-spacing: 0.02em; }
.title b { color: var(--accent); font-weight: 600; }
.meta { color: var(--muted); font-size: 12px; }
.controls { display: flex; gap: 12px; align-items: center; margin: 20px 0 12px; flex-wrap: wrap; }
.select, .download {
  background: var(--panel); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 6px 10px; font: inherit; font-size: 12px; cursor: pointer;
}
.download:hover, .select:hover { border-color: var(--accent); }
.tableScroll { border: 1px solid var(--line); border-radius: 8px; overflow: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 6px 10px; text-align: right; white-space: nowrap; height: 28px; }
th.left, td.left { text-align: left; }
thead th {
  position: sticky; top: 0; background: var(--panel); color: var(--muted);
  font-weight: 500; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;
  border-bottom: 1px solid var(--line); cursor: pointer; user-select: none;
}
thead th:hover { color: var(--text); }
.caret { color: var(--accent); margin-left: 4px; }
tbody tr { border-bottom: 1px solid var(--line); }
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: var(--panel); }
.rank { color: var(--muted); }
.rankTop { color: var(--accent); }
.ticker { color: var(--text); font-weight: 600; }
.sector { color: var(--muted); font-size: 12px; }
.empty, .error { color: var(--muted); padding: 40px; text-align: center; }
.z-null { color: var(--zero); }
.z-pos-1 { color: #9ad9bd; } .z-pos-2 { color: #6fe0ad; } .z-pos-3 { color: var(--pos); font-weight: 600; }
.z-neg-1 { color: #d39aa6; } .z-neg-2 { color: #e07d8e; } .z-neg-3 { color: var(--neg); font-weight: 600; }
```

- [ ] **Step 2: app/ui/DiscoveryTable.tsx** (client component)
```tsx
'use client'
import { useEffect, useMemo, useState } from 'react'
import { formatScore, compareBy, zHeat } from '@/lib/ui/format'
import styles from './discovery.module.css'

const s = styles as Record<string, string>

interface Row {
  rank: number; ticker: string; sector: string | null
  discoveryScore: number | null; technicalScore: number | null; valuationScore: number | null
  zX: number | null; zY: number | null; zZ: number | null
  zPB: number | null; zPS: number | null; zEQStability: number | null; zEQGrowth: number | null
}
const Z_COLS: { key: keyof Row; label: string }[] = [
  { key: 'zX', label: 'X' }, { key: 'zY', label: 'Y' }, { key: 'zZ', label: 'Z' },
  { key: 'zPB', label: 'P/B' }, { key: 'zPS', label: 'P/S' },
  { key: 'zEQStability', label: 'EQ·STB' }, { key: 'zEQGrowth', label: 'EQ·GRW' },
]

export default function DiscoveryTable() {
  const [rows, setRows] = useState<Row[]>([])
  const [runDate, setRunDate] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [sector, setSector] = useState<string>('all')
  const [sortKey, setSortKey] = useState<keyof Row>('rank')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    let live = true
    setState('loading')
    fetch('/api/discovery?limit=500')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => { if (!live) return; setRows(d.results ?? []); setRunDate(d.runDate ?? null); setState((d.results?.length ?? 0) ? 'ready' : 'empty') })
      .catch(() => { if (live) setState('error') })
    return () => { live = false }
  }, [])

  const sectors = useMemo(() => ['all', ...Array.from(new Set(rows.map(r => r.sector).filter((x): x is string => !!x)))], [rows])
  const view = useMemo(() => {
    const filtered = sector === 'all' ? rows : rows.filter(r => r.sector === sector)
    return [...filtered].sort(compareBy<Row>(sortKey, dir))
  }, [rows, sector, sortKey, dir])

  const onSort = (key: keyof Row) => {
    if (key === sortKey) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setDir(key === 'rank' || key === 'ticker' ? 'asc' : 'desc') }
  }
  const caret = (key: keyof Row) => sortKey === key ? <span className={s.caret}>{dir === 'asc' ? '↑' : '↓'}</span> : null

  return (
    <div className={s.wrap}>
      <div className={s.header}>
        <div className={s.title}><b>ultimatemultifactor</b> · discovery</div>
        <div className={s.meta}>{runDate ? `run ${String(runDate).slice(0, 10)} · ${rows.length} names` : ''}</div>
      </div>

      <div className={s.controls}>
        <select className={s.select} value={sector} onChange={e => setSector(e.target.value)} aria-label="sector filter">
          {sectors.map(sec => <option key={sec} value={sec}>{sec === 'all' ? 'all sectors' : sec}</option>)}
        </select>
        <a className={s.download} href={`/api/discovery?format=csv${sector !== 'all' ? `&sector=${encodeURIComponent(sector)}` : ''}&limit=1000`}>↓ csv</a>
      </div>

      {state === 'loading' && <div className={s.empty}>loading…</div>}
      {state === 'error' && <div className={s.error}>failed to load discovery results</div>}
      {state === 'empty' && <div className={s.empty}>no completed screen yet</div>}
      {state === 'ready' && (
        <div className={s.tableScroll}>
          <table>
            <thead>
              <tr>
                <th className={s.left} onClick={() => onSort('rank')}>#{caret('rank')}</th>
                <th className={s.left} onClick={() => onSort('ticker')}>ticker{caret('ticker')}</th>
                <th className={s.left} onClick={() => onSort('sector')}>sector{caret('sector')}</th>
                <th onClick={() => onSort('discoveryScore')}>score{caret('discoveryScore')}</th>
                <th onClick={() => onSort('technicalScore')}>tech{caret('technicalScore')}</th>
                <th onClick={() => onSort('valuationScore')}>val{caret('valuationScore')}</th>
                {Z_COLS.map(c => <th key={String(c.key)} onClick={() => onSort(c.key)}>{c.label}{caret(c.key)}</th>)}
              </tr>
            </thead>
            <tbody>
              {view.map(r => (
                <tr key={r.ticker}>
                  <td className={`${s.left} ${r.rank === 1 ? s.rankTop : s.rank}`}>{r.rank}</td>
                  <td className={`${s.left} ${s.ticker}`}>{r.ticker}</td>
                  <td className={`${s.left} ${s.sector}`}>{r.sector ?? '—'}</td>
                  <td>{formatScore(r.discoveryScore)}</td>
                  <td>{formatScore(r.technicalScore)}</td>
                  <td>{formatScore(r.valuationScore)}</td>
                  {Z_COLS.map(c => <td key={String(c.key)} className={s[zHeat(r[c.key] as number | null)]}>{formatScore(r[c.key] as number | null)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: app/page.tsx**
```tsx
import DiscoveryTable from './ui/DiscoveryTable'

export const dynamic = 'force-dynamic'

export default function Page() {
  return <DiscoveryTable />
}
```

- [ ] **Step 4: typecheck + build smoke + commit**
```bash
cd UltimateMultifactor/app && npx tsc --noEmit && npm run build
git add UltimateMultifactor/app/app/page.tsx UltimateMultifactor/app/app/ui
git commit -m "feat(ui): discovery screener table (sortable, sector filter, z-heat, csv)"
```
(The page is `force-dynamic` + client-fetched, so `next build` needs no DB/env. If build fails for a DB/env reason, report it — do not add a live DB to make build pass.)

---

## Task 4: Docs

- [ ] **Step 1: update UltimateMultifactor/app/CLAUDE.md** — add a "UI" section: discovery page (`/`), coder-minimalist theme (tokens in `app/globals.css`), `app/ui/DiscoveryTable.tsx` (client fetch of `/api/discovery`, sortable columns, sector filter, z-heat, CSV), helpers in `lib/ui/format.ts`.

- [ ] **Step 2: update UltimateMultifactor/CLAUDE.md** — mark Plan 4 (UI) done; app is now full-stack (worker + scoring core + Inngest/API + UI).

- [ ] **Step 3: commit**
```bash
git add UltimateMultifactor/app/CLAUDE.md UltimateMultifactor/CLAUDE.md
git commit -m "docs(ui): discovery UI in CLAUDE.md; mark Plan 4 done"
```

---

## Self-Review

**Spec coverage:** sortable ranked table reading `/api/discovery` (Task 3) ✅; per-factor z columns w/ subtle heat (Task 2 `zHeat` + Task 3 CSS) ✅; sector filter (Task 3) ✅; CSV download (Task 3) ✅; coder-minimalist theme — dark, monospace, hairline, single accent, tabular-nums (Task 1) ✅; CLAUDE.md (Task 4) ✅.

**Placeholder scan:** none.

**Type consistency:** `Row` matches the `/api/discovery` JSON `select` shape (rank, ticker, sector, discoveryScore, technicalScore, valuationScore, zX..zEQGrowth). `compareBy<Row>`/`zHeat`/`formatScore` match call sites. `zHeat` strings (`z-pos-1`..`z-neg-3`, `z-null`) match CSS-module class names; `s` cast to `Record<string,string>` for dynamic indexing.

**Known risks flagged:** `next build` needs no DB (page `force-dynamic` + client-fetched); CSS-module dynamic index handled via the `Record<string,string>` cast; loading/empty/error states all handled.
```
