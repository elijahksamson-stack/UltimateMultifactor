# UltimateMultifactor — Plan 2: Scoring Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the headless TypeScript scoring core that loads the OTM universe, computes all 7 factors (4 fundamental via FMP + 3 technical via the TA worker), z-scores them against GICS sector, composites + ranks, and writes `AdvancedScreenResult` to its own Neon DB — runnable via a CLI script.

**Architecture:** Next.js (App Router) + TypeScript + Prisma. Two Prisma/pg datasources: own DB (results) and a read-only pg client to OTM's Neon (`price_history`, `tickers`). The factor math is pure, unit-tested with vitest. FMP client + sector z-score helpers + EQ formulas are PORTED from OTM (`Website/eli-screener-main/`) — exact source lines cited per task. Inngest/API/UI are deferred to Plans 3 & 4.

**Tech Stack:** Next.js 15, TypeScript, Prisma 5, vitest, the existing OTM FMP client (ported), node fetch for the TA worker.

**Standing convention:** every new code subfolder gets a `CLAUDE.md` (Task 8).

**Ported-source reference (verbatim targets in `Website/eli-screener-main/`):**
- FMP client: `lib/fmp/client.ts` (FMPClient class, `getRatiosTTM` ~L348, `getIncomeStatement` ~L517, `getFMPClient` ~L1199) and `lib/fmp/fundamentals.ts`.
- EQ formulas: `lib/earnings-quality/index.ts` — `safeCagr` L96-107, `trendR2` L109-136, `yoyGrowth` L138-145, `stdDev` L147-154.
- Sector z-score: `scripts/calculate-all-rankings.ts` — `calculateZScore`/`getMean`/`getStdDev` L84-98, sector loop L210-291 (`<5` → market fallback).

---

## File Structure

```
UltimateMultifactor/app/                    # the Next.js app (distinct from ta-worker/)
  package.json, tsconfig.json, vitest.config.ts, next.config.js
  .env.local.example
  CLAUDE.md                                  # Task 8
  prisma/schema.prisma                       # own DB: ScreenerRun, AdvancedScreenResult
  lib/
    fmp/                                     # PORTED from OTM (Task 2)
    db/ownClient.ts                          # Prisma client (own results DB)
    db/otmClient.ts                          # read-only pg client to OTM
    factors/eqDecomposition.ts               # EQ stability + growth (Task 3)
    factors/sectorZScore.ts                  # generalized N-factor sector z-score (Task 4)
    factors/composite.ts                     # bucket + discovery score + rank (Task 6)
    taWorker/client.ts                       # POST /analyze-batch (Task 5)
    pipeline/loadUniverse.ts                 # read OTM tickers + freshness (Task 7)
    pipeline/scoreUniverse.ts                # orchestrate -> write results (Task 7)
    config/weights.ts                        # tunable weights (Task 6)
  scripts/run-screen.ts                      # CLI entry (Task 7)
  test/*.test.ts
```

---

## Task 1: Next.js + Prisma scaffold (own DB + OTM read client)

**Files:** create `UltimateMultifactor/app/package.json`, `tsconfig.json`, `vitest.config.ts`, `prisma/schema.prisma`, `lib/db/ownClient.ts`, `lib/db/otmClient.ts`, `.env.local.example`.

- [ ] **Step 1: package.json**
```json
{
  "name": "ultimatemultifactor",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "run-screen": "tsx scripts/run-screen.ts"
  },
  "dependencies": {
    "next": "15.1.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "@prisma/client": "5.22.0",
    "pg": "8.13.1"
  },
  "devDependencies": {
    "typescript": "5.7.2",
    "prisma": "5.22.0",
    "vitest": "2.1.8",
    "tsx": "4.19.2",
    "@types/node": "22.10.2",
    "@types/pg": "8.11.10"
  }
}
```
(If a pinned version fails to install, relax it minimally to the nearest installable release; record it. Keep the package set.)

- [ ] **Step 2: tsconfig.json** — standard Next.js strict config with `"strict": true`, `"moduleResolution": "bundler"`, `"paths": {"@/*": ["./*"]}`, `"types": ["vitest/globals","node"]`.

