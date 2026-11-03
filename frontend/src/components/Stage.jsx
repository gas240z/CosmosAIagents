import { useEffect, useRef, useState } from 'react'
import { AGENTS, ORDER, TOOLS, useTheme } from '../agents'
import { StageEngine } from '../engine'
import { prefersReduced } from '../reducedMotion'
import Planet from './Planet'
import Core from './Core'
import ToolSat from './ToolSat'

export default function Stage({ agents, core, orch, bus, selected, onSelect, tools }) {
  const wrap = useRef(null), back = useRef(null), fx = useRef(null)
  const engine = useRef(null)
  const nodes = useRef({})
  const [R, setR] = useState(34)
  const reduced = prefersReduced()
  const { light } = useTheme()

  const reg = (id) => (el) => {
    nodes.current[id] = el
    engine.current?.register(id, el)
  }

  useEffect(() => {
    const colors = Object.fromEntries(ORDER.map((id) => [id, AGENTS[id].color]))
    const e = new StageEngine({ back: back.current, fx: fx.current, colors, tools: TOOLS.map(({ id, color }) => ({ id, color })) })
    engine.current = e
    for (const id in nodes.current) e.register(id, nodes.current[id])
    e.setLight(light)
    const fit = () => {
      const r = wrap.current.getBoundingClientRect()
      e.resize(Math.max(280, r.width), Math.max(300, r.height), Math.min(window.devicePixelRatio || 1, 2))
      setR(e.R)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(wrap.current)
    const off = bus.subscribe((ev) => {
      if (ev.type === 'ship') e.ship(ev.kind, ev.frm, ev.to)
      else if (ev.type === 'done') e.supernova()
      else if (ev.type === 'tool') e.toolCall(ev.agent, ev.tool, ev.ok)
    })
    return () => { off(); ro.disconnect(); e.destroy() }
  }, [bus])

  useEffect(() => { engine.current?.setLight(light) }, [light])

  useEffect(() => {
    const e = engine.current
    if (!e) return
    for (const id of ORDER) e.setStatus(id, agents[id].available ? agents[id].status : 'offline')
  }, [agents])

  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden">
      <canvas ref={back} className="absolute inset-0" aria-hidden="true" />
      <Core ref={reg('core')} R={R} state={core.state} label={core.label} model={orch?.model} reduced={reduced} />
      {ORDER.map((id) => (
        <Planet key={id} ref={reg(id)} id={id} a={agents[id]} R={R} selected={selected === id} onSelect={onSelect} reduced={reduced} />
      ))}
      {ORDER.map((id) => agents[id].available && TOOLS.map((t) => (
        <ToolSat key={`${id}:${t.id}`} ref={reg(`tool:${id}:${t.id}`)} tool={t} R={R} info={tools?.[id]?.[t.id]}
          active={['thinking', 'writing'].includes(agents[id].status)} light={light} reduced={reduced} />
      )))}
      <canvas ref={fx} className="pointer-events-none absolute inset-0 z-30" aria-hidden="true" />
    </div>
  )
}
