import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

export default function FileViewer({ runId, path, onClose }) {
  const [text, setText] = useState('')
  useEffect(() => {
    if (!path) return
    setText('…')
    fetch(`/api/runs/${runId}/file?path=${encodeURIComponent(path)}`).then((r) => r.json()).then((j) => setText(j.content ?? '')).catch(() => setText('Не удалось загрузить файл'))
  }, [runId, path])
  return (
    <AnimatePresence>
      {path && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="glass flex max-h-[85vh] w-[min(820px,100%)] flex-col" initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }} onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center gap-2 px-4 py-3 font-mono text-[12px] text-sky-200"><span className="truncate">{path}</span>
              <button className="btn-ghost ml-auto !p-1.5" onClick={onClose} aria-label="Закрыть"><X size={14} /></button></header>
            <pre className="term mx-3 mb-3 flex-1 overflow-auto rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-slate-200">{text}</pre>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