- [ ] **Step 3: vitest.config.ts**
```ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
})
```

- [ ] **Step 4: prisma/schema.prisma**
```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("OWN_DATABASE_URL") }

model ScreenerRun {
  id               Int       @id @default(autoincrement())
  runDate          DateTime  @db.Date
  status           String    @default("running")
  tickersProcessed Int       @default(0)
  startedAt        DateTime  @default(now())
  completedAt      DateTime?
  errorLog         String?
  @@unique([runDate])
  @@map("screener_runs")
}

model AdvancedScreenResult {
  id             Int      @id @default(autoincrement())
  runDate        DateTime @db.Date
  ticker         String   @db.VarChar(10)
  sector         String?  @db.VarChar(100)
  xVar           Decimal? @db.Decimal(18,6)
  yVar           Decimal? @db.Decimal(18,6)
  zVar           Int?
  pb             Decimal? @db.Decimal(18,6)
  ps             Decimal? @db.Decimal(18,6)
  eqStability    Decimal? @db.Decimal(18,6)
  eqGrowth       Decimal? @db.Decimal(18,6)
  zX             Decimal? @db.Decimal(10,4)
  zY             Decimal? @db.Decimal(10,4)
  zZ             Decimal? @db.Decimal(10,4)
  zPB            Decimal? @db.Decimal(10,4)
  zPS            Decimal? @db.Decimal(10,4)
  zEQStability   Decimal? @db.Decimal(10,4)
  zEQGrowth      Decimal? @db.Decimal(10,4)
  technicalScore Decimal? @db.Decimal(10,4)
  valuationScore Decimal? @db.Decimal(10,4)
  discoveryScore Decimal? @db.Decimal(10,4)
  rank           Int?
  @@unique([runDate, ticker])
  @@index([runDate, rank])
  @@map("advanced_screen_results")
}
```

- [ ] **Step 5: lib/db/ownClient.ts**
```ts
import { PrismaClient } from '@prisma/client'
export const prisma = new PrismaClient()
```

- [ ] **Step 6: lib/db/otmClient.ts**
```ts
import { Pool } from 'pg'
let pool: Pool | null = null
export function otmPool(): Pool {
  if (!pool) {
    const cs = process.env.OTM_DATABASE_URL
    if (!cs) throw new Error('OTM_DATABASE_URL must be set')
    pool = new Pool({ connectionString: cs, max: 8 })
  }
  return pool
}
```

- [ ] **Step 7: .env.local.example**
```
OWN_DATABASE_URL=postgresql://user:pass@host/ultimatemultifactor?sslmode=require
OTM_DATABASE_URL=postgresql://readonly@host/neondb?sslmode=require
FMP_API_KEY=your-fmp-key
TA_WORKER_URL=https://ta-worker.up.railway.app
TA_WORKER_SECRET=shared-bearer-token
```

- [ ] **Step 8: install + generate + commit**
```bash
cd UltimateMultifactor/app && npm install && npx prisma generate && npx tsc --noEmit
git add UltimateMultifactor/app/package.json UltimateMultifactor/app/package-lock.json UltimateMultifactor/app/tsconfig.json UltimateMultifactor/app/vitest.config.ts UltimateMultifactor/app/prisma/schema.prisma UltimateMultifactor/app/lib/db UltimateMultifactor/app/.env.local.example
git commit -m "chore(app): scaffold Next.js + Prisma (own DB + OTM read client)"
```

---

## Task 2: Port the FMP client + thin fundamentals fetchers

**Files:** copy `Website/eli-screener-main/lib/fmp/client.ts` → `UltimateMultifactor/app/lib/fmp/client.ts` (and any local helper it imports, e.g. a retry util); create `lib/fmp/fundamentals-lite.ts`; Test: `test/fmp.test.ts`.

The client is self-contained (reads `FMP_API_KEY`/`FMP_BASE_URL`, rate limiter + retry, `getRatiosTTM`, `getIncomeStatement`, error classes). Port it, resolve imports until `npx tsc --noEmit` is clean, then add a thin wrapper exposing only what we need. Do NOT copy db-integration files.

