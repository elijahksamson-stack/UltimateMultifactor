# UltimateMultifactor — Plan 3: Inngest Orchestration + Discovery API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wrap the Plan 2 scoring core in an Inngest nightly pipeline (cron + freshness gate + step-per-batch execution that fits Vercel's 5-min function limit) and expose the ranked discovery list via `/api/discovery` (JSON + CSV) and a manual admin trigger.

**Architecture:** Single Inngest function `run-screen` orchestrates: freshness-gate step → load-universe step → one `step.run` per 50-ticker batch (each ≤5 min, computes FMP + TA-worker factors, upserts to a `RawFactorStaging` table) → finalize step (load staging, sector z-score + composite + rank, write `advanced_screen_results` in a transaction, clear staging, mark `ScreenerRun` complete). Reuses OTM's Inngest account keys; new Inngest app id. Mirrors OTM's batched pattern so no single step exceeds Vercel limits.

**Tech Stack:** inngest (npm), Next.js App Router route handlers, Prisma (own DB), the Plan 2 scoring modules.

**Standing convention:** update CLAUDE.md (Task 6).

**Ported pattern (from `Website/eli-screener-main/`):** `inngest/client.ts` (`new Inngest({id,name,eventKey})`), `app/api/inngest/route.ts` (`serve({client,functions,signingKey})` with `runtime='nodejs'`, `maxDuration=300`, `dynamic='force-dynamic'`), cron form `TZ=America/New_York 0 3 * * *`.

---

## File Structure (additions to UltimateMultifactor/app/)
```
prisma/schema.prisma          # + RawFactorStaging; ScreenerRun batch counters (Task 1)
inngest/client.ts             # Inngest client + Events types (Task 1)
inngest/functions.ts          # runScreen function + registry (Task 3)
app/api/inngest/route.ts      # serve handler (Task 1)
app/api/admin/trigger-screen/route.ts   # manual trigger (Task 4)
app/api/discovery/route.ts    # JSON + CSV discovery list (Task 5)
lib/pipeline/batch.ts         # computeBatchRawFactors + finalizeScreen (Task 2)
lib/http/adminAuth.ts, lib/http/discoveryQuery.ts
test/batch.test.ts, test/adminAuth.test.ts, test/discovery.test.ts
```

---

## Task 1: Inngest client + serve route + staging table

**Files:** add `inngest` dep; create `inngest/client.ts`, `app/api/inngest/route.ts`, a temporary `inngest/functions.ts`; add `RawFactorStaging` + `ScreenerRun` counters to `prisma/schema.prisma`; add env to `.env.local.example`.

- [ ] **Step 1: add dep**
```bash
cd UltimateMultifactor/app && npm install inngest@3.27.4
```
(If unavailable, install latest 3.x and record it.)

- [ ] **Step 2: schema — add RawFactorStaging + ScreenerRun counters** (multi-line Prisma syntax)
```prisma
model RawFactorStaging {
  id          Int      @id @default(autoincrement())
  runDate     DateTime @db.Date
  ticker      String   @db.VarChar(10)
  sector      String?  @db.VarChar(100)
  xVar        Decimal? @db.Decimal(18,6)
  yVar        Decimal? @db.Decimal(18,6)
  zVar        Int?
  pb          Decimal? @db.Decimal(18,6)
  ps          Decimal? @db.Decimal(18,6)
  eqStability Decimal? @db.Decimal(18,6)
  eqGrowth    Decimal? @db.Decimal(18,6)
  @@unique([runDate, ticker])
  @@map("raw_factor_staging")
}
```
In the existing `ScreenerRun` model, add: `totalBatches Int @default(0)` and `completedBatches Int @default(0)`. Run `npx prisma generate`.

