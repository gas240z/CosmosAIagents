import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Check, ChevronRight, Copy, CornerDownLeft, Maximize2, Minimize2, Radio, SquareTerminal, Terminal, Trash2 } from 'lucide-react'
import { ACTORS, ORDER } from '../agents'
import { COMMANDS, execute, suggestions } from '../consoleCmds'

// Печатная машинка: показывает текст порциями, догоняя входящий поток.
const SEEN = new Map() // сколько символов уже «напечатано» по каждому каналу — чтобы не печатать заново при переключении вкладок

function Typed({ text, reduced, id }) {
  const [n, setN] = useState(reduced ? text.length : Math.min(SEEN.get(id) || 0, text.length))
  const ref = useRef({ n: Math.min(SEEN.get(id) || 0, text.length), len: 0 })
  ref.current.len = text.length
  useEffect(() => {
    if (reduced) { setN(text.length); return }
    let raf
    const tick = () => {
      const r = ref.current
      if (r.n > r.len) r.n = r.len
      if (r.n < r.len) { r.n += Math.max(2, Math.ceil((r.len - r.n) / 14)); SEEN.set(id, r.n); setN(r.n) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduced, id])
  const shown = text.slice(0, Math.min(n, text.length))
  return <>{shown.length > 6000 ? '…' + shown.slice(-6000) : shown}</>
}

const KIND = { out: '', dim: 'opacity-60', ok: 'text-emerald-300', err: 'text-red-300', cmd: 'text-sky-300' }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function Line({ l, files, onOpen }) {
  const re = useMemo(() => (files.length ? new RegExp(`(${files.map((f) => esc(f.path)).sort((a, b) => b.length - a.length).join('|')})`, 'g') : null), [files])
  if (l.k === 'cmd') return <div className={KIND.cmd}>{l.t}</div>
  const parts = re ? l.t.split(re) : [l.t]
  return (
    <div className={KIND[l.k]}>
      {parts.map((p, i) => (i % 2 ? <button key={i} type="button" onClick={() => onOpen(p)} className="underline decoration-dotted underline-offset-2 hover:text-white" title="Открыть файл">{p}</button> : p))}
    </div>
  )
}

function StreamPanel({ state, selected, onSelect, auto, setAuto, onOpenFile, light, setLight, onCancel, onStart, reduced }) {
  const { streams, agents, running, files } = state
  const box = useRef(null)
  const inputRef = useRef(null)
  const [lines, setLines] = useState([])
  const [input, setInput] = useState('')
  const [hist, setHist] = useState([])
  const [hi, setHi] = useState(-1)
  const [follow, setFollow] = useState(true)
  const [big, setBig] = useState(false)
  const [copied, setCopied] = useState(false)
  const [cut, setCut] = useState({})
  const isCon = selected === 'console'
  const actors = ['orchestrator', ...ORDER]
  const a = isCon ? { name: 'Консоль', color: light ? '#0a7ea4' : '#7ee7ff' } : { ...ACTORS[selected], color: light ? ACTORS[selected].dark : ACTORS[selected].color }
  const raw = isCon ? '' : streams[selected] || ''
  const text = raw.slice(Math.min(cut[selected] || 0, raw.length))
  const hints = useMemo(() => (input ? suggestions(input, state) : []), [input, state])

  useEffect(() => {
    const el = box.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [text, lines, selected, follow])

  const onScroll = () => {
    const el = box.current
    if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }

  const ctx = useMemo(() => ({
    state, light, setLight, setFollow, focus: (id) => { setAuto(false); onSelect(id) }, openFile: onOpenFile, cancel: onCancel, start: onStart,
    clear: () => { setLines([]); setCut((c) => ({ ...c, [selected]: (streams[selected] || '').length })) },
  }), [state, light, setLight, setAuto, onSelect, onOpenFile, onCancel, onStart, selected, streams])

  const submit = useCallback(async (value) => {
    const v = value.trim()
    if (!v) return
    setHist((h) => [v, ...h.filter((x) => x !== v)].slice(0, 50))
    setHi(-1)
    setInput('')
    if (!isCon) { setAuto(false); onSelect('console') }
    const out = await execute(v, ctx)
    if (v.split(' ')[0] === 'clear') return
    setLines((l) => [...l, { k: 'cmd', t: `› ${v}` }, ...out].slice(-400))
    setFollow(true)
  }, [ctx, isCon, onSelect, setAuto])

  const onKey = (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); const i = Math.min(hist.length - 1, hi + 1); if (i >= 0) { setHi(i); setInput(hist[i]) } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); const i = hi - 1; setHi(i); setInput(i >= 0 ? hist[i] : '') }
    else if (e.key === 'Tab') { e.preventDefault(); if (hints[0]) setInput(hints[0] + (hints[0].includes(' ') ? '' : ' ')) }
    else if (e.key === 'Escape' && big) setBig(false)
  }

  const copy = async () => {
    const t = isCon ? lines.map((l) => l.t).join('\n') : text
    try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 1400) } catch { /* нет доступа к буферу */ }
  }
  const tool = 'grid h-6 w-6 place-items-center rounded-md border border-white/10 text-slate-300 transition hover:bg-white/10 hover:text-white'

  return (
    <>
      {big && <div className="fixed inset-0 z-40 bg-black/60" onClick={() => setBig(false)} />}
      <section className={`glass flex flex-col overflow-hidden ${big ? 'fixed inset-4 z-50 sm:inset-10' : 'min-h-[300px] flex-1'}`} aria-label="Бортовой компьютер">
        <header className="flex items-center gap-2 px-4 pt-3 text-[11px] uppercase tracking-[.18em] text-sky-200/80">
          <Terminal size={14} /> <span className="font-display">Бортовой компьютер</span>
          <span className="ml-auto flex items-center gap-1 normal-case tracking-normal" style={{ color: a.color }}>
            <i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: a.color, boxShadow: `0 0 8px ${a.color}` }} /> {a.name}
          </span>
        </header>
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2" role="tablist">
          <button type="button" onClick={() => setAuto(!auto)} title={auto ? 'Автопереключение на активного агента: вкл' : 'Автопереключение выключено'} aria-pressed={auto}
            className="chip shrink-0" style={auto ? { background: 'rgba(47,227,161,.18)', borderColor: 'rgba(47,227,161,.6)' } : undefined}>
            <Radio size={11} className={auto ? 'animate-pulse' : ''} /> авто
          </button>
          {actors.map((id) => {
            const live = id !== 'orchestrator' && ['thinking', 'writing'].includes(agents[id]?.status)
            const Ic = ACTORS[id].icon
            return (
              <button key={id} role="tab" aria-selected={selected === id} onClick={() => { setAuto(false); onSelect(id) }}
                className="relative flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] transition-colors"
                style={{ color: selected === id ? (light ? '#14173f' : '#fff') : (light ? '#4a52a0' : '#9fb0e8'), background: selected === id ? `${ACTORS[id].color}${light ? '66' : '55'}` : 'rgba(140,160,255,.1)', border: `1px solid ${selected === id ? ACTORS[id].color : 'rgba(140,160,255,.2)'}` }}>
                {Ic ? <Ic size={11} /> : <Radio size={11} />}
                {live && <i className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: ACTORS[id].color }} />}
                {ACTORS[id].name}
              </button>
            )
          })}
          <button role="tab" aria-selected={isCon} onClick={() => { setAuto(false); onSelect('console'); inputRef.current?.focus() }}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px]"
            style={{ color: isCon ? (light ? '#14173f' : '#fff') : (light ? '#4a52a0' : '#9fb0e8'), background: isCon ? 'rgba(126,231,255,.4)' : 'rgba(140,160,255,.1)', border: `1px solid ${isCon ? '#7ee7ff' : 'rgba(140,160,255,.2)'}` }}>
            <SquareTerminal size={11} /> Консоль
          </button>
        </div>

        <div className="relative mx-3 min-h-0 flex-1">
          <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-70 transition hover:opacity-100">
            <button className={tool} onClick={() => setFollow(true)} title="Следовать за потоком" aria-label="Следовать" style={follow ? { color: '#2fe3a1', borderColor: '#2fe3a199' } : undefined}><ArrowDownToLine size={12} /></button>
            <button className={tool} onClick={copy} title="Копировать" aria-label="Копировать">{copied ? <Check size={12} /> : <Copy size={12} />}</button>
            <button className={tool} onClick={() => ctx.clear()} title="Очистить" aria-label="Очистить"><Trash2 size={12} /></button>
            <button className={tool} onClick={() => setBig(!big)} title={big ? 'Свернуть' : 'На весь экран'} aria-label="Развернуть">{big ? <Minimize2 size={12} /> : <Maximize2 size={12} />}</button>
          </div>
          <pre ref={box} onScroll={onScroll} onClick={() => isCon && inputRef.current?.focus()}
            className="term h-full min-h-[150px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/35 p-3 pr-24 font-mono text-[11.5px] leading-relaxed text-emerald-200/90"
            style={{ border: '1px solid rgba(120,255,200,.14)', textShadow: '0 0 6px rgba(80,255,180,.22)' }}>
            {isCon ? (
              <>
                {!lines.length && (
                  <div className="text-slate-400/80">
                    {'Бортовой компьютер на связи.\nВведите '}<b className="text-emerald-300">help</b>{' — или нажмите на подсказку ниже.\n\n'}
                  </div>
                )}
                {lines.map((l, i) => <Line key={i} l={l} files={files} onOpen={onOpenFile} />)}
              </>
            ) : text ? <Typed key={selected} id={selected} text={text} reduced={reduced} /> :
              <span className="text-slate-400/70">{running ? 'ожидание сигнала…' : 'Канал связи свободен. Запустите миссию или введите команду.'}</span>}
            <span className="cursor-blink text-emerald-300">▋</span>
          </pre>
          {!follow && (
            <button onClick={() => setFollow(true)} className="chip absolute bottom-2 right-3 z-10 backdrop-blur" style={{ background: 'rgba(15,20,60,.85)', color: '#cfe0ff' }}>
              <ArrowDownToLine size={11} /> к новому
            </button>
          )}
        </div>

        {(isCon || hints.length > 0) && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2">
            {(hints.length ? hints : ['help', 'status', 'tasks', 'files', 'agents', 'contract']).map((h) => (
              <button key={h} type="button" className="chip font-mono hover:brightness-125" onClick={() => (hints.length ? setInput(h + ' ') : submit(h))} title={COMMANDS[h.split(' ')[0]]}>{h}</button>
            ))}
          </div>
        )}
        <form className="m-3 mt-2 flex items-center gap-2 rounded-xl px-3 py-1.5 field" onSubmit={(e) => { e.preventDefault(); submit(input) }}>
          <ChevronRight size={14} className="shrink-0 text-emerald-400" />
          <input ref={inputRef} value={input} onChange={(e) => { setInput(e.target.value); setHi(-1) }} onKeyDown={onKey} spellCheck="false" autoComplete="off"
            aria-label="Команда бортового компьютера" placeholder="help · status · tasks · cat index.html" className="min-w-0 flex-1 bg-transparent font-mono text-[12px] outline-none" />
          <button type="submit" className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:text-emerald-300" aria-label="Выполнить"><CornerDownLeft size={13} /></button>
        </form>
      </section>
    </>
  )
}
export default memo(StreamPanel)
