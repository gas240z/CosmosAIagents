import { memo, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Check, Star, X } from 'lucide-react'
import { ACTORS, PHASES, STATION_ICONS, useTheme } from '../agents'

const order = PHASES.map((p) => p.id)

function TaskStar({ t, st }) {
  const c = ACTORS[st?.agent || t.agent]?.color || '#9fb0e8'
  const s = st?.status || 'pending'
  return (
    <div className="w-[124px] rounded-lg px-2 py-1.5" style={{ background: 'var(--card-bg)', border: `1px solid ${s === 'pending' ? 'rgba(140,160,255,.18)' : c + '88'}`, boxShadow: s === 'running' ? `0 0 14px ${c}55` : 'none' }} title={`${t.title} → ${ACTORS[st?.agent || t.agent]?.name}`}>
      <div className="flex items-center gap-1.5 text-[10.5px]">
        {s === 'done' ? <Check size={12} color="#2fe3a1" strokeWidth={3} /> : s === 'failed' ? <X size={12} color="#ff3b4d" strokeWidth={3} /> :
          <Star size={12} color={c} fill={s === 'running' ? c : 'none'} />}
        <span className="truncate text-slate-100">{t.title}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
        {s === 'running' ? <div className="shimmer-bar h-full w-full rounded-full" style={{ backgroundColor: c + '55' }} /> :
          <motion.div className="h-full rounded-full" initial={false} animate={{ width: s === 'done' ? '100%' : s === 'failed' ? '100%' : '0%' }} transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            style={{ background: s === 'failed' ? '#ff3b4d' : `linear-gradient(90deg, ${c}, #fff)` }} />}
      </div>
    </div>
  )
}

function Timeline({ tasks, taskState, phase, running, done }) {
  const { light } = useTheme()
  const waves = useMemo(() => {
    const m = {}
    tasks.forEach((t) => { (m[t.level] ??= []).push(t) })
    return Object.keys(m).map(Number).sort((a, b) => a - b).map((l) => ({ level: l, items: m[l] }))
  }, [tasks])
  const total = tasks.length
  const doneN = tasks.filter((t) => taskState[t.id]?.status === 'done' || taskState[t.id]?.status === 'failed').length
  const pi = done ? 99 : order.indexOf(phase)
  const pre = Math.max(0, Math.min(1, (pi >= 0 ? pi : 0) / 2))
  const pct = done ? 100 : Math.round(((total ? (doneN / total) * 70 : 0) + (pi >= 3 ? 15 : 0) + (pi >= 4 ? 15 : 0) + (pi >= 0 && pi < 2 ? pi * 6 : total ? 12 : 0)))
  const station = (key, label, on, cur, kind = 'wave') => {
    const Ic = STATION_ICONS[kind]
    return (
    <div key={key} className="flex w-[84px] shrink-0 flex-col items-center gap-1 pt-1">
      <motion.span animate={cur ? { scale: [1, 1.35, 1] } : { scale: 1 }} transition={{ duration: 1.4, repeat: cur ? Infinity : 0 }}
        className="grid h-6 w-6 place-items-center rounded-full" style={{ background: on ? 'radial-gradient(circle,#fff,#a9c0ff 60%,#7a5bff)' : 'rgba(140,160,255,.15)', boxShadow: on ? '0 0 16px #8fa8ff' : 'none' }}>
        <Ic size={11} color={on ? '#1a1060' : '#6e7bb8'} strokeWidth={2.4} />
      </motion.span>
      <span className="font-display text-[9px] uppercase tracking-[.16em]" style={{ color: on ? (light ? '#2b3180' : '#cfe0ff') : '#6e7bb8' }}>{label}</span>
    </div>
    )
  }
  const link = (key, fill) => (
    <div key={key} className="mt-[18px] h-[3px] w-5 shrink-0 self-start overflow-hidden rounded-full bg-white/10 sm:w-8">
      <motion.div className="h-full" initial={false} animate={{ width: `${fill * 100}%` }} transition={{ type: 'spring', stiffness: 90, damping: 20 }}
        style={{ background: 'linear-gradient(90deg,#4fa8ff,#a54bff,#ff5fb0)' }} />
    </div>
  )
  return (
    <section className="glass px-4 py-3" aria-label="Таймлайн миссии">
      <div className="mb-2 flex items-center gap-3 text-[11px] uppercase tracking-[.18em] text-sky-200/80">
        <span className="font-display">Маршрут миссии</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <motion.div className="h-full rounded-full" initial={false} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 70, damping: 18 }}
            style={{ background: 'linear-gradient(90deg,#4fa8ff,#a54bff,#ff5fb0,#ffd98a)', boxShadow: '0 0 12px #a54bff' }} />
        </div>
        <span className="font-display tabular-nums text-white">{pct}%</span>
      </div>
      <div className="flex items-start overflow-x-auto pb-2">
        {station('s0', 'Старт', true, false, 'start')}
        {link('l0', pi >= 0 || running ? 1 : 0)}
        {station('s1', 'Контракт', pi >= 0, phase === 'contract', 'contract')}
        {link('l1', pi >= 1 ? 1 : 0)}
        {station('s2', 'План', pi >= 1, phase === 'plan', 'plan')}
        {waves.map((w, i) => {
          const wd = w.items.filter((t) => ['done', 'failed'].includes(taskState[t.id]?.status)).length / w.items.length
          const started = w.items.some((t) => taskState[t.id]?.status && taskState[t.id].status !== 'pending')
          return [link('lw' + i, pi >= 2 ? (started ? 0.35 + wd * 0.65 : 0) : 0),
            <div key={'w' + i} className="flex shrink-0 flex-col items-center gap-1.5">
              {station('ws' + i, `Волна ${w.level}`, started || wd === 1, started && wd < 1)}
              <div className="flex flex-col gap-1.5">{w.items.map((t) => <TaskStar key={t.id} t={t} st={taskState[t.id]} />)}</div>
            </div>]
        })}
        {link('l3', pi >= 3 ? 1 : 0)}
        {station('s3', 'Ревью', pi >= 3, phase === 'review', 'review')}
        {link('l4', pi >= 4 ? 1 : 0)}
        {station('s4', 'Упаковка', pi >= 4, phase === 'package', 'package')}
        {link('l5', done ? 1 : 0)}
        {station('s5', 'Финиш', !!done, false, 'finish')}
      </div>
    </section>
  )
}
export default memo(Timeline)
