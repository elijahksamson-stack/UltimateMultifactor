'use client'
import { useEffect, useMemo, useState } from 'react'
import { formatScore, formatRatio, formatMarketCap, compareBy } from '@/lib/ui/format'
import { heatBg, rangeOf, type Range } from '@/lib/ui/gradient'
import StockDetail from './StockDetail'
import styles from './discovery.module.css'

const s = styles as Record<string, string>

interface Row {
  rank: number; ticker: string; sector: string | null
  discoveryScore: number | null; technicalScore: number | null; valuationScore: number | null
  pb: number | null; ps: number | null; marketCap: number | null; zMarketCap: number | null
  zX: number | null; zY: number | null; zZ: number | null
  zPB: number | null; zPS: number | null; zEQStability: number | null; zEQGrowth: number | null
}

// Factor columns. `z` = show the z-score, colour by it. `ratio` = show the raw
// ratio ("0.0x"), colour by its z-score (sector-relative strength).
type Col =
  | { kind: 'z'; key: keyof Row; label: string }
  | { kind: 'ratio'; rawKey: keyof Row; zKey: keyof Row; label: string }
const FACTOR_COLS: Col[] = [
  { kind: 'z', key: 'zX', label: 'X' }, { kind: 'z', key: 'zY', label: 'Y' }, { kind: 'z', key: 'zZ', label: 'Z' },
  { kind: 'ratio', rawKey: 'pb', zKey: 'zPB', label: 'P/B' }, { kind: 'ratio', rawKey: 'ps', zKey: 'zPS', label: 'P/S' },
  { kind: 'z', key: 'zEQStability', label: 'EQ·STB' }, { kind: 'z', key: 'zEQGrowth', label: 'EQ·GRW' },
]
// Keys whose values drive a gradient (per-column normalized across visible rows).
const GRADIENT_KEYS: (keyof Row)[] = [
  'discoveryScore', 'technicalScore', 'valuationScore', 'zMarketCap',
  'zX', 'zY', 'zZ', 'zPB', 'zPS', 'zEQStability', 'zEQGrowth',
]

export default function DiscoveryTable() {
  const [rows, setRows] = useState<Row[]>([])
  const [runDate, setRunDate] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  const [sector, setSector] = useState<string>('all')
  const [sortKey, setSortKey] = useState<keyof Row>('rank')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const [selected, setSelected] = useState<{ ticker: string; sector: string | null } | null>(null)

  useEffect(() => {
    let live = true
    setState('loading')
    fetch('/api/discovery?limit=500')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (!live) return; setRows(d.results ?? []); setRunDate(d.runDate ?? null); setState((d.results?.length ?? 0) ? 'ready' : 'empty') })
      .catch(() => { if (live) setState('error') })
    return () => { live = false }
  }, [])

  const sectors = useMemo(() => ['all', ...Array.from(new Set(rows.map(r => r.sector).filter((x): x is string => !!x)))], [rows])
  const view = useMemo(() => {
    const filtered = sector === 'all' ? rows : rows.filter(r => r.sector === sector)
    return [...filtered].sort(compareBy<Row>(sortKey, dir))
  }, [rows, sector, sortKey, dir])

  // Per-column min/max across the visible rows, so each gradient scales to what's on screen.
  const ranges = useMemo(() => {
    const m: Record<string, Range> = {}
    for (const k of GRADIENT_KEYS) m[k] = rangeOf(view.map(r => r[k] as number | null))
    return m
  }, [view])

  const onSort = (key: keyof Row) => {
    if (key === sortKey) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setDir(key === 'rank' || key === 'ticker' ? 'asc' : 'desc') }
  }
  const caret = (key: keyof Row) => (sortKey === key ? <span className={s.caret}>{dir === 'asc' ? '↑' : '↓'}</span> : null)

  // cell that shows `display` text, coloured by the gradient on `gradKey`
  const cell = (r: Row, gradKey: keyof Row, display: string, k: string) => (
    <td key={k} style={{ background: heatBg(r[gradKey] as number | null, ranges[gradKey as string]) }}>{display}</td>
  )

  return (
    <div className={s.wrap}>
      <div className={s.header}>
        <div className={s.title}><b>ultimatemultifactor</b> · discovery</div>
        <div className={s.meta}><a href="/dashboard" className={s.navLink}>dashboard →</a>{runDate ? `run ${String(runDate).slice(0, 10)} · ${rows.length} names` : ''}</div>
      </div>

      <div className={s.controls}>
        <select className={s.select} value={sector} onChange={e => setSector(e.target.value)} aria-label="sector filter">
          {sectors.map(sec => <option key={sec} value={sec}>{sec === 'all' ? 'all sectors' : sec}</option>)}
        </select>
        <a className={s.download} href={`/api/discovery?format=csv${sector !== 'all' ? `&sector=${encodeURIComponent(sector)}` : ''}&limit=1000`}>↓ csv</a>
        <span className={s.hint}>click a row for price history</span>
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
                <th onClick={() => onSort('marketCap')}>mkt cap{caret('marketCap')}</th>
                <th onClick={() => onSort('discoveryScore')}>score{caret('discoveryScore')}</th>
                <th onClick={() => onSort('technicalScore')}>tech{caret('technicalScore')}</th>
                <th onClick={() => onSort('valuationScore')}>val{caret('valuationScore')}</th>
                {FACTOR_COLS.map(c => {
                  const sortK = c.kind === 'z' ? c.key : c.rawKey
                  return <th key={c.label} onClick={() => onSort(sortK)}>{c.label}{caret(sortK)}</th>
                })}
              </tr>
            </thead>
            <tbody>
              {view.map(r => (
                <tr key={r.ticker} className={s.clickRow} onClick={() => setSelected({ ticker: r.ticker, sector: r.sector })}>
                  <td className={`${s.left} ${r.rank === 1 ? s.rankTop : s.rank}`}>{r.rank}</td>
                  <td className={`${s.left} ${s.ticker}`}>{r.ticker}</td>
                  <td className={`${s.left} ${s.sector}`}>{r.sector ?? '—'}</td>
                  {cell(r, 'zMarketCap', formatMarketCap(r.marketCap), 'mcap')}
                  {cell(r, 'discoveryScore', formatScore(r.discoveryScore), 'disc')}
                  {cell(r, 'technicalScore', formatScore(r.technicalScore), 'tech')}
                  {cell(r, 'valuationScore', formatScore(r.valuationScore), 'val')}
                  {FACTOR_COLS.map(c => c.kind === 'z'
                    ? cell(r, c.key, formatScore(r[c.key] as number | null), String(c.key))
                    : cell(r, c.zKey, formatRatio(r[c.rawKey] as number | null), String(c.rawKey)))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <StockDetail ticker={selected.ticker} sector={selected.sector} onClose={() => setSelected(null)} />}
    </div>
  )
}