- [ ] **Step 1: copy the client**
```bash
mkdir -p UltimateMultifactor/app/lib/fmp
cp Website/eli-screener-main/lib/fmp/client.ts UltimateMultifactor/app/lib/fmp/client.ts
```
(Inspect `client.ts` imports; copy any local modules it needs into `lib/fmp/`. Remove unused imports so tsc is clean.)

- [ ] **Step 2: failing test**
```ts
// test/fmp.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fetchValuationRatios } from '@/lib/fmp/fundamentals-lite'

describe('fetchValuationRatios', () => {
  it('returns pb/ps from a mocked client', async () => {
    const fakeClient = { getRatiosTTM: vi.fn().mockResolvedValue({ priceToBookRatioTTM: 2.5, priceToSalesRatioTTM: 1.3 }) }
    const r = await fetchValuationRatios('AAPL', fakeClient as any)
    expect(r).toEqual({ pb: 2.5, ps: 1.3 })
  })
  it('falls back to legacy field names and nulls when absent', async () => {
    const fakeClient = { getRatiosTTM: vi.fn().mockResolvedValue({ priceBookValueRatioTTM: 4, priceSalesRatioTTM: null }) }
    const r = await fetchValuationRatios('X', fakeClient as any)
    expect(r).toEqual({ pb: 4, ps: null })
  })
})
```

- [ ] **Step 3: run → FAIL** (`cd UltimateMultifactor/app && npx vitest run test/fmp.test.ts`)