- [ ] **Step 3: inngest/client.ts**
```ts
import { Inngest } from 'inngest'

export const inngest = new Inngest({
  id: 'ultimatemultifactor',
  name: 'UltimateMultifactor Screener',
  eventKey: process.env.INNGEST_EVENT_KEY,
})

export type Events = {
  'screen/run.trigger': { data: { targetDate?: string } }
}
```

- [ ] **Step 4: temporary inngest/functions.ts** (replaced in Task 3, lets Task 1 typecheck)
```ts
export const functions: any[] = []
```

- [ ] **Step 5: app/api/inngest/route.ts**
```ts
import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { functions } from '@/inngest/functions'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  signingKey: process.env.INNGEST_SIGNING_KEY,
})
```

- [ ] **Step 6: append to .env.local.example**
```
INNGEST_EVENT_KEY=reuse-otm-event-key
INNGEST_SIGNING_KEY=reuse-otm-signing-key
ADMIN_TRIGGER_SECRET=generate-a-token
```

- [ ] **Step 7: typecheck + commit**
```bash
cd UltimateMultifactor/app && npx prisma generate && npx tsc --noEmit
git add UltimateMultifactor/app/package.json UltimateMultifactor/app/package-lock.json UltimateMultifactor/app/prisma/schema.prisma UltimateMultifactor/app/inngest UltimateMultifactor/app/app/api/inngest UltimateMultifactor/app/.env.local.example
git commit -m "chore(app): Inngest client + serve route + staging table"
```

---

## Task 2: Extract batch + transactional finalize (TDD)

**Files:** create `lib/pipeline/batch.ts`; modify `lib/pipeline/scoreUniverse.ts` to reuse it; Test: `test/batch.test.ts`.

- [ ] **Step 1: failing test for the pure scoring transform**
```ts
import { describe, it, expect } from 'vitest'
import { scoreRawRows } from '@/lib/pipeline/batch'

describe('scoreRawRows', () => {
  it('z-scores, composites, and ranks raw rows', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      ticker: `T${i}`, sector: 'Tech',
      xVar: i, yVar: i, zVar: i, pb: 6 - i, ps: 6 - i, eqStability: i, eqGrowth: i,
    }))
    const scored = scoreRawRows(rows)
    expect(scored).toHaveLength(6)
    expect(scored[0].rank).toBe(1)
    expect(scored[0].ticker).toBe('T5')  // best factors across the board
  })
})
```

- [ ] **Step 2: run → FAIL**

