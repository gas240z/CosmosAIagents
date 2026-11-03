import { forwardRef, memo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Cog, PenLine, Sparkles, TriangleAlert, WifiOff } from 'lucide-react'
import { AGENTS, STATUS_LABEL, useTheme } from '../agents'

const SPIN = { idle: 70, thinking: 24, writing: 9, done: 30, error: 5, offline: 140 }

// Поверхности: основа, «текстура» (повторяется дважды по ширине => бесшовная прокрутка)
const SKIN = {
  anthropic: {
    base: 'radial-gradient(circle at 32% 28%, #ffd8c6 0%, #ff7a59 36%, #b9432b 72%, #47160f 100%)',
    tex: 'radial-gradient(ellipse 26% 12% at 20% 30%, rgba(255,235,220,.32), transparent 70%), radial-gradient(ellipse 30% 10% at 70% 62%, rgba(90,20,10,.38), transparent 70%), radial-gradient(ellipse 18% 8% at 45% 82%, rgba(255,200,170,.25), transparent 70%)',
  },
  openai: {
    base: 'radial-gradient(circle at 32% 28%, #c9ffe9 0%, #2fe3a1 36%, #0f8f68 72%, #03281f 100%)',
    tex: 'radial-gradient(ellipse 30% 9% at 25% 28%, rgba(220,255,240,.3), transparent 70%), radial-gradient(ellipse 28% 11% at 72% 58%, rgba(0,60,40,.4), transparent 70%), radial-gradient(ellipse 20% 7% at 40% 80%, rgba(160,255,215,.22), transparent 70%)',
  },
  groq: {
    base: 'radial-gradient(circle at 32% 28%, #fff1c4 0%, #ffae2e 28%, #ff5a14 62%, #5c1405 100%)',
    tex: 'radial-gradient(ellipse 34% 8% at 22% 24%, rgba(255,250,200,.45), transparent 70%), radial-gradient(ellipse 30% 9% at 68% 50%, rgba(120,20,0,.5), transparent 70%), radial-gradient(ellipse 22% 7% at 42% 78%, rgba(255,220,120,.35), transparent 70%)',
  },
  gemini: {
    base: 'radial-gradient(circle at 32% 28%, #dfe4ff 0%, #6f8bff 38%, #3a3fc4 72%, #0d0f4a 100%)',
    tex: 'radial-gradient(ellipse 28% 10% at 24% 30%, rgba(225,230,255,.32), transparent 70%), radial-gradient(ellipse 30% 10% at 70% 60%, rgba(20,20,110,.45), transparent 70%)',
  },
}
const SHADE = 'radial-gradient(circle at 30% 26%, rgba(255,255,255,.34), transparent 34%, rgba(0,0,28,.66) 100%)'

function Sphere({ d, skin, glow, spin, style }) {
  return (
    <div style={{ width: d, height: d, borderRadius: '50%', overflow: 'hidden', position: 'relative', background: skin.base,
      boxShadow: `0 0 ${d * 0.5}px ${glow}, inset -${d * 0.12}px -${d * 0.1}px ${d * 0.25}px rgba(0,0,20,.5)`, ...style }}>
      <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: '200%', background: skin.tex,
        backgroundSize: '50% 100%', backgroundRepeat: 'repeat-x', animation: `planet-spin ${spin}s linear infinite` }} />
      <div style={{ position: 'absolute', inset: 0, background: SHADE }} />
    </div>
  )
}


