import { memo, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Braces, ChevronRight, FileCode, FileImage, FileText, Folder, FolderOpen, Globe, Loader2, Palette, SquareTerminal } from 'lucide-react'
import { ACTORS } from '../agents'

const iconFor = (name) => {
  const e = name.split('.').pop().toLowerCase()
  if (['html', 'htm'].includes(e)) return [Globe, '#ff9a62']
  if (['css', 'scss'].includes(e)) return [Palette, '#6ea8ff']
  if (['json', 'yml', 'yaml', 'toml'].includes(e)) return [Braces, '#f2d45c']
  if (['md', 'txt'].includes(e)) return [FileText, '#9fb0e8']
  if (['py', 'sh', 'bat'].includes(e)) return [SquareTerminal, '#5be3a8']
  if (['png', 'jpg', 'jpeg', 'svg', 'ico', 'gif', 'webp'].includes(e)) return [FileImage, '#ff7ac8']
  return [FileCode, '#b59bff']
}

function build(files) {
  const root = { dirs: {}, files: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let n = root
    parts.slice(0, -1).forEach((d) => { n = n.dirs[d] ??= { dirs: {}, files: [] } })
    n.files.push({ ...f, name: parts[parts.length - 1] })
  }
  return root
}
const kb = (b) => (b > 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`)

function Node({ node, depth, onOpen, reduced, closed, toggle, prefix }) {
  const spring = reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 26 }
  return (
    <>
      {Object.entries(node.dirs).sort().map(([name, sub]) => {
        const p = prefix + name + '/'
        const isClosed = closed.has(p)
        return (
          <motion.li layout key={p} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={spring}>
            <button onClick={() => toggle(p)} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] text-sky-200 hover:bg-white/5" style={{ paddingLeft: 6 + depth * 14 }}>
              <ChevronRight size={12} style={{ transform: isClosed ? 'none' : 'rotate(90deg)', transition: 'transform .2s' }} />
              {isClosed ? <Folder size={14} className="text-amber-300" /> : <FolderOpen size={14} className="text-amber-300" />} {name}
            </button>
            {!isClosed && <ul><Node node={sub} depth={depth + 1} onOpen={onOpen} reduced={reduced} closed={closed} toggle={toggle} prefix={p} /></ul>}
          </motion.li>
        )
      })}
      <AnimatePresence initial={false}>
        {node.files.map((f) => {
          const c = ACTORS[f.agent]?.color || '#9fb0e8'
          const [Icon, ic] = iconFor(f.name)
          return (
            <motion.li layout key={f.path} initial={{ opacity: 0, x: -18, scale: 0.92 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={spring}>
              <button disabled={f.state !== 'done'} onClick={() => onOpen(f.path)}
                className="group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] text-slate-200 hover:bg-white/5 disabled:cursor-default" style={{ paddingLeft: 22 + depth * 14 }}>
                <i className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                <Icon size={14} className="shrink-0" style={{ color: ic }} />
                <span className="truncate">{f.name}</span>
                <span className="ml-auto shrink-0 pl-2 text-[10px] text-slate-400">
                  {f.state === 'done' ? kb(f.size) : <Loader2 size={12} className="animate-spin" style={{ color: c }} />}
                </span>
              </button>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </>
  )
}

function FileTree({ files, onOpen, reduced }) {
  const tree = useMemo(() => build(files), [files])
  const [closed, setClosed] = useState(new Set())
  const toggle = (p) => setClosed((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n })
  return (
    <section className="glass flex max-h-[34vh] min-h-[150px] flex-col overflow-hidden lg:max-h-none lg:h-[38%]" aria-label="Дерево файлов">
      <header className="flex items-center gap-2 px-4 pt-3 text-[11px] uppercase tracking-[.18em] text-sky-200/80">
        <Folder size={14} /> <span className="font-display">Груз миссии</span>
        <span className="ml-auto normal-case tracking-normal text-slate-400">{files.filter((f) => f.state === 'done').length} файлов</span>
      </header>
      <ul className="min-h-0 flex-1 overflow-auto p-2">
        {files.length ? <Node node={tree} depth={0} onOpen={onOpen} reduced={reduced} closed={closed} toggle={toggle} prefix="" /> :
          <li className="p-3 text-[12px] text-slate-400/70">Файлы появятся здесь по мере работы агентов.</li>}
      </ul>
    </section>
  )
}
export default memo(FileTree)