- [ ] **Step 3: implement lib/pipeline/batch.ts**
```ts
import { prisma } from '@/lib/db/ownClient'
import { fetchValuationRatios, fetchIncomeStatements } from '@/lib/fmp/fundamentals-lite'
import { computeEqGrowth, computeEqStability } from '@/lib/factors/eqDecomposition'
import { analyzeBatch } from '@/lib/taWorker/client'
import { sectorZScores, type FactorSpec } from '@/lib/factors/sectorZScore'
import { composite, rankRows } from '@/lib/factors/composite'

export interface RawRow {
  ticker: string; sector: string | null
  pb: number | null; ps: number | null; eqStability: number | null; eqGrowth: number | null
  xVar: number | null; yVar: number | null; zVar: number | null
}

const FACTORS: FactorSpec<RawRow>[] = [
  { key: 'xVar', invert: false }, { key: 'yVar', invert: false }, { key: 'zVar', invert: false },
  { key: 'pb', invert: true }, { key: 'ps', invert: true },
  { key: 'eqStability', invert: false }, { key: 'eqGrowth', invert: false },
]

export function scoreRawRows(rows: RawRow[]) {
  const z = sectorZScores(rows, FACTORS, r => r.sector)
  const scored = rows.map(r => {
    const zr = z.get(r.ticker)!
    const zRec = { zX: zr.xVar, zY: zr.yVar, zZ: zr.zVar, zPB: zr.pb, zPS: zr.ps, zEQStability: zr.eqStability, zEQGrowth: zr.eqGrowth }
    return { ...r, ...zRec, ...composite(zRec) }
  })
  return rankRows(scored)
}

export async function computeBatchRawFactors(
  slice: { ticker: string; sector: string | null }[],
  lookbackDays = 504,
): Promise<RawRow[]> {
  const tech = await analyzeBatch(slice.map(s => s.ticker), lookbackDays)
  const byTicker = new Map(tech.map(t => [t.ticker, t]))
  const out: RawRow[] = []
  for (const u of slice) {
    const t = byTicker.get(u.ticker)
    let pb: number | null = null, ps: number | null = null, eqStability: number | null = null, eqGrowth: number | null = null
    try {
      const ratios = await fetchValuationRatios(u.ticker); pb = ratios.pb; ps = ratios.ps
      const stmts = await fetchIncomeStatements(u.ticker, 6)
      const mapped = stmts.map(s => ({ revenue: s.revenue, eps: s.eps, netIncome: s.netIncome }))
      eqGrowth = computeEqGrowth(mapped, Math.max(1, mapped.length - 1))
      eqStability = computeEqStability(mapped)
    } catch { /* per-ticker failure -> nulls */ }
    out.push({ ticker: u.ticker, sector: u.sector, pb, ps, eqStability, eqGrowth, xVar: t?.xVar ?? null, yVar: t?.yVar ?? null, zVar: t?.zVar ?? null })
  }
  return out
}

export async function persistStaging(targetDate: Date, rows: RawRow[]): Promise<void> {
  await prisma.rawFactorStaging.createMany({
    data: rows.map(r => ({ runDate: targetDate, ticker: r.ticker, sector: r.sector, xVar: r.xVar, yVar: r.yVar, zVar: r.zVar, pb: r.pb, ps: r.ps, eqStability: r.eqStability, eqGrowth: r.eqGrowth })),
    skipDuplicates: true,
  })
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

export async function finalizeScreen(targetDate: Date): Promise<{ processed: number }> {
  const staged = await prisma.rawFactorStaging.findMany({ where: { runDate: targetDate } })
  const rows: RawRow[] = staged.map(s => ({
    ticker: s.ticker, sector: s.sector,
    xVar: s.xVar == null ? null : Number(s.xVar), yVar: s.yVar == null ? null : Number(s.yVar), zVar: s.zVar,
    pb: s.pb == null ? null : Number(s.pb), ps: s.ps == null ? null : Number(s.ps),
    eqStability: s.eqStability == null ? null : Number(s.eqStability), eqGrowth: s.eqGrowth == null ? null : Number(s.eqGrowth),
  }))
  const ranked = scoreRawRows(rows)
  await prisma.$transaction([
    prisma.advancedScreenResult.deleteMany({ where: { runDate: targetDate } }),
    ...chunk(ranked, 1000).map(c => prisma.advancedScreenResult.createMany({ data: c.map(r => ({
      runDate: targetDate, ticker: r.ticker, sector: r.sector,
      xVar: r.xVar, yVar: r.yVar, zVar: r.zVar, pb: r.pb, ps: r.ps, eqStability: r.eqStability, eqGrowth: r.eqGrowth,
      zX: r.zX, zY: r.zY, zZ: r.zZ, zPB: r.zPB, zPS: r.zPS, zEQStability: r.zEQStability, zEQGrowth: r.zEQGrowth,
      technicalScore: r.technicalScore, valuationScore: r.valuationScore, discoveryScore: r.discoveryScore, rank: r.rank,
    })) })),
    prisma.rawFactorStaging.deleteMany({ where: { runDate: targetDate } }),
  ])
  return { processed: ranked.length }
}
```

- [ ] **Step 4: run → PASS.**

- [ ] **Step 5: update lib/pipeline/scoreUniverse.ts** to reuse `computeBatchRawFactors` + `persistStaging` + `finalizeScreen` (keep its freshness gate + `scoreUniverse(targetDate)` signature for the CLI): gate → loadActiveUniverse → clear staging for date → loop batches (compute + persist) → finalizeScreen. Remove the now-duplicated inline scoring. `npx tsc --noEmit` clean; existing tests still green.