// Анимация «задача в работе»: HUD-кольца, сканирующий луч и спутник-носитель задачи — пока планета занята.
function TaskOrbit({ R, color, soft, fast, reduced }) {
  const d = R * 4
  const spin = (s, rev) => (reduced ? undefined : `${rev ? 'spin-ccw' : 'spin-cw'} ${s}s linear infinite`)
  return (
    <motion.div initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ type: 'spring', stiffness: 160, damping: 18 }}
      style={{ position: 'absolute', left: -d / 2, top: -d / 2, width: d, height: d, zIndex: 3, pointerEvents: 'none' }}>
      <svg width={d} height={d} viewBox={`${-d / 2} ${-d / 2} ${d} ${d}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <g style={{ animation: spin(fast ? 6 : 14), transformOrigin: '0 0' }}>
          <circle r={R * 1.32} fill="none" stroke={color} strokeWidth="1.6" strokeDasharray="3 9" opacity=".95" />
        </g>
        <g style={{ animation: spin(fast ? 3.2 : 7, true), transformOrigin: '0 0', filter: `drop-shadow(0 0 6px ${color})` }}>
          <circle r={R * 1.58} fill="none" stroke={soft} strokeWidth="2.6" strokeLinecap="round" strokeDasharray={`${R * 1.6} ${R * 8.3}`} />
          <circle r={R * 1.58} fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeDasharray={`${R * 0.6} ${R * 9.3}`} strokeDashoffset={-R * 5.2} />
        </g>
        <g style={{ animation: spin(fast ? 22 : 40), transformOrigin: '0 0' }}>
          <circle r={R * 1.85} fill="none" stroke={color} strokeWidth="1" strokeDasharray="1 7" strokeLinecap="round" opacity=".7" />
        </g>
      </svg>
      {/* сканирующий луч */}
      <div style={{ position: 'absolute', inset: R * 0.9, borderRadius: '50%', background: `conic-gradient(from 0deg, transparent 0 74%, ${color}00 74%, ${color}88 98%, ${soft} 100%)`,
        WebkitMaskImage: 'radial-gradient(circle, transparent 52%, #000 54%, #000 100%)', maskImage: 'radial-gradient(circle, transparent 52%, #000 54%, #000 100%)',
        animation: spin(fast ? 1.6 : 3.2), opacity: 0.85 }} />
      {/* спутник с задачей */}
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0 }}>
        <div style={{ '--mr': `${R * 1.58}px`, animation: reduced ? undefined : `orbit-moon ${fast ? 2.6 : 5.4}s linear infinite` }}>
          <i style={{ position: 'absolute', left: -R * 0.13, top: -R * 0.13, width: R * 0.26, height: R * 0.26, borderRadius: '50%',
            background: `radial-gradient(circle at 35% 30%, #fff, ${soft} 40%, ${color})`, boxShadow: `0 0 12px 3px ${color}, 0 0 26px ${color}88` }} />
        </div>
      </div>
    </motion.div>
  )
}

