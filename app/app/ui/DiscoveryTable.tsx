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
