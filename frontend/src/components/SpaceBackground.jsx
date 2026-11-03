import { useEffect, useRef } from 'react'
import { prefersReduced } from '../reducedMotion'

const rnd = (a, b) => a + Math.random() * (b - a)

// Туманность рисуется один раз в оффскрин-холст, затем медленно дрейфует.
function makeNebula(w, h, palette, blobs, light) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  g.globalCompositeOperation = light ? 'source-over' : 'lighter'
  for (let i = 0; i < blobs; i++) {
    const col = palette[i % palette.length]
    const cx = rnd(0.1, 0.9) * w
    const cy = rnd(0.1, 0.9) * h
    const r = rnd(0.18, 0.42) * Math.min(w, h)
    for (let k = 0; k < 7; k++) {
      const x = cx + rnd(-0.5, 0.5) * r
      const y = cy + rnd(-0.5, 0.5) * r
      const rr = r * rnd(0.35, 0.8)
      const gr = g.createRadialGradient(x, y, 0, x, y, rr)
      gr.addColorStop(0, `rgba(${col},${light ? rnd(0.16, 0.28) : rnd(0.1, 0.2)})`)
      gr.addColorStop(0.5, `rgba(${col},0.05)`)
      gr.addColorStop(1, `rgba(${col},0)`)
      g.fillStyle = gr
      g.fillRect(x - rr, y - rr, rr * 2, rr * 2)
    }
  }
  return c
}

export default function SpaceBackground({ light = false }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    const reduced = prefersReduced()
    let W = 0, H = 0, dpr = 1, raf = 0, last = performance.now(), t = 0
    let layers = [], neb = [], comets = [], nextComet = rnd(3, 7)
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 }

    const build = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      W = window.innerWidth
      H = window.innerHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      canvas.style.width = W + 'px'
      canvas.style.height = H + 'px'
      const area = (W * H) / 1e6
      const spec = [
        { n: 140 * area, par: 6, drift: 1.2, size: [0.4, 0.9], a: [0.25, 0.6] },
        { n: 70 * area, par: 16, drift: 2.6, size: [0.7, 1.3], a: [0.4, 0.8] },
        { n: 26 * area, par: 34, drift: 5, size: [1.1, 2], a: [0.6, 1] },
      ]
      layers = spec.map((s) => ({
        ...s,
        stars: Array.from({ length: Math.max(12, Math.round(s.n)) }, () => ({
          x: Math.random() * W, y: Math.random() * H, r: rnd(...s.size), a: rnd(...s.a),
          ph: rnd(0, 6.28), sp: rnd(0.6, 2.4),
          hue: light ? (Math.random() < 0.3 ? '255,150,60' : Math.random() < 0.4 ? '236,72,153' : '79,70,229') : Math.random() < 0.18 ? '170,190,255' : Math.random() < 0.12 ? '255,200,170' : '235,240,255',
        })),
      }))
      const nw = Math.round(W * 1.5), nh = Math.round(H * 1.5)
      neb = [
        { img: makeNebula(nw, nh, light ? ['255,150,200', '150,170,255', '190,150,255'] : ['90,60,220', '40,70,200', '150,50,200'], 7, light), sp: 0.006, par: 10, ph: 0 },
        { img: makeNebula(nw, nh, light ? ['255,190,150', '130,200,255', '200,160,255'] : ['200,60,170', '60,140,220', '110,60,230'], 5, light), sp: 0.01, par: 22, ph: 2 },
      ]
    }

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.85)
      bg.addColorStop(0, light ? '#fbf3ff' : '#120a3a')
      bg.addColorStop(0.45, light ? '#e4e8ff' : '#0a0a2c')
      bg.addColorStop(1, light ? '#cfd9ff' : '#02030d')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)

      ctx.globalCompositeOperation = light ? 'source-over' : 'lighter'
      for (const n of neb) {
        const ox = Math.sin(t * n.sp + n.ph) * 60 + mouse.x * n.par
        const oy = Math.cos(t * n.sp * 0.8 + n.ph) * 40 + mouse.y * n.par
        ctx.globalAlpha = light ? 0.8 : 0.9
        ctx.drawImage(n.img, -(n.img.width - W) / 2 + ox, -(n.img.height - H) / 2 + oy)
      }
      ctx.globalAlpha = 1

      for (const L of layers) {
        const ox = mouse.x * L.par, oy = mouse.y * L.par
        for (const s of L.stars) {
          const x = (((s.x - t * L.drift + ox) % W) + W) % W
          const y = (((s.y + oy) % H) + H) % H
          const tw = reduced ? 1 : 0.65 + 0.35 * Math.sin(t * s.sp + s.ph)
          ctx.fillStyle = `rgba(${s.hue},${s.a * tw * (light ? 0.55 : 1)})`
          ctx.beginPath()
          ctx.arc(x, y, s.r, 0, 6.283)
          ctx.fill()
          if (s.r > 1.5) {
            ctx.fillStyle = `rgba(${s.hue},${0.08 * tw})`
            ctx.fillRect(x - s.r * 5, y - 0.4, s.r * 10, 0.8)
            ctx.fillRect(x - 0.4, y - s.r * 5, 0.8, s.r * 10)
          }
        }
      }

      for (const c of comets) {
        const len = 190
        const gx = c.x - Math.cos(c.a) * len, gy = c.y - Math.sin(c.a) * len
        const g = ctx.createLinearGradient(c.x, c.y, gx, gy)
        g.addColorStop(0, light ? 'rgba(236,72,153,.95)' : 'rgba(220,235,255,.95)')
        g.addColorStop(0.3, light ? 'rgba(124,92,255,.4)' : 'rgba(140,170,255,.35)')
        g.addColorStop(1, light ? 'rgba(124,92,255,0)' : 'rgba(120,120,255,0)')
        ctx.strokeStyle = g
        ctx.lineWidth = 1.8
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(gx, gy); ctx.stroke()
        const hg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 9)
        hg.addColorStop(0, light ? 'rgba(236,72,153,1)' : 'rgba(255,255,255,1)'); hg.addColorStop(1, light ? 'rgba(124,92,255,0)' : 'rgba(160,190,255,0)')
        ctx.fillStyle = hg
        ctx.beginPath(); ctx.arc(c.x, c.y, 9, 0, 6.283); ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    }

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      t += dt
      mouse.x += (mouse.tx - mouse.x) * 0.04
      mouse.y += (mouse.ty - mouse.y) * 0.04
      nextComet -= dt
      if (nextComet <= 0) {
        nextComet = rnd(7, 16)
        const fromTop = Math.random() < 0.6
        comets.push({
          x: fromTop ? rnd(W * 0.2, W * 1.1) : W + 40, y: fromTop ? -40 : rnd(0, H * 0.5),
          a: Math.PI * rnd(0.68, 0.82), v: rnd(420, 700),
        })
      }
      comets = comets.filter((c) => {
        c.x += Math.cos(c.a) * c.v * dt
        c.y += Math.sin(c.a) * c.v * dt
        return c.x > -250 && c.y < H + 250
      })
      draw()
      raf = requestAnimationFrame(frame)
    }

    const onMove = (e) => {
      mouse.tx = (e.clientX / window.innerWidth - 0.5) * -1
      mouse.ty = (e.clientY / window.innerHeight - 0.5) * -1
    }
    const onResize = () => { build(); if (reduced) draw() }

    build()
    if (reduced) draw()
    else {
      raf = requestAnimationFrame(frame)
      window.addEventListener('mousemove', onMove)
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('resize', onResize)
    }
  }, [light])

  return <canvas ref={ref} className="fixed inset-0 -z-10" aria-hidden="true" />
}
