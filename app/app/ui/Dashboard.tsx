'use client'
import { useEffect, useMemo, useState } from 'react'
import { donut } from '@/lib/ui/donut'
import { buyPoint, type BuyPoint } from '@/lib/ui/buyPoint'
import { buildChart } from '@/lib/ui/sparkline'
import styles from './dashboard.module.css'

const s = styles as Record<string, string>

interface Row { rank: number; ticker: string; sector: string | null; discoveryScore: number | null }
const GICS_SECTORS = 11

export default function Dashboard() {
  const [rows, setRows] = useState<Row[]>([])
  const [runDate, setRunDate] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')

  useEffect(() => {
    let live = true
    fetch('/api/discovery?limit=1000')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (!live) return; setRows(d.results ?? []); setRunDate(d.runDate ?? null); setState((d.results?.length ?? 0) ? 'ready' : 'empty') })
      .catch(() => { if (live) setState('error') })
    return () => { live = false }
  }, [])

  const sectors = useMemo(() => {
    const m = new Map<string, { count: number; sumDisc: number }>()
    for (const r of rows) {
      const sec = r.sector ?? '—'
      const e = m.get(sec) ?? { count: 0, sumDisc: 0 }
      e.count += 1; e.sumDisc += r.discoveryScore ?? 0; m.set(sec, e)
    }
    const total = rows.length || 1
    return [...m.entries()]
      .map(([sector, e]) => ({ sector, count: e.count, pct: (e.count / total) * 100, avgDisc: e.sumDisc / e.count }))
      .sort((a, b) => b.count - a.count)
  }, [rows])

  const ring = useMemo(() => donut(sectors.map(x => ({ label: x.sector, value: x.count }))), [sectors])

  const stats = useMemo(() => {
    const n = rows.length
    const avgDisc = n ? rows.reduce((a, r) => a + (r.discoveryScore ?? 0), 0) / n : 0
    const hhi = sectors.reduce((a, x) => a + (x.count / (n || 1)) ** 2, 0)
    const effectiveSectors = hhi ? 1 / hhi : 0 // breadth: how many sectors really carry the list
    return { n, avgDisc, top: sectors[0], represented: sectors.length, effectiveSectors }
  }, [rows, sectors])

  const top = useMemo(() => [...rows].sort((a, b) => (b.discoveryScore ?? -Infinity) - (a.discoveryScore ?? -Infinity)).slice(0, 6), [rows])

  return (
    <div className={s.wrap}>
      <div className={s.header}>
        <div className={s.title}><b>ultimatemultifactor</b> · dashboard</div>
        <div className={s.nav}>
          <a href="/">← discovery</a>
          <span className={s.meta}>{runDate ? `run ${String(runDate).slice(0, 10)} · ${rows.length} names` : ''}</span>
        </div>
      </div>

      {state === 'loading' && <div className={s.empty}>loading…</div>}
      {state === 'error' && <div className={s.error}>failed to load results</div>}
      {state === 'empty' && <div className={s.empty}>no completed screen yet</div>}
      {state === 'ready' && (
        <>
          <div className={s.kpis}>
            <Kpi label="names" value={String(stats.n)} />
            <Kpi label="sectors" value={`${stats.represented} / ${GICS_SECTORS}`} sub="represented" />
            <Kpi label="breadth" value={stats.effectiveSectors.toFixed(1)} sub="effective sectors" />
            <Kpi label="top sector" value={stats.top?.sector ?? '—'} sub={stats.top ? `${stats.top.pct.toFixed(0)}% of list` : ''} />
            <Kpi label="avg score" value={stats.avgDisc.toFixed(2)} />
          </div>

          <div className={s.section}>opportunities by sector</div>
          <div className={s.breakdown}>
            <div className={s.donutWrap}>
              <svg viewBox={`0 0 ${ring.cx * 2} ${ring.cy * 2}`} className={s.donut} role="img" aria-label="result count by sector">
                {ring.slices.map(sl => <path key={sl.label} d={sl.path} fill={sl.shade} stroke="var(--bg)" strokeWidth={1.5} />)}
                <text x={ring.cx} y={ring.cy - 4} className={s.donutCenter} textAnchor="middle">{stats.n}</text>
                <text x={ring.cx} y={ring.cy + 12} className={s.donutCenterSub} textAnchor="middle">names</text>
              </svg>
            </div>
            <table className={s.sectorTable}>
              <thead><tr><th className={s.left}>sector</th><th>names</th><th>%</th><th>avg score</th></tr></thead>
              <tbody>
                {sectors.map(x => (
                  <tr key={x.sector}>
                    <td className={s.left}><span className={s.swatch} style={{ background: ring.slices.find(sl => sl.label === x.sector)?.shade }} />{x.sector}</td>
                    <td>{x.count}</td>
                    <td>{x.pct.toFixed(1)}</td>
                    <td>{x.avgDisc.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={s.section}>top standouts · price &amp; buy-point</div>
          <div className={s.demos}>
            {top.map(r => <TechCard key={r.ticker} ticker={r.ticker} sector={r.sector} score={r.discoveryScore} />)}
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={s.kpi}>
      <div className={s.kpiLabel}>{label}</div>
      <div className={s.kpiValue}>{value}</div>
      {sub && <div className={s.kpiSub}>{sub}</div>}
    </div>
  )
}

function TechCard({ ticker, sector, score }: { ticker: string; sector: string | null; score: number | null }) {
  const [closes, setCloses] = useState<number[] | null>(null)
  const [st, setSt] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    let live = true
    fetch(`/api/price-history?ticker=${encodeURIComponent(ticker)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (live) { setCloses((d.bars ?? []).map((b: { close: number }) => b.close)); setSt('ready') } })
      .catch(() => { if (live) setSt('error') })
    return () => { live = false }
  }, [ticker])

  const geo = closes && closes.length >= 2 ? buildChart(closes, 320, 96, 6) : null
  const bp: BuyPoint | null = closes && closes.length >= 2 ? buyPoint(closes) : null

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div><span className={s.cardTicker}>{ticker}</span> <span className={s.cardSector}>{sector ?? '—'}</span></div>
        <div className={s.cardScore}>{score == null ? '—' : score.toFixed(2)}</div>
      </div>
      {st === 'error' && <div className={s.cardEmpty}>no price data</div>}
      {st === 'loading' && <div className={s.cardEmpty}>loading…</div>}
      {st === 'ready' && !geo && <div className={s.cardEmpty}>not enough history</div>}
      {st === 'ready' && geo && bp && (
        <>
          <svg viewBox={`0 0 ${geo.width} ${geo.height}`} preserveAspectRatio="none" className={s.cardSpark} role="img" aria-label={`${ticker} price with trend channel`}>
            <path d={geo.band} className={s.sparkBand} />
            <path d={geo.trend} className={s.sparkTrend} />
            <path d={geo.line} className={s.sparkLine} />
          </svg>
          <div className={s.buyRow}>
            <span className={`${s.buyLabel} ${s[`buy_${bp.label.replace(' ', '_')}`]}`}>{bp.label}</span>
            <div className={s.buyBar}><span style={{ width: `${bp.strength}%` }} /></div>
            <span className={s.buyStrength}>{bp.strength}</span>
          </div>
          <div className={s.cardStats}>
            <span>{bp.trendUp ? '↗' : '↘'} {bp.trendPctPerMo >= 0 ? '+' : ''}{bp.trendPctPerMo.toFixed(1)}%/mo</span>
            <span>{bp.channelPos >= 0 ? '+' : ''}{bp.channelPos.toFixed(1)}σ vs trend</span>
            <span>−{bp.pctFromHigh.toFixed(0)}% off high</span>
          </div>
        </>
      )}
    </div>
  )
}