- [ ] **Step 4: implement lib/fmp/fundamentals-lite.ts**
```ts
import { getFMPClient, type FMPClient } from './client'

export interface ValuationRatios { pb: number | null; ps: number | null }

export async function fetchValuationRatios(ticker: string, client?: Pick<FMPClient, 'getRatiosTTM'>): Promise<ValuationRatios> {
  const fmp = client ?? getFMPClient()
  const r = await fmp.getRatiosTTM(ticker)
  return {
    pb: r?.priceToBookRatioTTM ?? r?.priceBookValueRatioTTM ?? null,
    ps: r?.priceToSalesRatioTTM ?? r?.priceSalesRatioTTM ?? null,
  }
}

export async function fetchIncomeStatements(ticker: string, limit = 6, client?: Pick<FMPClient, 'getIncomeStatement'>) {
  const fmp = client ?? getFMPClient()
  return fmp.getIncomeStatement(ticker, 'annual', limit)
}
```
(If the ported `getRatiosTTM` return type doesn't expose the legacy field names, widen the access with an `as any` cast on `r` or extend the interface — keep the null-coalescing order.)

- [ ] **Step 5: run → PASS. Commit.**
```bash
git add UltimateMultifactor/app/lib/fmp
git commit -m "feat(app): port FMP client + lite valuation/income fetchers"
```

---

## Task 3: EQ Stability + Growth decomposition (TDD)

**Files:** create `lib/factors/eqDecomposition.ts`; Test: `test/eqDecomposition.test.ts`. Port formulas from `lib/earnings-quality/index.ts` L96-154.

- [ ] **Step 1: failing test**
```ts
import { describe, it, expect } from 'vitest'
import { safeCagr, trendR2, computeEqGrowth, computeEqStability } from '@/lib/factors/eqDecomposition'

describe('safeCagr', () => {
  it('computes positive CAGR', () => { expect(safeCagr(100, 200, 2)!).toBeCloseTo(Math.sqrt(2) - 1, 6) })
  it('returns null on zero years', () => { expect(safeCagr(100, 200, 0)).toBeNull() })
})

describe('trendR2', () => {
  it('returns ~1 for a clean exponential series', () => {
    const vals = Array.from({ length: 8 }, (_, i) => 100 * Math.pow(1.1, i))
    expect(trendR2(vals)!).toBeGreaterThan(0.99)
  })
  it('returns null for < 6 points', () => { expect(trendR2([1, 2, 3])).toBeNull() })
})

describe('computeEqGrowth', () => {
  it('averages available CAGRs', () => {
    const stmts = [{ revenue: 200, eps: 4, netIncome: 40 }, { revenue: 100, eps: 2, netIncome: 20 }]
    expect(computeEqGrowth(stmts as any, 1)).toBeCloseTo(1.0, 6)
  })
  it('returns null when no statements', () => { expect(computeEqGrowth([], 1)).toBeNull() })
})

describe('computeEqStability', () => {
  it('high finite value for steady-growth series', () => {
    const stmts = Array.from({ length: 8 }, (_, i) => ({ eps: 1 * Math.pow(1.08, 7 - i), netIncome: 10 * Math.pow(1.08, 7 - i) }))
    const s = computeEqStability(stmts as any)
    expect(s).not.toBeNull()
    expect(s!).toBeGreaterThan(0.5)
  })
})
```

- [ ] **Step 2: run → FAIL**

- [ ] **Step 3: implement**
```ts
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

// statements newest-first; span in years
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

// chronological R2 minus a light YoY-volatility penalty; statements newest-first -> reverse
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
```

- [ ] **Step 4: run → PASS. Commit.**
```bash
git add UltimateMultifactor/app/lib/factors/eqDecomposition.ts UltimateMultifactor/app/test/eqDecomposition.test.ts
git commit -m "feat(app): EQ stability + growth decomposition (ported formulas)"
```

---

## Task 4: Generalized N-factor sector z-score engine (TDD)

**Files:** create `lib/factors/sectorZScore.ts`; Test: `test/sectorZScore.test.ts`. Port helpers from `scripts/calculate-all-rankings.ts` L84-98; generalize the sector loop (L210-291) with `<5`→market fallback.

- [ ] **Step 1: failing test**
```ts
import { describe, it, expect } from 'vitest'
import { sectorZScores } from '@/lib/factors/sectorZScore'

interface Row { ticker: string; sector: string | null; pb: number | null }

describe('sectorZScores', () => {
  it('z-scores within sector when >=5 members', () => {
    const rows: Row[] = [1, 2, 3, 4, 5].map((v, i) => ({ ticker: `T${i}`, sector: 'Tech', pb: v }))
    const out = sectorZScores(rows, [{ key: 'pb', invert: false }], r => r.sector)
    expect(out.get('T2')!.pb).toBeCloseTo(0, 6) // pb=3 is the mean
  })
  it('falls back to market-wide when sector has <5 members', () => {
    const tech: Row[] = [1, 2].map((v, i) => ({ ticker: `A${i}`, sector: 'Tech', pb: v }))
    const fin: Row[] = [3, 4, 5, 6, 7, 8].map((v, i) => ({ ticker: `B${i}`, sector: 'Fin', pb: v }))
    const out = sectorZScores([...tech, ...fin], [{ key: 'pb', invert: false }], r => r.sector)
    expect(Number.isFinite(out.get('A0')!.pb!)).toBe(true)
  })
  it('inverts when invert=true (lower raw => higher z)', () => {
    const rows: Row[] = [1, 2, 3, 4, 5].map((v, i) => ({ ticker: `T${i}`, sector: 'Tech', pb: v }))
    const out = sectorZScores(rows, [{ key: 'pb', invert: true }], r => r.sector)
    expect(out.get('T0')!.pb!).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: run → FAIL**

- [ ] **Step 3: implement**
```ts
export const calculateZScore = (value: number, mean: number, stdDev: number): number => {
  if (stdDev === 0) return 0
  const z = (value - mean) / stdDev
  return Math.max(-999, Math.min(999, z))
}
const getMean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const getStdDev = (a: number[], m: number) => Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)

export interface FactorSpec<T> { key: keyof T & string; invert: boolean }
const MIN_SECTOR = 5