- [ ] **Step 6: commit**
```bash
cd UltimateMultifactor/app && npx vitest run && npx tsc --noEmit
git add UltimateMultifactor/app/lib/pipeline/batch.ts UltimateMultifactor/app/lib/pipeline/scoreUniverse.ts UltimateMultifactor/app/test/batch.test.ts
git commit -m "refactor(app): extract batch + transactional finalize from scoreUniverse"
```

---

## Task 3: Inngest run-screen function (step-per-batch)

**Files:** replace `inngest/functions.ts`.

- [ ] **Step 1: implement inngest/functions.ts**
```ts
import { inngest } from './client'
import { prisma } from '@/lib/db/ownClient'
import { otmPriceMaxDate, latestDateIsToday, loadActiveUniverse, resolveTargetDate } from '@/lib/pipeline/loadUniverse'
import { computeBatchRawFactors, persistStaging, finalizeScreen } from '@/lib/pipeline/batch'

const BATCH = 50

export const runScreen = inngest.createFunction(
  { id: 'run-screen', retries: 2 },
  [{ cron: 'TZ=America/New_York 0 3 * * *' }, { event: 'screen/run.trigger' }],
  async ({ event, step }) => {
    const targetIso = await step.run('resolve-and-gate', async () => {
      const d = resolveTargetDate((event as any)?.data?.targetDate, new Date())
      const maxDate = await otmPriceMaxDate()
      if (!maxDate || !latestDateIsToday(maxDate, d)) {
        throw new Error(`OTM price_history not fresh for ${d.toISOString().slice(0, 10)}`)
      }
      return d.toISOString()
    })
    const date = new Date(targetIso)

    const tickers = await step.run('load-universe', async () => {
      const u = await loadActiveUniverse()
      await prisma.screenerRun.upsert({
        where: { runDate: date },
        create: { runDate: date, status: 'running', totalBatches: Math.ceil(u.length / BATCH) },
        update: { status: 'running', totalBatches: Math.ceil(u.length / BATCH), completedBatches: 0, completedAt: null, errorLog: null },
      })
      await prisma.rawFactorStaging.deleteMany({ where: { runDate: date } })
      return u
    })

    for (let i = 0; i < tickers.length; i += BATCH) {
      const slice = tickers.slice(i, i + BATCH)
      await step.run(`batch-${i / BATCH}`, async () => {
        const rows = await computeBatchRawFactors(slice)
        await persistStaging(date, rows)
        await prisma.screenerRun.update({ where: { runDate: date }, data: { completedBatches: { increment: 1 } } })
      })
    }

    const result = await step.run('finalize', async () => {
      const r = await finalizeScreen(date)
      await prisma.screenerRun.update({ where: { runDate: date }, data: { status: 'complete', tickersProcessed: r.processed, completedAt: new Date() } })
      return r
    })
    return { date: targetIso, processed: result.processed }
  },
)

export const functions = [runScreen]
```

- [ ] **Step 2: typecheck + commit** (Inngest function is integration glue verified by tsc; its heavy logic is unit-tested in batch.ts)
```bash
cd UltimateMultifactor/app && npx tsc --noEmit
git add UltimateMultifactor/app/inngest/functions.ts
git commit -m "feat(app): Inngest run-screen function (step-per-batch + finalize)"
```

---

## Task 4: Admin trigger endpoint (TDD the auth guard)

**Files:** create `lib/http/adminAuth.ts`, `app/api/admin/trigger-screen/route.ts`; Test: `test/adminAuth.test.ts`.

- [ ] **Step 1: failing test**
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { isAuthorized } from '@/lib/http/adminAuth'

beforeEach(() => { process.env.ADMIN_TRIGGER_SECRET = 'sek' })

