import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { ORDER } from './agents'

const mkAgents = () => Object.fromEntries(ORDER.map((id) => [id, { status: 'idle', statusAt: 0, model: '', available: true, done: 0, flashAt: 0, task: null, title: '' }]))

export const initial = () => ({
  runId: null, prompt: '', running: false, phase: null, phaseLabel: '', fatal: null,
  core: { state: 'idle', label: '' }, orch: null, agents: mkAgents(),
  contract: null, tasks: [], taskState: {}, files: [], streams: {}, logs: [], review: null, done: null, started: 0, ended: 0, tools: {}, toolLog: [], chat: null, remembered: [],
})

const cap = (s) => (s.length > 24000 ? s.slice(-24000) : s)

function reduce(s, ev) {
  switch (ev.type) {
    case 'reset': return initial()
    case 'begin': return { ...initial(), runId: ev.runId, prompt: ev.prompt, running: true, started: Date.now() }
    case 'run_started': {
      const agents = { ...s.agents }
      for (const id of ORDER) {
        const i = ev.agents[id]
        agents[id] = { ...agents[id], model: i?.model || '', available: !!i?.available }
      }
      return { ...s, agents, orch: ev.orchestrator, prompt: ev.prompt || s.prompt, running: true }
    }
    case 'phase': return { ...s, phase: ev.phase, phaseLabel: ev.label }
    case 'core_status': return { ...s, core: { state: ev.state, label: ev.label || '' } }
    case 'contract': return { ...s, contract: ev.contract }
    case 'plan': return { ...s, tasks: ev.tasks, taskState: Object.fromEntries(ev.tasks.map((t) => [t.id, { status: 'pending', agent: t.agent }])) }
    case 'tasks_added': return {
      ...s, tasks: [...s.tasks, ...ev.tasks],
      taskState: { ...s.taskState, ...Object.fromEntries(ev.tasks.map((t) => [t.id, { status: 'pending', agent: t.agent }])) },
    }
    case 'task_status': return { ...s, taskState: { ...s.taskState, [ev.task_id]: { status: ev.status, agent: ev.agent, reason: ev.reason } } }
    case 'agent_status': {
      const a = s.agents[ev.agent]
      if (!a) return s
      return { ...s, agents: { ...s.agents, [ev.agent]: { ...a, status: ev.status, statusAt: Date.now(), task: ev.task_id || a.task, title: ev.title || a.title, done: a.done + (ev.status === 'done' ? 1 : 0) } } }
    }
    case 'agent_settle': {
      const a = s.agents[ev.agent]
      if (!a || a.statusAt !== ev.statusAt || (a.status !== 'done' && a.status !== 'error')) return s
      return { ...s, agents: { ...s.agents, [ev.agent]: { ...a, status: 'idle' } } }
    }
    case 'ship': {
      const a = s.agents[ev.frm]
      if (!a || ev.kind === 'dispatch') return s
      return { ...s, agents: { ...s.agents, [ev.frm]: { ...a, flashAt: Date.now() } } }
    }
    case 'file': {
      const i = s.files.findIndex((f) => f.path === ev.path)
      const rec = { path: ev.path, state: ev.state, size: ev.size ?? s.files[i]?.size ?? 0, agent: ev.agent, task_id: ev.task_id }
      const files = i === -1 ? [...s.files, rec] : s.files.map((f, k) => (k === i ? { ...f, ...rec } : f))
      return { ...s, files }
    }
    case 'stream_batch': {
      const streams = { ...s.streams }
      for (const [k, v] of Object.entries(ev.batch)) streams[k] = cap((streams[k] || '') + v)
      return { ...s, streams }
    }
    case 'stream_snapshot': return { ...s, streams: ev.streams }
    case 'review': return { ...s, review: ev.state === 'start' ? { state: 'start' } : { state: 'result', ok: ev.ok, summary: ev.summary, issues: ev.issues } }
    case 'tool': {
      const cur = s.tools[ev.agent]?.[ev.tool] || { count: 0 }
      return {
        ...s,
        tools: { ...s.tools, [ev.agent]: { ...(s.tools[ev.agent] || {}), [ev.tool]: { count: cur.count + 1, at: ev.replay ? 0 : Date.now(), ok: ev.ok, arg: ev.arg, summary: ev.summary } } },
        toolLog: [...s.toolLog.slice(-80), { agent: ev.agent, tool: ev.tool, arg: ev.arg, ok: ev.ok, summary: ev.summary, task: ev.task_id }],
      }
    }
    case 'log': return { ...s, logs: [...s.logs.slice(-40), ev] }
    case 'retry': return { ...s, logs: [...s.logs.slice(-40), { level: 'warn', message: `Лимит у ${ev.agent}: повтор через ${ev.delay} с` }] }
    case 'failover': return { ...s, logs: [...s.logs.slice(-40), { level: 'warn', message: `Задача ${ev.task_id || ''} переходит: ${ev.frm} → ${ev.to}` }] }
    case 'memory_update': return { ...s, remembered: [...s.remembered, ...(ev.added || [])] }
    case 'chat_reply': return { ...s, chat: { text: ev.text, language: ev.language }, running: false, ended: Date.now(), core: { state: 'idle', label: '' } }
    case 'done': return { ...s, ended: Date.now(), running: false, done: ev, core: { state: 'idle', label: '' } }
    case 'fatal': return { ...s, ended: Date.now(), running: false, fatal: ev.message, core: { state: 'idle', label: '' } }
    default: return s
  }
}

