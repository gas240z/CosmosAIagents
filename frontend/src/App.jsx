import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, BookMarked, Moon, Orbit, Send, Settings, Sparkles, Square, Sun } from 'lucide-react'
import SpaceBackground from './components/SpaceBackground'
import Stage from './components/Stage'
import StreamPanel from './components/StreamPanel'
import FileTree from './components/FileTree'
import Timeline from './components/Timeline'
import SettingsDrawer from './components/SettingsDrawer'
import MissionComplete from './components/MissionComplete'
import ChatReply from './components/ChatReply'
import MemoryDrawer from './components/MemoryDrawer'
import { notifyMemory, useMemory } from './useMemory'
import FileViewer from './components/FileViewer'
import StatsHud from './components/StatsHud'
import { ORDER, ThemeCtx } from './agents'
import { useOrchestra } from './useOrchestra'
import { useSettings } from './useSettings'

const EXAMPLES = ['Привет, как дела?', 'Создай шопинг-сайт', 'Сделай to-do приложение с Flask API', 'Лендинг для кофейни с формой заказа']

export default function App() {
  const { state, bus, start, cancel, reset } = useOrchestra()
  const { settings, loading, load, save } = useSettings()
  const mem = useMemory()
  const [memOpen, setMemOpen] = useState(false)
  const reduced = !!useReducedMotion()
  const [prompt, setPrompt] = useState('')
  const [selected, setSelected] = useState('orchestrator')
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(null)
  const [err, setErr] = useState('')
  const [auto, setAuto] = useState(true)
  const chatLog = useRef([]) // память диалога: последние реплики уходят оркестратору для контекста
  const [chatOpen, setChatOpen] = useState(true)
  const [light, setLight] = useState(() => {
    const t = localStorage.getItem('orchestra.theme')
    return t ? t === 'light' : false
  })
  useEffect(() => {
    document.documentElement.dataset.theme = light ? 'light' : 'dark'
    localStorage.setItem('orchestra.theme', light ? 'light' : 'dark')
  }, [light])
  const themeVal = useMemo(() => ({ light }), [light])

  // автопереключение потока на активного агента
  useEffect(() => {
    if (!auto || selected === 'console') return
    const act = ORDER.find((id) => state.agents[id].status === 'writing') || ORDER.find((id) => state.agents[id].status === 'thinking')
    if (act) setSelected(act)
    else if (state.core.state === 'thinking') setSelected('orchestrator')
  }, [state.agents, state.core.state, auto, selected])

  // модели в подписях: из текущего запуска, иначе из настроек
  const agents = useMemo(() => {
    const out = {}
    for (const id of ORDER) {
      const a = state.agents[id]
      const s = settings?.providers.find((p) => p.id === id)
      out[id] = { ...a, model: a.model || s?.model || '', available: state.runId && state.orch ? a.available : (s ? s.has_key : true) }
    }
    return out
  }, [state.agents, state.runId, state.orch, settings])
  const orch = state.orch || (settings?.orchestrator.provider ? { model: settings.orchestrator.model || settings.providers.find((p) => p.id === settings.orchestrator.provider)?.model } : null)

  useEffect(() => bus.subscribe((ev) => { if (ev.type === 'memory_update') notifyMemory() }), [bus])
  useEffect(() => {
    if (state.chat && state.prompt) { chatLog.current.push({ role: 'user', text: state.prompt }, { role: 'assistant', text: state.chat.text }); setChatOpen(true) }
  }, [state.chat])
  useEffect(() => {
    if (state.done && state.prompt) chatLog.current.push({ role: 'user', text: state.prompt }, { role: 'assistant', text: `[создан проект ${state.done.project}: ${state.done.file_count} файлов]` })
  }, [state.done])

  const submit = async (e) => {
    e?.preventDefault()
    if (!prompt.trim() || state.running) return
    setErr('')
    const text = prompt.trim()
    try { reset(); setPrompt(''); await start(text, chatLog.current.slice(-8)) } catch (x) { setErr(x.message); setPrompt(text) }
  }
  const idle = !state.running && !state.done
  const noKeys = settings && !settings.providers.some((p) => p.has_key)

  return (
    <ThemeCtx.Provider value={themeVal}>
    <div className="relative flex min-h-screen min-w-0 flex-col gap-3 overflow-x-hidden p-3 lg:h-screen lg:overflow-hidden">
      <SpaceBackground light={light} />

      <header className="glass flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <motion.span animate={reduced ? {} : { rotate: 360 }} transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}><Orbit size={22} className="text-sky-300" /></motion.span>
          <h1 className="font-display text-base font-black uppercase tracking-[.2em] text-white neon-text sm:text-lg">Agent <span className="text-fuchsia-300">Orchestra</span></h1>
          <Sparkles size={14} className="hidden text-amber-300 sm:block" />
        </div>
        <form onSubmit={submit} className="order-3 flex min-w-0 flex-1 basis-full items-center gap-2 lg:order-none lg:basis-0">
          <input value={state.running ? state.prompt : prompt} onChange={(e) => setPrompt(e.target.value)} disabled={state.running} maxLength={2000} aria-label="Сообщение" autoFocus
            placeholder="Напишите сообщение или опишите проект: «создай шопинг-сайт»…"
            className="field min-w-0 flex-1 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-sky-400 disabled:opacity-60" />
          {state.running ? (
            <button type="button" className="btn-ghost !border-red-400/60 !text-red-500" onClick={cancel}><Square size={14} /> Отмена</button>
          ) : (
            <button type="submit" className="btn-neon" disabled={!prompt.trim() || noKeys}><Send size={15} /> Отправить</button>
          )}
        </form>
        <button className="btn-ghost relative" onClick={() => setMemOpen(true)} aria-label="Память" title="Память миссий">
          <BookMarked size={16} className="text-amber-400" />
          {mem.items.length > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-[#2a1600]">{mem.items.length}</span>}
        </button>
        <button className="btn-ghost" onClick={() => setLight(!light)} aria-label={light ? 'Тёмная тема' : 'Светлая тема'} title={light ? 'Тёмная тема' : 'Светлая тема'}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={light ? 's' : 'm'} className="grid place-items-center" initial={{ rotate: -90, scale: 0, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 90, scale: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
              {light ? <Sun size={16} className="text-amber-500" /> : <Moon size={16} className="text-sky-200" />}
            </motion.span>
          </AnimatePresence>
        </button>
        <button className="btn-ghost" onClick={() => { load(); setOpen(true) }} aria-label="Настройки"><Settings size={16} /></button>
      </header>

      {(err || state.fatal || noKeys) && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-2 text-[13px] text-red-100">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{err || state.fatal || 'Не найден ни один API-ключ. Добавьте их в файл .env или откройте настройки (⚙).'}</span>
        </div>
      )}
      {state.logs.length > 0 && (
        <div className="flex gap-2 overflow-x-auto text-[11px] text-amber-200/90">
          {state.logs.slice(-3).map((l, i) => <span key={i} className="whitespace-nowrap rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1">{l.message}</span>)}
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="relative h-[68vh] min-h-[460px] lg:h-auto">
          <StatsHud state={state} />
          <Stage agents={agents} core={state.core} orch={orch} bus={bus} selected={selected} onSelect={setSelected} tools={state.tools} />
          {idle && !state.prompt && !state.chat && (
            <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-wrap justify-center gap-2 px-3">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" className="btn-ghost pointer-events-auto !py-1.5 text-[11.5px]" onClick={() => setPrompt(x)}>{x}</button>
              ))}
            </div>
          )}
          {state.phaseLabel && state.running && (
            <AnimatePresence mode="wait">
              <motion.div key={state.phaseLabel} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="glass pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 px-4 py-1.5 font-display text-[11px] uppercase tracking-[.2em] text-sky-100">{state.phaseLabel}</motion.div>
            </AnimatePresence>
          )}
          <ChatReply chat={chatOpen ? state.chat : null} question={state.prompt} remembered={state.remembered} onClose={() => setChatOpen(false)} reduced={reduced} />
          <MissionComplete done={state.done} onNew={() => { reset(); setPrompt('') }} />
        </div>
        <aside className="flex min-h-0 flex-col gap-3 lg:h-full">
          <StreamPanel state={state} selected={selected} onSelect={setSelected} auto={auto} setAuto={setAuto} onOpenFile={setView} light={light} setLight={setLight}
            onCancel={cancel} onStart={(q) => { setErr(''); reset(); start(q, chatLog.current.slice(-8)).catch((x) => setErr(x.message)) }} reduced={reduced} />
          <FileTree files={state.files} onOpen={setView} reduced={reduced} />
        </aside>
      </main>

      {!state.chat && <Timeline tasks={state.tasks} taskState={state.taskState} phase={state.phase} running={state.running} done={state.done} />}

      <SettingsDrawer open={open} onClose={() => setOpen(false)} settings={settings} loading={loading} onSave={save} onRefresh={() => load(true)} />
      <MemoryDrawer open={memOpen} onClose={() => setMemOpen(false)} mem={mem} reduced={reduced} />
      <FileViewer runId={state.runId} path={view} onClose={() => setView(null)} />
    </div>
    </ThemeCtx.Provider>
  )
}
