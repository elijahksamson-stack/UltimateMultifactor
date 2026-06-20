export interface DiscoveryParams { limit: number; sector: string | null; format: 'json' | 'csv' }

export function parseDiscoveryParams(sp: URLSearchParams): DiscoveryParams {
  const rawLimit = parseInt(sp.get('limit') ?? '100', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 100
  return { limit, sector: sp.get('sector'), format: sp.get('format') === 'csv' ? 'csv' : 'json' }
}

function escapeCsv(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `\t${v}` : v
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const head = cols.join(',')
  const body = rows.map(r => cols.map(c => escapeCsv(String(r[c] ?? ''))).join(',')).join('\n')
  return `${head}\n${body}`
}