export function useOrchestra() {
  const [state, dispatch] = useReducer(reduce, undefined, initial)
  const wsRef = useRef(null)
  const listeners = useRef(new Set())
  const replay = useRef(false)
  const buf = useRef({})
  const timer = useRef(0)

  const bus = useMemo(() => ({ subscribe: (fn) => { listeners.current.add(fn); return () => listeners.current.delete(fn) } }), [])

  const flush = useCallback(() => {
    timer.current = 0
    const batch = buf.current
    buf.current = {}
    if (Object.keys(batch).length) dispatch({ type: 'stream_batch', batch })
  }, [])

  const connect = useCallback((runId) => {
    wsRef.current?.close()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws/runs/${runId}`)
    wsRef.current = ws
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data)
      if (ev.type === 'replay_start') { replay.current = true; return }
      if (ev.type === 'replay_end') { replay.current = false; return }
      if (ev.type === 'stream') {
        buf.current[ev.actor] = (buf.current[ev.actor] || '') + ev.text
        if (!timer.current) timer.current = window.setTimeout(flush, 60)
        return
      }
      dispatch(ev.type === 'tool' ? { ...ev, replay: replay.current } : ev)
      if (!replay.current) listeners.current.forEach((fn) => fn(ev))
    }
    ws.onclose = () => { wsRef.current = null }
  }, [flush])

  const start = useCallback(async (prompt, history = []) => {
    const r = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, history }) })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Не удалось запустить миссию')
    const { run_id } = await r.json()
    dispatch({ type: 'begin', runId: run_id, prompt })
    localStorage.setItem('orchestra.run', run_id)
    connect(run_id)
  }, [connect])

  const cancel = useCallback(() => { if (state.runId) fetch(`/api/runs/${state.runId}/cancel`, { method: 'POST' }) }, [state.runId])
  const reset = useCallback(() => { wsRef.current?.close(); localStorage.removeItem('orchestra.run'); dispatch({ type: 'reset' }) }, [])

  // восстановление после перезагрузки страницы
  useEffect(() => {
    const id = localStorage.getItem('orchestra.run')
    if (id) { dispatch({ type: 'begin', runId: id, prompt: '' }); connect(id) }
    return () => wsRef.current?.close()
  }, [connect])

  // «успокоение» статусов done/error
  const timers = useRef({})
  useEffect(() => {
    for (const id of ORDER) {
      const a = state.agents[id]
      if ((a.status === 'done' || a.status === 'error') && !timers.current[id + a.statusAt]) {
        timers.current[id + a.statusAt] = setTimeout(() => dispatch({ type: 'agent_settle', agent: id, statusAt: a.statusAt }), a.status === 'done' ? 2600 : 3500)
      }
    }
  }, [state.agents])

  return { state, bus, start, cancel, reset }
}
