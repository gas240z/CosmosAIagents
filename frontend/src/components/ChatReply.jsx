import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BookMarked, MessageCircle, Radio, X } from 'lucide-react'

function Typewriter({ text, reduced }) {
  const [n, setN] = useState(reduced ? text.length : 0)
  useEffect(() => {
    if (reduced) { setN(text.length); return }
    setN(0)
    const t = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(t), v) : v + 1)), 16)
    return () => clearInterval(t)
  }, [text, reduced])
  return <>{text.slice(0, n)}{n < text.length && <span className="cursor-blink text-amber-300">▋</span>}</>
}

// Ответ оркестратора в обычном разговоре — без запуска агентов.
export default function ChatReply({ chat, question, remembered = [], onClose, reduced }) {
  return (
    <AnimatePresence>
      {chat && (
        <motion.div key="chat" className="pointer-events-none absolute inset-x-0 top-16 z-40 flex justify-center px-3 sm:top-[72px]"
          initial={{ opacity: 0, y: -24, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -16 }} transition={{ type: 'spring', stiffness: 220, damping: 20 }}>
          <div className="glass pointer-events-auto w-full max-w-[620px] p-5" role="status" aria-live="polite">
            <div className="mb-3 flex items-center gap-3">
              <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: 'radial-gradient(circle at 35% 30%, #fff6d8, #ffc65a 55%, #ff7a2a)', boxShadow: '0 0 22px rgba(255,180,80,.7)' }}>
                <MessageCircle size={18} color="#4a1d00" />
                {!reduced && <motion.i className="absolute inset-0 rounded-full border border-amber-300" animate={{ scale: [1, 1.7], opacity: [0.8, 0] }} transition={{ duration: 1.8, repeat: Infinity }} />}
              </span>
              <div className="leading-tight">
                <div className="flex items-center gap-1.5 font-display text-[12px] font-bold uppercase tracking-[.18em] text-amber-200 neon-text"><Radio size={12} /> Центр управления</div>
                {chat.language && <div className="text-[10px] uppercase tracking-wider text-slate-400">{chat.language}</div>}
              </div>
              <button className="btn-ghost ml-auto !p-1.5" onClick={onClose} aria-label="Закрыть"><X size={14} /></button>
            </div>
            {question && <div className="mb-2 truncate rounded-lg bg-white/5 px-3 py-1.5 text-[12px] italic text-slate-300/80">{question}</div>}
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-white"><Typewriter text={chat.text} reduced={reduced} /></p>
            {remembered.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : 0.6 }} className="mt-3 flex flex-wrap gap-1.5">
                {remembered.map((t, i) => <span key={i} className="chip" style={{ background: 'rgba(255,200,90,.15)', borderColor: 'rgba(255,200,90,.5)' }}><BookMarked size={11} /> Запомнил: {t}</span>)}
              </motion.div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
