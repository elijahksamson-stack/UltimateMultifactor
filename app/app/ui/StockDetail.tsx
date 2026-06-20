'use client'
import { useEffect, useState } from 'react'
import { buildChart } from '@/lib/ui/sparkline'
import styles from './discovery.module.css'

const s = styles as Record<string, string>

interface Bar { date: string; close: number; high: number; low: number }
interface Props { ticker: string; sector: string | null; onClose: () => void }

export default function StockDetail({ ticker, sector, onClose }: Props) {
  const [bars, setBars] = useState<Bar[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let live = true
    setState('loading'); setBars(null)
    fetch(`/api/price-history?ticker=${encodeURIComponent(ticker)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (live) { setBars(d.bars ?? []); setState('ready') } })
      .catch(() => { if (live) setState('error') })
    return () => { live = false }
  }, [ticker])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const closes = bars?.map(b => b.close) ?? []
  const geo = closes.length >= 2 ? buildChart(closes, 660, 200) : null
  const last = closes[closes.length - 1]
  const chg = closes[0] ? ((last - closes[0]) / closes[0]) * 100 : 0
  const up = chg >= 0

  return (
    <div className={s.overlay} onClick={onClose}>
      <aside className={s.drawer} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${ticker} price history`}>
        <div className={s.drawerHead}>
          <div className={s.drawerTitle}>
            <span className={s.drawerTicker}>{ticker}</span>
            <span className={s.drawerSub}>{sector ?? '—'} · {bars?.length ?? 0}d close</span>
          </div>
          <button className={s.closeBtn} onClick={onClose} aria-label="Close detail">✕</button>
        </div>

        {state === 'loading' && <div className={s.empty}>loading price history…</div>}
        {state === 'error' && <div className={s.error}>couldn’t load price history for {ticker}</div>}
        {state === 'ready' && !geo && <div className={s.empty}>not enough price history to chart</div>}
        {state === 'ready' && geo && (
          <>
            <div className={s.statRow}>
              <div className={s.stat}><span className={s.statLabel}>last</span><span className={s.statVal}>{last.toFixed(2)}</span></div>
              <div className={s.stat}><span className={s.statLabel}>change</span><span className={s.statVal} style={{ color: up ? 'var(--pos)' : 'var(--neg)' }}>{up ? '+' : ''}{chg.toFixed(1)}%</span></div>
              <div className={s.stat}><span className={s.statLabel}>range</span><span className={s.statVal}>{geo.min.toFixed(2)}–{geo.max.toFixed(2)}</span></div>
              <div className={s.stat}><span className={s.statLabel}>since</span><span className={s.statVal}>{bars![0].date}</span></div>
            </div>
            <svg className={s.spark} viewBox={`0 0 ${geo.width} ${geo.height}`} preserveAspectRatio="none"
              role="img" aria-label={`${ticker} close price with regression centerline and ±1σ dispersion channel`}>
              <path d={geo.band} className={s.sparkBand} />
              <path d={geo.trend} className={s.sparkTrend} />
              <path d={geo.line} className={s.sparkLine} />
            </svg>
            <div className={s.legend}>
              <span><i className={s.swLine} /> close</span>
              <span><i className={s.swTrend} /> centerline</span>
              <span><i className={s.swBand} /> ±1σ dispersion (≈ X&nbsp;Var)</span>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
