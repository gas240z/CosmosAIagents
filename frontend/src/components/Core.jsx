import { forwardRef, memo } from 'react'
import { motion } from 'framer-motion'
import { Radar } from 'lucide-react'
import { useTheme } from '../agents'

const Core = forwardRef(function Core({ R, state, label, model, reduced }, ref) {
  const hot = state === 'thinking'
  const { light } = useTheme()
  const D = R * 2.3
  const pulse = reduced ? {} : { scale: hot ? [1, 1.12, 1] : [1, 1.05, 1] }
  const pt = { duration: hot ? 0.9 : 2.8, repeat: Infinity, ease: 'easeInOut' }
  const ring = (size, tilt, dur, rev, color, dot) => (
    <div style={{ position: 'absolute', left: -size / 2, top: -size / 2, width: size, height: size, perspective: 700, pointerEvents: 'none' }}>
      <motion.div animate={reduced ? {} : { rotateZ: rev ? -360 : 360 }} transition={{ duration: dur, repeat: Infinity, ease: 'linear' }}
        style={{ width: '100%', height: '100%', rotateX: tilt, borderRadius: '50%', border: `1.5px solid ${color}`, boxShadow: `0 0 14px ${color}, inset 0 0 12px ${color}55`, position: 'relative' }}>
        <span style={{ position: 'absolute', left: '100%', top: '50%', width: 8, height: 8, marginLeft: -4, marginTop: -4, borderRadius: '50%', background: dot, boxShadow: `0 0 12px 3px ${dot}` }} />
      </motion.div>
    </div>
  )
  return (
    <div ref={ref} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, willChange: 'transform', zIndex: 4 }}>
      {/* корона */}
      <motion.div animate={reduced ? {} : { rotate: 360 }} transition={{ duration: hot ? 14 : 40, repeat: Infinity, ease: 'linear' }}
        style={{ position: 'absolute', width: D * 2.6, height: D * 2.6, left: -D * 1.3, top: -D * 1.3, borderRadius: '50%', pointerEvents: 'none', filter: 'blur(6px)',
          background: 'conic-gradient(from 0deg, transparent, rgba(255,200,120,.35), transparent 18%, rgba(165,75,255,.35) 33%, transparent 50%, rgba(255,170,90,.3) 66%, transparent 82%, rgba(110,150,255,.3))',
          WebkitMaskImage: 'radial-gradient(circle, #000 20%, transparent 68%)', maskImage: 'radial-gradient(circle, #000 20%, transparent 68%)' }} />
      <motion.div animate={reduced ? {} : { scale: hot ? [1, 1.25, 1] : [1, 1.1, 1], opacity: hot ? [0.7, 1, 0.7] : [0.5, 0.75, 0.5] }} transition={pt}
        style={{ position: 'absolute', width: D * 3, height: D * 3, left: -D * 1.5, top: -D * 1.5, borderRadius: '50%', pointerEvents: 'none',
          background: light ? 'radial-gradient(circle, rgba(255,190,110,.38) 0%, rgba(255,120,60,.14) 30%, rgba(140,80,255,.08) 52%, transparent 70%)' : 'radial-gradient(circle, rgba(255,210,140,.55) 0%, rgba(255,120,60,.22) 30%, rgba(140,80,255,.14) 52%, transparent 70%)' }} />
      {/* радарный луч */}
      <div style={{ position: 'absolute', width: D * 2.9, height: D * 2.9, left: -D * 1.45, top: -D * 1.45, borderRadius: '50%', pointerEvents: 'none', opacity: hot ? 0.9 : 0.35,
        background: `conic-gradient(from 0deg, transparent 0 80%, ${light ? 'rgba(255,140,40,.35)' : 'rgba(255,220,140,.4)'} 97%, ${light ? 'rgba(255,120,20,.7)' : 'rgba(255,240,190,.9)'} 100%)`,
        WebkitMaskImage: 'radial-gradient(circle, transparent 30%, #000 32%, transparent 70%)', maskImage: 'radial-gradient(circle, transparent 30%, #000 32%, transparent 70%)',
        animation: reduced ? undefined : `radar ${hot ? 2.2 : 7}s linear infinite` }} />
      {ring(D * 1.55, 72, 12, false, 'rgba(255,220,150,.75)', '#ffe6a8')}
      {ring(D * 2.0, 64, 19, true, 'rgba(180,130,255,.7)', '#caa8ff')}
      {ring(D * 2.5, 76, 28, false, 'rgba(110,190,255,.55)', '#9fd4ff')}
      <motion.div animate={pulse} transition={pt}
        style={{ position: 'absolute', width: D, height: D, left: -D / 2, top: -D / 2, borderRadius: '50%', zIndex: 2,
          background: 'radial-gradient(circle at 40% 38%, #ffffff 0%, #fff3c8 22%, #ffc65a 52%, #ff7a2a 82%, #b8350f 100%)',
          boxShadow: light ? '0 0 30px 8px rgba(255,170,70,.5), 0 0 60px 18px rgba(255,110,60,.22)' : '0 0 40px 12px rgba(255,190,90,.65), 0 0 90px 30px rgba(255,110,60,.35)' }} />
      <div className="text-center" style={{ position: 'absolute', zIndex: 6, left: -90, width: 180, top: D * 1.0 + 6 }}>
        <div className="flex items-center justify-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[.2em] text-amber-200 neon-text"><Radar size={13} /> Центр управления</div>
        <div className="mx-auto max-w-[180px] truncate text-[10px] text-slate-300/70" title={model}>{model || 'оркестратор'}</div>
        {hot && <div className="text-[9px] uppercase tracking-widest text-amber-300/90">{label || 'думает'}…</div>}
      </div>
    </div>
  )
})

export default memo(Core)