function statsFor<T>(rows: T[], key: keyof T & string): { mean: number; sd: number; n: number } {
  const vals = rows.map(r => r[key] as unknown as number).filter(v => typeof v === 'number' && !Number.isNaN(v))
  if (!vals.length) return { mean: 0, sd: 0, n: 0 }
  const mean = getMean(vals)
  return { mean, sd: getStdDev(vals, mean), n: vals.length }
}

export function sectorZScores<T extends { ticker: string }>(
  rows: T[],
  factors: FactorSpec<T>[],
  sectorOf: (r: T) => string | null,
): Map<string, Record<string, number | null>> {
  const market = new Map(factors.map(f => [f.key, statsFor(rows, f.key)]))
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    const s = sectorOf(r)
    if (s) { if (!groups.has(s)) groups.set(s, []); groups.get(s)!.push(r) }
  }
  const out = new Map<string, Record<string, number | null>>()
  for (const r of rows) {
    const sector = sectorOf(r)
    const peers = sector ? groups.get(sector)! : rows
    const useSector = peers.length >= MIN_SECTOR
    const rec: Record<string, number | null> = {}
    for (const f of factors) {
      const raw = r[f.key] as unknown as number
      if (typeof raw !== 'number' || Number.isNaN(raw)) { rec[f.key] = null; continue }
      const st = useSector ? statsFor(peers, f.key) : market.get(f.key)!
      const z = calculateZScore(raw, st.mean, st.sd)
      rec[f.key] = f.invert ? -z : z
    }
    out.set(r.ticker, rec)
  }
  return out
}
```

- [ ] **Step 4: run → PASS. Commit.**
```bash
git add UltimateMultifactor/app/lib/factors/sectorZScore.ts UltimateMultifactor/app/test/sectorZScore.test.ts
git commit -m "feat(app): generalized N-factor sector z-score engine with market fallback"
```

---

## Task 5: TA worker client (TDD)

**Files:** create `lib/taWorker/client.ts`; Test: `test/taWorker.test.ts`.

- [ ] **Step 1: failing test**
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { analyzeBatch } from '@/lib/taWorker/client'

beforeEach(() => { process.env.TA_WORKER_URL = 'http://worker'; process.env.TA_WORKER_SECRET = 'sek' })

describe('analyzeBatch', () => {
  it('posts tickers with bearer auth and maps results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [{ ticker: 'AAPL', x_var: 1, y_var: 2, z_var: 3 }] }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await analyzeBatch(['AAPL'])
    expect(out[0]).toMatchObject({ ticker: 'AAPL', xVar: 1, yVar: 2, zVar: 3 })
    const opts = fetchMock.mock.calls[0][1]
    expect(opts.headers.Authorization).toBe('Bearer sek')
  })
  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    await expect(analyzeBatch(['X'])).rejects.toThrow()
  })
})
```

- [ ] **Step 2: run → FAIL**

- [ ] **Step 3: implement**
```ts
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
```

- [ ] **Step 4: run → PASS. Commit.**
```bash
git add UltimateMultifactor/app/lib/taWorker/client.ts UltimateMultifactor/app/test/taWorker.test.ts
git commit -m "feat(app): TA worker client for /analyze-batch"
```

---

## Task 6: Composite + rank (TDD)

**Files:** create `lib/config/weights.ts`, `lib/factors/composite.ts`; Test: `test/composite.test.ts`.

- [ ] **Step 1: failing test**
```ts
import { describe, it, expect } from 'vitest'
import { composite, rankRows } from '@/lib/factors/composite'

describe('composite', () => {
  it('averages technical and valuation buckets equally', () => {
    const c = composite({ zX: 1, zY: 1, zZ: 1, zPB: 2, zPS: 2, zEQStability: 2, zEQGrowth: 2 })
    expect(c.technicalScore).toBeCloseTo(1, 6)
    expect(c.valuationScore).toBeCloseTo(2, 6)
    expect(c.discoveryScore).toBeCloseTo(1.5, 6)
  })
  it('ignores null factors in a bucket mean', () => {
    const c = composite({ zX: 2, zY: null, zZ: null, zPB: null, zPS: null, zEQStability: null, zEQGrowth: null })
    expect(c.technicalScore).toBeCloseTo(2, 6)
    expect(c.valuationScore).toBeNull()
    expect(c.discoveryScore).toBeCloseTo(2, 6)
  })
})

describe('rankRows', () => {
  it('ranks by discoveryScore descending, nulls last', () => {
    const ranked = rankRows([{ ticker: 'A', discoveryScore: 1 }, { ticker: 'B', discoveryScore: 3 }, { ticker: 'C', discoveryScore: null }] as any)
    expect(ranked.map(r => r.ticker)).toEqual(['B', 'A', 'C'])
    expect(ranked[0].rank).toBe(1)
  })
})
```

