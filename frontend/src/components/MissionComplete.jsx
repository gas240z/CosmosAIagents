import { AnimatePresence, motion } from 'framer-motion'
import { Download, PackageCheck, Rocket } from 'lucide-react'

export default function MissionComplete({ done, onNew, delay = 1.2 }) {
  return (
    <AnimatePresence>
      {done && (
        <motion.div className="pointer-events-none absolute inset-0 z-40 grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay }}>
          <motion.div className="glass pointer-events-auto w-[min(420px,92%)] p-6 text-center" initial={{ scale: 0.7, y: 40, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 16, delay }}>
            <motion.div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full" style={{ background: 'radial-gradient(circle,#fff6d8,#ffc65a 60%,#ff7a2a)', boxShadow: '0 0 40px #ffb347' }}
              animate={{ y: [0, -6, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}>
              <Rocket size={26} color="#4a1d00" />
            </motion.div>
            <h2 className="font-display text-xl font-black uppercase tracking-[.14em] text-white neon-text">Миссия выполнена</h2>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-[13px] text-slate-300"><PackageCheck size={15} /> {done.project} · {done.file_count} файлов</p>
            <a href={done.zip_url} download className="btn-neon mt-5 w-full no-underline"><Download size={16} /> Скачать ZIP</a>
            <button className="btn-ghost mt-2 w-full text-[12px]" onClick={onNew}>Новая миссия</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
