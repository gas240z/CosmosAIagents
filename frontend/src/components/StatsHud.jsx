import { useEffect, useState } from 'react'
import { Cpu, Files, ListChecks, Timer, Wrench } from 'lucide-react'
import { ORDER } from '../agents'

const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }

export default function StatsHud({ state }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!state.running) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [state.running])
  if (!state.runId) return null
  const act = ORDER.filter((id) => ['thinking', 'writing'].includes(state.agents[id].status)).length
  const done = state.tasks.filter((t) => state.taskState[t.id]?.status === 'done').length
  const files = state.files.filter((f) => f.state === 'done').length
  const calls = Object.values(state.tools || {}).reduce((n, a) => n + Object.values(a).reduce((m, x) => m + x.count, 0), 0)
  const el = (state.ended || now) - (state.started || now)
  const Item = ({ icon: Ic, v, l, c }) => (
    <div className="flex items-center gap-2 px-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: `${c}22`, border: `1px solid ${c}66`, color: c }}><Ic size={14} /></span>
      <div className="leading-tight"><div className="font-display text-[13px] font-bold tabular-nums">{v}</div><div className="text-[9px] uppercase tracking-wider text-slate-400">{l}</div></div>
    </div>
  )
  return (
    <div className="glass pointer-events-none absolute left-3 top-3 z-20 hidden items-center divide-x divide-white/10 py-1.5 sm:flex">
      <Item icon={Cpu} v={`${act}/4`} l="агентов" c="#2fe3a1" />
      <Item icon={ListChecks} v={`${done}/${state.tasks.length || 0}`} l="задач" c="#7a8bff" />
      <Item icon={Files} v={files} l="файлов" c="#ff8a1f" />
      <Item icon={Wrench} v={calls} l="вызовов" c="#38d7ff" />
      <Item icon={Timer} v={fmt(el)} l="время" c="#ff5fb0" />
    </div>
  )
}
