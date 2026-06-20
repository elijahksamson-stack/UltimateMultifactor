import { WEIGHTS } from '@/lib/config/weights'

type ZRec = Record<string, number | null>
const mean = (vals: (number | null)[]): number | null => {
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
