import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BookMarked, Brain, FolderGit2, Plus, Trash2, X } from 'lucide-react'

const ago = (ts) => {
  const m = Math.max(1, Math.round((Date.now() / 1000 - ts) / 60))
  return m < 60 ? `${m} мин` : m < 1440 ? `${Math.round(m / 60)} ч` : `${Math.round(m / 1440)} дн`
}

export default function MemoryDrawer({ open, onClose, mem, reduced }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const notes = mem.items.filter((i) => i.kind === 'note')
  const projects = mem.items.filter((i) => i.kind === 'project')
  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    try { await mem.add(text); setText('') } catch (x) { setErr(x.message) }
  }
  const Row = ({ i }) => (
    <motion.li layout initial={reduced ? false : { opacity: 0, x: 24, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -24, height: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }} className="group flex items-start gap-2.5 rounded-xl p-2.5"
      style={{ background: 'var(--card-bg)', border: `1px solid ${i.kind === 'note' ? 'rgba(255,200,90,.35)' : 'rgba(122,139,255,.35)'}` }}>
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: i.kind === 'note' ? 'rgba(255,200,90,.2)' : 'rgba(122,139,255,.2)', color: i.kind === 'note' ? '#e0a21a' : '#7a8bff' }}>
        {i.kind === 'note' ? <Brain size={13} /> : <FolderGit2 size={13} />}
      </span>
      <div className="min-w-0 flex-1"><div className="text-[12.5px] leading-snug">{i.text}</div><div className="mt-0.5 text-[10px] text-slate-400">{ago(i.ts)} назад · {i.id}</div></div>
      <button className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 opacity-60 transition hover:text-red-400 hover:opacity-100" onClick={() => mem.remove(i.id)} aria-label="Забыть"><Trash2 size={13} /></button>
    </motion.li>
  )
  const Group = ({ title, list, empty }) => (
    <div>
      <div className="mb-1.5 font-display text-[10.5px] uppercase tracking-[.18em] text-sky-200/80">{title} · {list.length}</div>
      <ul className="space-y-1.5"><AnimatePresence initial={false}>{list.slice().reverse().map((i) => <Row key={i.id} i={i} />)}</AnimatePresence></ul>
      {!list.length && <div className="rounded-xl border border-dashed border-white/15 p-3 text-[12px] text-slate-400/80">{empty}</div>}
    </div>
  )
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="bg" className="fixed inset-0 z-40 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside key="panel" role="dialog" aria-label="Память" className="glass fixed bottom-3 right-3 top-3 z-50 flex w-[min(440px,calc(100vw-1.5rem))] flex-col"
            initial={{ x: 520, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 520, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
            <header className="flex items-center gap-2 px-4 py-3">
              <BookMarked size={16} className="text-amber-300" />
              <h2 className="font-display text-sm font-bold uppercase tracking-[.16em]">Память миссий</h2>
              {mem.items.length > 0 && <button className="btn-ghost ml-auto !px-2.5 !py-1.5 text-[11px]" onClick={() => confirm('Забыть всё?') && mem.clear()}><Trash2 size={12} /> Очистить</button>}
              <button className={`btn-ghost !p-2 ${mem.items.length ? '' : 'ml-auto'}`} onClick={onClose} aria-label="Закрыть"><X size={14} /></button>
            </header>
            <p className="px-4 text-[11.5px] leading-relaxed text-slate-300/80">Оркестратор учитывает это при каждом запросе. Заметки он добавляет сам, когда вы просите «запомни…» или сообщаете о себе что-то постоянное; проекты записываются после каждой миссии. Хранится локально в <code>backend/data/memory.json</code>.</p>
            <div className="flex-1 space-y-4 overflow-auto px-4 py-3">
              <Group title="Заметки" list={notes} empty="Пока пусто. Напишите «запомни, что я люблю Tailwind» или добавьте вручную ниже." />
              <Group title="Прошлые проекты" list={projects} empty="Появятся после первой выполненной миссии." />
            </div>
            <form onSubmit={submit} className="m-4 mt-1">
              <div className="field flex items-center gap-2 rounded-xl px-3 py-1.5">
                <Plus size={14} className="shrink-0 text-amber-400" />
                <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="Запомнить: например, «предпочитаю React и Tailwind»" className="min-w-0 flex-1 bg-transparent py-1 text-[12.5px] outline-none" />
                <button type="submit" className="btn-neon !px-3 !py-1.5" disabled={text.trim().length < 3}>Запомнить</button>
              </div>
              {err && <div className="mt-1 text-[11px] text-red-400">{err}</div>}
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
