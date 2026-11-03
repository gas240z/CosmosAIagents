import { forwardRef, memo, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

// Спутник-инструмент. Позицию задаёт движок (орбита вокруг планеты); здесь — вид и реакция на вызов.
const ToolSat = forwardRef(function ToolSat({ tool, R, info, active, light, reduced }, ref) {
  const S = Math.max(20, R * 0.62)
  const Icon = tool.icon
  const at = info?.at || 0
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!at) return
    setShow(true)
    const t = setTimeout(() => setShow(false), 2600)
    return () => clearTimeout(t)
  }, [at])
  const recent = show
  const bad = info && !info.ok
  const edge = recent ? (bad ? '#ff4d5e' : tool.color) : `${tool.color}88`
  return (
    <div ref={ref} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, willChange: 'transform', zIndex: recent ? 8 : 4 }}>
      <motion.div key={at} initial={at && !reduced ? { scale: 1.7 } : false} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 14 }}
        title={tool.label + (info?.count ? ` · вызовов: ${info.count}` : '')}
        style={{ position: 'absolute', left: -S / 2, top: -S / 2, width: S, height: S, borderRadius: '50%', display: 'grid', placeItems: 'center',
          opacity: recent ? 1 : active ? 0.95 : 0.55, transition: 'opacity .4s',
          background: light ? `rgba(255,255,255,.85)` : 'rgba(255,255,255,.08)', border: `1px solid ${edge}`,
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          boxShadow: recent ? `0 0 16px 3px ${bad ? '#ff4d5e' : tool.color}aa, inset 0 0 8px ${tool.color}55` : `0 0 8px ${tool.color}44` }}>
        <Icon size={S * 0.52} color={light ? tool.color : tool.color} strokeWidth={2.2} />
        {info?.count > 0 && (
          <span style={{ position: 'absolute', right: -4, bottom: -4, minWidth: 13, height: 13, padding: '0 3px', borderRadius: 7, fontSize: 8.5, fontWeight: 700, lineHeight: '13px', textAlign: 'center',
            background: tool.color, color: '#10123a', boxShadow: `0 0 6px ${tool.color}` }}>{info.count}</span>
        )}
      </motion.div>
      <AnimatePresence>
        {recent && (
          <motion.div key={at} initial={{ opacity: 0, y: 4, scale: 0.85 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            className="pointer-events-none whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[9.5px]"
            style={{ position: 'absolute', left: S / 2 + 4, top: -S / 2 - 8, background: light ? 'rgba(255,255,255,.95)' : 'rgba(10,12,44,.92)', color: light ? '#1d2150' : '#e6ecff',
              border: `1px solid ${bad ? '#ff4d5e' : tool.color}`, boxShadow: `0 0 12px ${bad ? '#ff4d5e' : tool.color}66` }}>
            <b style={{ color: bad ? '#ff4d5e' : tool.color }}>{tool.id}</b>{info?.arg ? ` ${info.arg}` : ''} <span style={{ opacity: 0.75 }}>{bad ? '✖' : '✓'} {info?.summary}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

export default memo(ToolSat)