- [ ] **Step 2: run → FAIL**

- [ ] **Step 3: implement**
```ts
// lib/config/weights.ts
export const WEIGHTS = {
  technical: { zX: 1, zY: 1, zZ: 1 },
  valuation: { zPB: 1, zPS: 1, zEQStability: 1, zEQGrowth: 1 },
} as const
```
```ts
// lib/factors/composite.ts
import { WEIGHTS } from '@/lib/config/weights'

type ZRec = Record<string, number | null>
const mean = (vals: (number | null)[]) => {
  const v = vals.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

export function composite(z: ZRec): { technicalScore: number | null; valuationScore: number | null; discoveryScore: number | null } {
  const technicalScore = mean(Object.keys(WEIGHTS.technical).map(k => z[k] ?? null))
  const valuationScore = mean(Object.keys(WEIGHTS.valuation).map(k => z[k] ?? null))
  const discoveryScore = mean([technicalScore, valuationScore])
  return { technicalScore, valuationScore, discoveryScore }
}

export function rankRows<T extends { discoveryScore: number | null }>(rows: T[]): (T & { rank: number })[] {
  return [...rows]
    .sort((a, b) => (b.discoveryScore ?? -Infinity) - (a.discoveryScore ?? -Infinity))
    .map((r, i) => ({ ...r, rank: i + 1 }))
}
```

- [ ] **Step 4: run → PASS. Commit.**
```bash
git add UltimateMultifactor/app/lib/config/weights.ts UltimateMultifactor/app/lib/factors/composite.ts UltimateMultifactor/app/test/composite.test.ts
git commit -m "feat(app): composite buckets + ranking with tunable weights"
```

---

## Task 7: Universe loader + orchestration script

**Files:** create `lib/pipeline/loadUniverse.ts`, `lib/pipeline/scoreUniverse.ts`, `scripts/run-screen.ts`; Test: `test/loadUniverse.test.ts` (transform unit only; full run is a manual smoke test).

- [ ] **Step 1: failing unit test for the freshness helper**
```ts
import { describe, it, expect } from 'vitest'
import { latestDateIsToday } from '@/lib/pipeline/loadUniverse'

describe('latestDateIsToday', () => {
  it('true when max date equals target', () => { expect(latestDateIsToday(new Date('2026-06-19'), new Date('2026-06-19'))).toBe(true) })
  it('false when stale', () => { expect(latestDateIsToday(new Date('2026-06-18'), new Date('2026-06-19'))).toBe(false) })
})
```

- [ ] **Step 2: run → FAIL**

- [ ] **Step 3: implement loadUniverse.ts**
```ts
import { otmPool } from '@/lib/db/otmClient'

export interface UniverseRow { ticker: string; sector: string | null }

export function latestDateIsToday(maxDate: Date, target: Date): boolean {
  return maxDate.toISOString().slice(0, 10) === target.toISOString().slice(0, 10)
}

export async function loadActiveUniverse(): Promise<UniverseRow[]> {
  const { rows } = await otmPool().query<UniverseRow>(
    `SELECT ticker, sector FROM tickers WHERE is_active = true ORDER BY ticker`
  )
  return rows
}

export async function otmPriceMaxDate(): Promise<Date | null> {
  const { rows } = await otmPool().query<{ max: Date | null }>(`SELECT MAX(date) AS max FROM price_history`)
  return rows[0]?.max ?? null
}
```

- [ ] **Step 4: run → PASS.**