describe('isAuthorized', () => {
  it('accepts the matching bearer token', () => { expect(isAuthorized('Bearer sek')).toBe(true) })
  it('rejects a wrong or missing token', () => { expect(isAuthorized('Bearer nope')).toBe(false); expect(isAuthorized(null)).toBe(false) })
})
```

- [ ] **Step 2: run → FAIL. Implement lib/http/adminAuth.ts**
```ts
import { timingSafeEqual } from 'node:crypto'

export function isAuthorized(authHeader: string | null): boolean {
  const secret = process.env.ADMIN_TRIGGER_SECRET
  if (!secret || !authHeader) return false
  const expected = `Bearer ${secret}`
  const a = Buffer.from(authHeader), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

- [ ] **Step 3: run → PASS. Create app/api/admin/trigger-screen/route.ts**
```ts
import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/inngest/client'
import { isAuthorized } from '@/lib/http/adminAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const targetDate = req.nextUrl.searchParams.get('date') ?? undefined
  await inngest.send({ name: 'screen/run.trigger', data: { targetDate } })
  return NextResponse.json({ ok: true, triggered: targetDate ?? 'today' })
}
```

- [ ] **Step 4: typecheck + commit**
```bash
cd UltimateMultifactor/app && npx vitest run && npx tsc --noEmit
git add UltimateMultifactor/app/lib/http/adminAuth.ts UltimateMultifactor/app/app/api/admin/trigger-screen UltimateMultifactor/app/test/adminAuth.test.ts
git commit -m "feat(app): admin trigger-screen endpoint with bearer auth"
```

---

## Task 5: Discovery API (JSON + CSV) (TDD the serializer)

**Files:** create `lib/http/discoveryQuery.ts`, `app/api/discovery/route.ts`; Test: `test/discovery.test.ts`.

- [ ] **Step 1: failing test**
```ts
import { describe, it, expect } from 'vitest'
import { toCsv, parseDiscoveryParams } from '@/lib/http/discoveryQuery'

describe('toCsv', () => {
  it('emits a header and rows', () => {
    const csv = toCsv([{ rank: 1, ticker: 'AAPL', sector: 'Tech', discoveryScore: 1.23 }])
    expect(csv.split('\n')[0]).toBe('rank,ticker,sector,discoveryScore')
    expect(csv.split('\n')[1]).toBe('1,AAPL,Tech,1.23')
  })
})

describe('parseDiscoveryParams', () => {
  it('defaults limit to 100 and clamps to 1000', () => {
    expect(parseDiscoveryParams(new URLSearchParams('')).limit).toBe(100)
    expect(parseDiscoveryParams(new URLSearchParams('limit=99999')).limit).toBe(1000)
  })
  it('reads sector + format', () => {
    const p = parseDiscoveryParams(new URLSearchParams('sector=Tech&format=csv'))
    expect(p.sector).toBe('Tech'); expect(p.format).toBe('csv')
  })
})
```

- [ ] **Step 2: run → FAIL. Implement lib/http/discoveryQuery.ts**
```ts
export interface DiscoveryParams { limit: number; sector: string | null; format: 'json' | 'csv' }

export function parseDiscoveryParams(sp: URLSearchParams): DiscoveryParams {
  const rawLimit = parseInt(sp.get('limit') ?? '100', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 100
  return { limit, sector: sp.get('sector'), format: sp.get('format') === 'csv' ? 'csv' : 'json' }
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const head = cols.join(',')
  const body = rows.map(r => cols.map(c => String(r[c] ?? '')).join(',')).join('\n')
  return `${head}\n${body}`
}
```

- [ ] **Step 3: run → PASS. Create app/api/discovery/route.ts**
```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/ownClient'
import { parseDiscoveryParams, toCsv } from '@/lib/http/discoveryQuery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const p = parseDiscoveryParams(req.nextUrl.searchParams)
  const latest = await prisma.advancedScreenResult.findFirst({ orderBy: { runDate: 'desc' }, select: { runDate: true } })
  if (!latest) return NextResponse.json({ error: 'no screen results yet' }, { status: 404 })
  const rows = await prisma.advancedScreenResult.findMany({
    where: { runDate: latest.runDate, ...(p.sector ? { sector: p.sector } : {}) },
    orderBy: { rank: 'asc' },
    take: p.limit,
    select: { rank: true, ticker: true, sector: true, discoveryScore: true, technicalScore: true, valuationScore: true,
      zX: true, zY: true, zZ: true, zPB: true, zPS: true, zEQStability: true, zEQGrowth: true },
  })
  const data = rows.map(r => ({ ...r, discoveryScore: r.discoveryScore == null ? null : Number(r.discoveryScore) }))
  if (p.format === 'csv') {
    return new NextResponse(toCsv(data as any), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="discovery-${latest.runDate.toISOString().slice(0,10)}.csv"` } })
  }
  return NextResponse.json({ runDate: latest.runDate, count: data.length, results: data })
}
```

- [ ] **Step 4: typecheck + commit**
```bash
cd UltimateMultifactor/app && npx vitest run && npx tsc --noEmit
git add UltimateMultifactor/app/lib/http/discoveryQuery.ts UltimateMultifactor/app/app/api/discovery UltimateMultifactor/app/test/discovery.test.ts
git commit -m "feat(app): /api/discovery (JSON + CSV) with sector filter + limit"
```

---

## Task 6: Docs

- [ ] **Step 1: update UltimateMultifactor/app/CLAUDE.md** — add the Inngest section (`run-screen` cron 3AM ET + `screen/run.trigger` event, step-per-batch + staging table + transactional finalize), the API surface (`POST /api/admin/trigger-screen?date=`, `GET /api/discovery?sector=&limit=&format=csv`, `/api/inngest`), and the new env (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `ADMIN_TRIGGER_SECRET`).

- [ ] **Step 2: update UltimateMultifactor/CLAUDE.md** — mark Plan 3 done; note Plan 4 (UI) pending; note deploy needs Inngest app registration (serve URL `/api/inngest`) in the shared Inngest dashboard.

- [ ] **Step 3: commit**
```bash
git add UltimateMultifactor/app/CLAUDE.md UltimateMultifactor/CLAUDE.md
git commit -m "docs(app): Inngest pipeline + discovery API in CLAUDE.md"
```

---

## Self-Review

**Spec coverage:** nightly cron + freshness gate (Task 3) ✅; fits Vercel 5-min limit via step-per-batch (Task 3) ✅; transactional finalize — deferred Plan 2 atomicity fix (Task 2) ✅; manual admin trigger w/ auth (Task 4) ✅; `/api/discovery` JSON + CSV + sector filter (Task 5) ✅; reuses OTM Inngest keys, new app id (Task 1) ✅; CLAUDE.md (Task 6) ✅. UI → Plan 4.

**Placeholder scan:** none.

**Type consistency:** `RawRow` matches `raw_factor_staging` columns and `scoreRawRows` output keys (`zX..zEQGrowth`, `technicalScore/valuationScore/discoveryScore/rank`) match `advanced_screen_results` columns and `composite()` keys. `resolveTargetDate`/`latestDateIsToday`/`otmPriceMaxDate`/`loadActiveUniverse` are Plan 2 exports. `Events['screen/run.trigger']` data (`{targetDate?}`) matches the admin `inngest.send` and the function's `event.data.targetDate`.

**Known risks flagged:** ~111 steps/run is within Inngest limits but note it; `load-universe` returns ~5,530 ticker objects (under Inngest's step-output cap, page if it grows); the 3AM-ET cron assumes OTM's pipeline finished — the freshness gate is the safety net; `finalizeScreen` loads all staged rows into memory (~5,530, fine).
```