const Planet = forwardRef(function Planet({ id, a, R, selected, onSelect, reduced }, ref) {
  const meta = AGENTS[id]
  const { status, model, done, flashAt, available, title, task } = a
  const { light } = useTheme()
  const st = available ? status : 'offline'
  const col = st === 'error' ? '#ff3b4d' : meta.color
  const Icon = meta.icon
  const spin = SPIN[st] || 70
  const active = st === 'thinking' || st === 'writing'
  const labelCol = light ? meta.dark : meta.soft
  const dim = st === 'idle' ? 0.72 : st === 'offline' ? 0.3 : 1
  const aura = {
    idle: { scale: 1, opacity: 0.22 },
    offline: { scale: 1, opacity: 0.05 },
    done: { scale: 1.2, opacity: 0.6 },
    thinking: { scale: [1, 1.28, 1], opacity: [0.45, 0.9, 0.45] },
    writing: { scale: [1.15, 1.45, 1.15], opacity: [0.8, 1, 0.8] },
    error: { scale: [1, 1.1, 1], opacity: [0.2, 0.95, 0.35, 1, 0.2] },
  }[st]
  const auraT = reduced ? { duration: 0 } : { duration: st === 'writing' ? 0.7 : st === 'error' ? 0.5 : 1.7, repeat: Infinity, ease: 'easeInOut' }
  const skin = SKIN[id]
  const ringStyle = { position: 'absolute', left: '50%', top: '50%', width: R * 3.3, height: R * 0.95, marginLeft: -R * 1.65, marginTop: -R * 0.475,
    borderRadius: '50%', border: `${Math.max(3, R * 0.1)}px solid rgba(160,255,215,.85)`, boxShadow: '0 0 14px rgba(47,227,161,.7), inset 0 0 8px rgba(47,227,161,.5)' }

  return (
    <div ref={ref} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, willChange: 'transform', zIndex: 5 }}>
      <motion.div animate={st === 'error' && !reduced ? { x: [0, -4, 4, -3, 3, 0] } : { x: 0 }}
        transition={st === 'error' ? { duration: 0.4, repeat: Infinity } : { duration: 0.2 }}
        style={{ position: 'absolute', left: 0, top: 0, filter: st === 'error' ? 'hue-rotate(-20deg) saturate(1.3)' : undefined }}>
        {/* аура */}
        <motion.div animate={aura} transition={auraT}
          style={{ position: 'absolute', width: R * 4, height: R * 4, left: -R * 2, top: -R * 2, borderRadius: '50%', pointerEvents: 'none',
            background: `radial-gradient(circle, ${col}cc 0%, ${col}44 38%, transparent 68%)` }} />
        {id === 'gemini' && (
          <motion.div animate={aura} transition={{ ...auraT, delay: 0.35 }}
            style={{ position: 'absolute', width: R * 3.4, height: R * 3.4, left: -R * 1.7, top: -R * 1.7, borderRadius: '50%', pointerEvents: 'none',
              background: `radial-gradient(circle at 65% 50%, #b05bff99 0%, transparent 62%)` }} />
        )}
        {id === 'groq' && (
          <div style={{ position: 'absolute', width: R * 2.6, height: R * 2.6, left: -R * 1.3, top: -R * 1.3, borderRadius: '50%', pointerEvents: 'none',
            background: 'conic-gradient(from 0deg, transparent, #ff4a0f, #ffc033, transparent 70%)', filter: 'blur(9px)', opacity: st === 'idle' ? 0.3 : 0.85,
            animation: `flame ${st === 'idle' ? 6 : 1.4}s linear infinite` }} />
        )}

        {/* кольцо (задняя половина) */}
        {id === 'openai' && <div style={{ ...ringStyle, transform: 'rotate(-18deg)', zIndex: 0, opacity: dim }} />}

        {/* тело */}
        <motion.div animate={active && !reduced ? { scale: [1, 1.05, 1] } : { scale: 1 }} transition={{ duration: st === 'writing' ? 0.8 : 1.8, repeat: Infinity, ease: 'easeInOut' }}
          style={{ position: 'absolute', left: -R, top: -R, zIndex: 1, opacity: dim, filter: st === 'offline' ? 'grayscale(1)' : undefined, transition: 'opacity .5s' }}>
          {id === 'gemini' ? (
            <motion.div animate={{ rotate: 360 }} transition={{ duration: reduced ? 0 : st === 'idle' ? 26 : 9, repeat: Infinity, ease: 'linear' }}
              style={{ width: R * 2, height: R * 2, position: 'relative' }}>
              <div style={{ position: 'absolute', left: R * 0.02, top: R * 0.37 }}>
                <Sphere d={R * 1.26} skin={skin} glow="#6f8bffcc" spin={spin} />
              </div>
              <div style={{ position: 'absolute', left: R * 1.12, top: R * 0.52 }}>
                <Sphere d={R * 0.94} skin={{ ...skin, base: 'radial-gradient(circle at 32% 28%, #f1dcff 0%, #b05bff 38%, #6a22c4 72%, #230a4a 100%)' }} glow="#b05bffcc" spin={spin * 0.8} />
              </div>
            </motion.div>
          ) : (
            <Sphere d={R * 2} skin={skin} glow={`${col}aa`} spin={spin} />
          )}
        </motion.div>

        {/* кольцо (передняя половина) */}
        {id === 'openai' && (
          <div style={{ position: 'absolute', left: 0, top: 0, transform: 'rotate(-18deg)', zIndex: 2, opacity: dim, pointerEvents: 'none' }}>
            <div style={{ ...ringStyle, clipPath: 'inset(50% 0 0 0)' }} />
          </div>
        )}

        <AnimatePresence>{active && <TaskOrbit key="orb" R={R} color={meta.color} soft={meta.soft} fast={st === 'writing'} reduced={reduced} />}</AnimatePresence>

        {/* вспышка «передал» */}
        <AnimatePresence>
          {flashAt > 0 && (
            <motion.div key={flashAt} initial={{ scale: 0.7, opacity: 0.95 }} animate={{ scale: 2.6, opacity: 0 }} transition={{ duration: reduced ? 0 : 0.9, ease: 'easeOut' }}
              style={{ position: 'absolute', left: -R, top: -R, width: R * 2, height: R * 2, borderRadius: '50%', zIndex: 3, pointerEvents: 'none',
                border: `3px solid ${meta.soft}`, boxShadow: `0 0 24px ${meta.color}` }} />
          )}
        </AnimatePresence>

        {/* иконка в стеклянном круге */}
        <motion.button type="button" onClick={() => onSelect(id)} aria-label={`${meta.name}: показать поток`}
          animate={reduced ? {} : st === 'thinking' ? { rotate: [0, 8, -8, 0], scale: [1, 1.08, 1] } : st === 'writing' ? { y: [0, -3, 0] } : { y: [0, -2, 0] }}
          transition={{ duration: st === 'thinking' ? 1.8 : st === 'writing' ? 0.55 : 3.6, repeat: Infinity, ease: 'easeInOut' }}
          className="grid place-items-center rounded-full"
          style={{ position: 'absolute', zIndex: 6, width: R * 1.05, height: R * 1.05, left: -R * 0.525, top: -(R + R * 1.05 + 10), cursor: 'pointer',
            background: light ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.09)', border: `1px solid ${col}99`, backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            boxShadow: `0 0 16px ${col}66, inset 0 0 10px rgba(255,255,255,.12)`, opacity: st === 'offline' ? 0.4 : 1 }}>
          {active && <i style={{ position: 'absolute', inset: -3, borderRadius: '50%', zIndex: -1, background: `conic-gradient(from 0deg, transparent 30%, ${col}, #fff0 95%)`, animation: reduced ? undefined : 'spin-cw 1.6s linear infinite',
            WebkitMask: 'radial-gradient(circle, transparent 62%, #000 64%)', mask: 'radial-gradient(circle, transparent 62%, #000 64%)' }} />}
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={st === 'thinking' ? 't' : st === 'writing' ? 'w' : st === 'error' ? 'e' : st === 'offline' ? 'o' : 'i'} className="grid place-items-center"
              initial={{ scale: 0.3, rotate: -90, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} exit={{ scale: 0.3, rotate: 90, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 20 }}>
              {st === 'offline' ? <WifiOff size={R * 0.5} color="#8a93c4" /> : st === 'error' ? <TriangleAlert size={R * 0.55} color="#ff5d6c" /> :
                st === 'thinking' ? <Sparkles size={R * 0.55} color={light ? meta.dark : meta.soft} strokeWidth={2} /> :
                st === 'writing' ? <PenLine size={R * 0.55} color={light ? meta.dark : meta.soft} strokeWidth={2} /> :
                <Icon size={R * 0.55} color={light ? meta.dark : meta.soft} strokeWidth={2} />}
            </motion.span>
          </AnimatePresence>
          <AnimatePresence>
            {st === 'done' && (
              <motion.span key="chk" initial={{ scale: 0, rotate: -120 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 520, damping: 13 }}
                className="absolute -right-1 -top-1 grid place-items-center rounded-full"
                style={{ width: R * 0.5, height: R * 0.5, background: '#2fe3a1', boxShadow: '0 0 12px #2fe3a1' }}>
                <Check size={R * 0.34} color="#022" strokeWidth={4} />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>

        {/* подпись */}
        <button type="button" onClick={() => onSelect(id)} className="text-center"
          style={{ position: 'absolute', zIndex: 6, left: -70, width: 140, top: R + 8, cursor: 'pointer', background: 'none', border: 0, padding: 0 }}>
          <div className="font-display text-[11px] font-bold uppercase tracking-[.16em]"
            style={{ color: labelCol, textShadow: light ? 'none' : `0 0 10px ${meta.color}`, outline: selected ? `1px solid ${meta.color}66` : 'none', borderRadius: 6 }}>{meta.name}</div>
          <div className="mx-auto max-w-[140px] truncate text-[10px] text-slate-300/70" title={model}>{model || '—'}</div>
          <div className="mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-[1px] text-[9px] uppercase tracking-wider"
            style={{ background: `${col}22`, color: col, border: `1px solid ${col}44` }}>
            {active && <i className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: col }} />}
            {STATUS_LABEL[st]}{done > 0 && st !== 'offline' ? ` · ✓${done}` : ''}
          </div>
          <AnimatePresence>
            {active && (
              <motion.div key="task" initial={{ opacity: 0, y: -4, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mx-auto mt-1 max-w-[150px] overflow-hidden">
                <div className="flex items-center justify-center gap-1 truncate text-[9.5px]" style={{ color: labelCol }} title={title}>
                  <Cog size={10} className="shrink-0 animate-spin" style={{ animationDuration: '3s' }} />
                  <span className="truncate">{task ? `${task} · ` : ''}{title || 'задача'}</span>
                </div>
                <div className="mt-0.5 h-[3px] overflow-hidden rounded-full" style={{ background: `${col}33` }}>
                  <div className="shimmer-bar h-full w-full rounded-full" style={{ backgroundColor: `${col}88` }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </button>
      </motion.div>
    </div>
  )
})

export default memo(Planet)