- [ ] **Step 5: implement scoreUniverse.ts** (orchestration; covered by the smoke run in Step 7, no new unit test)
```ts
import { prisma } from '@/lib/db/ownClient'
import { loadActiveUniverse, otmPriceMaxDate, latestDateIsToday } from './loadUniverse'
import { fetchValuationRatios, fetchIncomeStatements } from '@/lib/fmp/fundamentals-lite'
import { computeEqGrowth, computeEqStability } from '@/lib/factors/eqDecomposition'
import { analyzeBatch } from '@/lib/taWorker/client'
import { sectorZScores, type FactorSpec } from '@/lib/factors/sectorZScore'
import { composite, rankRows } from '@/lib/factors/composite'

const BATCH = 50

interface RawRow {
  ticker: string; sector: string | null
  pb: number | null; ps: number | null; eqStability: number | null; eqGrowth: number | null
  xVar: number | null; yVar: number | null; zVar: number | null
}

export async function scoreUniverse(targetDate: Date): Promise<{ processed: number }> {
  const maxDate = await otmPriceMaxDate()
  if (!maxDate || !latestDateIsToday(maxDate, targetDate)) {
    throw new Error(`OTM price_history not fresh (max=${maxDate?.toISOString().slice(0,10)}, target=${targetDate.toISOString().slice(0,10)})`)
  }
  const universe = await loadActiveUniverse()
  const raw: RawRow[] = []

  for (let i = 0; i < universe.length; i += BATCH) {
    const slice = universe.slice(i, i + BATCH)
    const tech = await analyzeBatch(slice.map(s => s.ticker))
    const techByTicker = new Map(tech.map(t => [t.ticker, t]))
    for (const u of slice) {
      const t = techByTicker.get(u.ticker)
      let pb: number | null = null, ps: number | null = null, eqStability: number | null = null, eqGrowth: number | null = null
      try {
        const ratios = await fetchValuationRatios(u.ticker); pb = ratios.pb; ps = ratios.ps
        const stmts = await fetchIncomeStatements(u.ticker, 6)
        const mapped = stmts.map(s => ({ revenue: s.revenue, eps: s.eps, netIncome: s.netIncome }))
        eqGrowth = computeEqGrowth(mapped, Math.max(1, mapped.length - 1))
        eqStability = computeEqStability(mapped)
      } catch { /* per-ticker fundamentals failure -> nulls */ }
      raw.push({ ticker: u.ticker, sector: u.sector, pb, ps, eqStability, eqGrowth, xVar: t?.xVar ?? null, yVar: t?.yVar ?? null, zVar: t?.zVar ?? null })
    }
  }

  const factors: FactorSpec<RawRow>[] = [
    { key: 'xVar', invert: false }, { key: 'yVar', invert: false }, { key: 'zVar', invert: false },
    { key: 'pb', invert: true }, { key: 'ps', invert: true },
    { key: 'eqStability', invert: false }, { key: 'eqGrowth', invert: false },
  ]
  const z = sectorZScores(raw, factors, r => r.sector)

  const scored = raw.map(r => {
    const zr = z.get(r.ticker)!
    const zRec = { zX: zr.xVar, zY: zr.yVar, zZ: zr.zVar, zPB: zr.pb, zPS: zr.ps, zEQStability: zr.eqStability, zEQGrowth: zr.eqGrowth }
    return { ...r, ...zRec, ...composite(zRec) }
  })
  const ranked = rankRows(scored)

  await prisma.advancedScreenResult.deleteMany({ where: { runDate: targetDate } })
  for (let i = 0; i < ranked.length; i += 1000) {
    await prisma.advancedScreenResult.createMany({
      data: ranked.slice(i, i + 1000).map(r => ({
        runDate: targetDate, ticker: r.ticker, sector: r.sector,
        xVar: r.xVar, yVar: r.yVar, zVar: r.zVar, pb: r.pb, ps: r.ps, eqStability: r.eqStability, eqGrowth: r.eqGrowth,
        zX: r.zX, zY: r.zY, zZ: r.zZ, zPB: r.zPB, zPS: r.zPS, zEQStability: r.zEQStability, zEQGrowth: r.zEQGrowth,
        technicalScore: r.technicalScore, valuationScore: r.valuationScore, discoveryScore: r.discoveryScore, rank: r.rank,
      })),
    })
  }
  return { processed: ranked.length }
}
```

