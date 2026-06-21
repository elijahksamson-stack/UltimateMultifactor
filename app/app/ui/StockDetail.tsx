'use client'
import { useEffect, useMemo, useState } from 'react'
import { analyzeTechnicals } from '@/lib/ta/levels'
import styles from './discovery.module.css'

const s = styles as Record<string, string>

interface Bar { date: string; open: number; high: number; low: number; close: number }
interface Props { ticker: string; sector: string | null; onClose: () => void }

const VB = { w: 1060, h: 440, padL: 8, padR: 62, padT: 14, padB: 22 }

export default function StockDetail({ ticker, sector, onClose }: Props) {
  const [bars, setBars] = useState<Bar[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let live = true
    setState('loading'); setBars(null)
    fetch(`/api/price-history?ticker=${encodeURIComponent(ticker)}&days=504`)
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

  const ta = useMemo(() => {
    if (!bars || bars.length < 30) return null
    return analyzeTechnicals({
      open: bars.map(b => b.open), high: bars.map(b => b.high), low: bars.map(b => b.low), close: bars.map(b => b.close),
    })
  }, [bars])

  const geo = useMemo(() => {
    if (!bars || !ta) return null
    const n = bars.length
    const levelPrices = ta.levels.slice(0, 6).map(l => l.price)
    let lo = Math.min(...bars.map(b => b.low), ta.setup.stop, ...levelPrices)
    let hi = Math.max(...bars.map(b => b.high), ta.setup.target, ...levelPrices)
    const m = (hi - lo) * 0.04; lo -= m; hi += m
    const span = hi - lo || 1
    const cw = (VB.w - VB.padL - VB.padR) / n
    const X = (i: number) => VB.padL + (n <= 1 ? 0 : (i / (n - 1)) * (VB.w - VB.padL - VB.padR))
    const Y = (p: number) => VB.padT + ((hi - p) / span) * (VB.h - VB.padT - VB.padB)
    const f = (x: number) => x.toFixed(1)

    let wicks = '', upBody = '', dnBody = ''
    bars.forEach((b, i) => {
      const x = X(i)
      wicks += `M${f(x)},${f(Y(b.high))}L${f(x)},${f(Y(b.low))}`
      const x0 = x - cw * 0.32, x1 = x + cw * 0.32
      const yTop = Y(Math.max(b.open, b.close)), yBot = Y(Math.min(b.open, b.close))
      const h = Math.max(0.8, yBot - yTop)
      const body = `M${f(x0)},${f(yTop)}H${f(x1)}V${f(yTop + h)}H${f(x0)}Z`
      if (b.close >= b.open) upBody += body; else dnBody += body
    })
    const lineSeg = (ln: { slope: number; intercept: number }) =>
      ({ y1: Y(ln.intercept), y2: Y(ln.slope * (n - 1) + ln.intercept) })
    return {
      X, Y, wicks, upBody, dnBody,
      channel: { upper: lineSeg(ta.channel.upper), lower: lineSeg(ta.channel.lower), mid: lineSeg(ta.channel.mid) },
      srLines: ta.levels.slice(0, 6).map(l => ({ ...l, y: Y(l.price) })),
      stopY: Y(ta.setup.stop), targetY: Y(ta.setup.target), lastY: Y(ta.setup.price),
    }
  }, [bars, ta])

  const last = bars && bars.length ? bars[bars.length - 1].close : 0
  const chg = bars && bars.length ? ((last - bars[0].close) / bars[0].close) * 100 : 0
  const up = chg >= 0
  const lo = bars && bars.length ? Math.min(...bars.map(b => b.low)) : 0
  const hi = bars && bars.length ? Math.max(...bars.map(b => b.high)) : 0

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${ticker} technicals`}>
        <div className={s.modalHead}>
          <div className={s.modalTitle}>
            <span className={s.modalTicker}>{ticker}</span>
            <span className={s.modalSub}>{sector ?? '—'} · {bars?.length ?? 0} bars</span>
          </div>
          <button className={s.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {state === 'loading' && <div className={s.empty}>loading price history…</div>}
        {state === 'error' && <div className={s.error}>couldn’t load price history for {ticker}</div>}
        {state === 'ready' && !geo && <div className={s.empty}>not enough price history to chart</div>}
        {state === 'ready' && geo && ta && (
          <>
            <div className={s.statRow}>
              <div className={s.stat}><span className={s.statLabel}>last</span><span className={s.statVal}>{last.toFixed(2)}</span></div>
              <div className={s.stat}><span className={s.statLabel}>change</span><span className={s.statVal} style={{ color: up ? 'var(--pos)' : 'var(--neg)' }}>{up ? '+' : ''}{chg.toFixed(1)}%</span></div>
              <div className={s.stat}><span className={s.statLabel}>range</span><span className={s.statVal}>{lo.toFixed(2)}–{hi.toFixed(2)}</span></div>
              <div className={s.stat}><span className={s.statLabel}>trend</span><span className={s.statVal} style={{ color: ta.channel.rising ? 'var(--pos)' : 'var(--neg)' }}>{ta.channel.rising ? '↗ up' : '↘ down'}</span></div>
            </div>

            <svg className={s.chart} viewBox={`0 0 ${VB.w} ${VB.h}`} preserveAspectRatio="none" role="img" aria-label={`${ticker} candlesticks with support/resistance, trend channel, and trade setup`}>
              <line x1={geo.X(0)} y1={geo.channel.lower.y1} x2={geo.X(ta.n - 1)} y2={geo.channel.lower.y2} className={s.chLine} />
              <line x1={geo.X(0)} y1={geo.channel.upper.y1} x2={geo.X(ta.n - 1)} y2={geo.channel.upper.y2} className={s.chLine} />
              <line x1={geo.X(0)} y1={geo.channel.mid.y1} x2={geo.X(ta.n - 1)} y2={geo.channel.mid.y2} className={s.chMid} />
              {geo.srLines.map((l, i) => (
                <g key={i}>
                  <line x1={VB.padL} y1={l.y} x2={VB.w - VB.padR} y2={l.y} className={l.type === 'support' ? s.srSupport : s.srResist} />
                  <text x={VB.w - VB.padR + 4} y={l.y + 3} className={s.axisLabel}>{l.price.toFixed(2)}</text>
                </g>
              ))}
              <path d={geo.wicks} className={s.wick} />
              <path d={geo.upBody} className={s.candleUp} />
              <path d={geo.dnBody} className={s.candleDn} />
              <line x1={VB.padL} y1={geo.stopY} x2={VB.w - VB.padR} y2={geo.stopY} className={s.stopLine} />
              <line x1={VB.padL} y1={geo.targetY} x2={VB.w - VB.padR} y2={geo.targetY} className={s.targetLine} />
              <text x={VB.w - VB.padR + 4} y={geo.stopY + 3} className={s.stopLabel}>{ta.setup.stop.toFixed(2)}</text>
              <text x={VB.w - VB.padR + 4} y={geo.targetY + 3} className={s.targetLabel}>{ta.setup.target.toFixed(2)}</text>
            </svg>
            <div className={s.legend}>
              <span><i className={s.swCandle} /> candles</span>
              <span><i className={s.swChannel} /> trend channel</span>
              <span><i className={s.swResist} /> resistance</span>
              <span><i className={s.swSupport} /> support</span>
              <span><i className={s.swTarget} /> target / <i className={s.swStop} /> stop</span>
            </div>

            <div className={s.setup}>
              <div className={s.setupItem}><span className={s.setupLabel}>R / R</span><span className={s.setupVal} style={{ color: ta.setup.rr >= 2 ? 'var(--pos)' : 'var(--text)' }}>{ta.setup.rr.toFixed(2)}×</span></div>
              <div className={s.setupItem}><span className={s.setupLabel}>stop</span><span className={s.setupVal} style={{ color: 'var(--neg)' }}>{ta.setup.stop.toFixed(2)}</span></div>
              <div className={s.setupItem}><span className={s.setupLabel}>target</span><span className={s.setupVal} style={{ color: 'var(--pos)' }}>{ta.setup.target.toFixed(2)}</span></div>
              <div className={s.setupItem}><span className={s.setupLabel}>risk</span><span className={s.setupVal}>{ta.setup.riskPct.toFixed(1)}%</span></div>
              <div className={s.setupItem}><span className={s.setupLabel}>reward</span><span className={s.setupVal}>{ta.setup.rewardPct.toFixed(1)}%</span></div>
            </div>

            <div className={s.clustersHead}>convergence clusters · {ta.levels.length} levels</div>
            <div className={s.clusters}>
              {ta.levels.slice(0, 8).map((l, i) => (
                <div key={i} className={s.clusterRow}>
                  <span className={s.dots}>{[0, 1, 2, 3, 4].map(d => <i key={d} className={d < l.strength ? s.dotOn : s.dot} />)}</span>
                  <span className={s.clPrice}>{l.price.toFixed(2)}</span>
                  <span className={l.type === 'support' ? s.clTagS : s.clTagR}>{l.type}</span>
                  <span className={s.clDist} style={{ color: l.distPct >= 0 ? 'var(--muted)' : 'var(--neg)' }}>{l.distPct >= 0 ? '+' : ''}{l.distPct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