- [ ] **Step 6: scripts/run-screen.ts**
```ts
import { scoreUniverse } from '@/lib/pipeline/scoreUniverse'

async function main() {
  const arg = process.argv[2]
  const date = arg ? new Date(arg) : new Date(new Date().toISOString().slice(0, 10))
  const { processed } = await scoreUniverse(date)
  console.log(`Scored ${processed} tickers for ${date.toISOString().slice(0, 10)}`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 7: typecheck + test + commit** (full live run is a documented manual smoke test once env + worker are deployed; do NOT run in CI)
```bash
cd UltimateMultifactor/app && npx tsc --noEmit && npx vitest run
git add UltimateMultifactor/app/lib/pipeline UltimateMultifactor/app/scripts/run-screen.ts UltimateMultifactor/app/test/loadUniverse.test.ts
git commit -m "feat(app): universe loader + scoreUniverse orchestration + run-screen CLI"
```

---

## Task 8: README + CLAUDE.md

**Files:** create `UltimateMultifactor/app/CLAUDE.md`, `UltimateMultifactor/app/README.md`, top-level `UltimateMultifactor/CLAUDE.md`.

- [ ] **Step 1: app/CLAUDE.md** — purpose (scoring core), the 7-factor model, data flow (read OTM `tickers`/`price_history`; own FMP for P/B,P/S + EQ; TA worker for X/Y/Z; own Neon for results), key files (`lib/factors/*`, `lib/pipeline/*`, ported `lib/fmp`), how to run (`npm test`, `npm run run-screen 2026-06-19`), env vars, and the gotcha that `scoreUniverse` aborts if OTM prices aren't fresh.

- [ ] **Step 2: UltimateMultifactor/CLAUDE.md** — the two deployables (`ta-worker/` Python→Railway, `app/` Next.js→Vercel), spec/plan locations under `docs/superpowers/`, and that Plans 3 (Inngest+API) and 4 (UI) are pending.

- [ ] **Step 3: app/README.md** — one-paragraph pointer to CLAUDE.md + the design spec.

- [ ] **Step 4: commit**
```bash
git add UltimateMultifactor/app/CLAUDE.md UltimateMultifactor/app/README.md UltimateMultifactor/CLAUDE.md
git commit -m "docs(app): CLAUDE.md (scoring core + workspace) and README"
```

---

## Self-Review

**Spec coverage:** P/B, P/S (Task 2) ✅; EQ Stability + Growth split (Task 3) ✅; 7-factor sector z-score w/ <5 fallback + invert for P/B,P/S (Task 4) ✅; technical vars via worker (Task 5) ✅; composite buckets + rank, tunable weights (Task 6) ✅; reads OTM tickers/price_history, own DB results, freshness gate (Task 7) ✅; CLAUDE.md (Task 8) ✅. Inngest/API → Plan 3; UI → Plan 4 (intentional).

**Placeholder scan:** none — every step has concrete code.

**Type consistency:** `FactorSpec<T>` keys (`xVar,yVar,zVar,pb,ps,eqStability,eqGrowth`) match `RawRow`; `sectorZScores` returns `Map<ticker, Record<key, number|null>>`, remapped in Task 7 to `zX..zEQGrowth` which match `composite`'s `WEIGHTS` keys; `analyzeBatch` returns `TechnicalVars{xVar,yVar,zVar}`; `fetchIncomeStatements` rows expose `revenue/eps/netIncome` consumed by `computeEqGrowth/Stability`.

**Known risks flagged in-plan:** transaction/insert size for ~5,530 rows (chunked createMany, Task 7); FMP import resolution when copying client.ts (Task 2); ported `getRatiosTTM` legacy-field typing (Task 2 cast).
```
