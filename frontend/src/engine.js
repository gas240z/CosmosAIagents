// Движок сцены: орбиты, движение планет, корабли по кривым Безье, частицы, рябь, сверхновая.
import { prefersReduced } from './reducedMotion'

const TAU = Math.PI * 2
const rnd = (a, b) => a + Math.random() * (b - a)
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const GOLD = '#ffd98a'

const ORBITS = {
  anthropic: { f: 0.56, a0: -2.2, w: 0.04 },
  openai: { f: 0.72, a0: 0.55, w: 0.04 },
  groq: { f: 0.88, a0: 2.5, w: 0.04 },
  gemini: { f: 1.0, a0: -0.55, w: 0.04 },
}

export class StageEngine {
  constructor({ back, fx, colors, tools = [] }) {
    this.back = back
    this.fx = fx
    this.bctx = back.getContext('2d')
    this.fctx = fx.getContext('2d')
    this.colors = { core: GOLD, ...colors }
    this.nodes = {}
    this.tools = tools
    this.toolColor = Object.fromEntries(tools.map((t) => [t.id, t.color]))
    this.links = []
    this.status = {}
    this.W = 0
    this.H = 0
    this.R = 34
    this.t = 0 // время орбит (замирает при reduced motion)
    this.clock = 0 // реальное время анимаций
    this.parts = []
    this.ships = []
    this.flashes = []
    this.ripples = []
    this.waves = []
    this.screen = null
    this.reduced = prefersReduced()
    this.light = false
    this.last = performance.now()
    this.raf = 0
    this.frame = this.frame.bind(this)
    this.raf = requestAnimationFrame(this.frame)
  }

  register(id, el) { if (el) this.nodes[id] = el }
  setStatus(id, s) { this.status[id] = s }
  setLight(v) { this.light = !!v }
  hi(color) { return this.light ? color : '#ffffff' }

  resize(W, H, dpr) {
    this.W = W
    this.H = H
    this.dpr = dpr
    for (const c of [this.back, this.fx]) {
      c.width = W * dpr
      c.height = H * dpr
      c.style.width = W + 'px'
      c.style.height = H + 'px'
    }
    this.R = Math.max(26, Math.min(44, Math.min(W, H) * 0.075))
    this.padX = Math.max(60, this.R * 2.2)
    this.padY = this.R * 3 + 22
  }

  orbitRadii(id) {
    const o = ORBITS[id]
    const ax = Math.max(60, this.W / 2 - this.padX)
    const ay = Math.max(60, this.H / 2 - this.padY)
    return { rx: ax * o.f, ry: ay * o.f }
  }

  satPos(agent, tool) {
    const n = this.tools.length || 1
    const k = Math.max(0, this.tools.findIndex((t) => t.id === tool))
    const idx = Math.max(0, Object.keys(ORBITS).indexOf(agent))
    const a = idx * 1.3 + (k * TAU) / n + (idx % 2 ? -1 : 1) * this.t * 0.3
    const p = this.pos(agent), rs = this.R * 2.3
    return { x: p.x + Math.cos(a) * rs, y: p.y + Math.sin(a) * rs * 0.85, vx: 0, vy: 0 }
  }

  pos(id) {
    if (id.startsWith('tool:')) { const [, ag, tl] = id.split(':'); return this.satPos(ag, tl) }
    const cx = this.W / 2, cy = this.H / 2
    if (id === 'core' || !ORBITS[id]) return { x: cx, y: cy, vx: 0, vy: 0 }
    const o = ORBITS[id]
    const { rx, ry } = this.orbitRadii(id)
    const a = o.a0 + o.w * this.t
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a), vx: -rx * Math.sin(a) * o.w, vy: ry * Math.cos(a) * o.w }
  }

  col(id) { return id.startsWith('tool:') ? this.toolColor[id.split(':')[2]] || GOLD : this.colors[id] || GOLD }
  radius(id) { return id === 'core' ? this.R * 1.15 : id.startsWith('tool:') ? this.R * 0.3 : this.R }

  // ------------------------------------------------------------ события
  ship(kind, from, to) {
    const color = kind === 'dispatch' ? this.col(to) : this.col(from)
    if (this.reduced) { this.flash(to, color); return }
    this.flash(from, color, 0.55)
    this.ships.push({ kind, from, to, t0: this.clock, dur: kind === 'handoff' ? 2 : 1.45, side: Math.random() < 0.5 ? 1 : -1, color })
  }

  // вызов инструмента: луч-связь планета → спутник и обратно (цвет возврата = успех/ошибка)
  toolCall(agent, tool, ok) {
    const color = this.toolColor[tool] || GOLD
    if (!ORBITS[agent]) { this.flash('core', color, 0.7); return }
    const sat = `tool:${agent}:${tool}`
    if (this.reduced) { this.flash(sat, color); return }
    this.links.push({ agent, tool, sat, color, ret: ok ? '#2fe3a1' : '#ff4d5e', t0: this.clock, dur: 1.5, mid: false, side: Math.random() < 0.5 ? 1 : -1 })
  }

  flash(id, color, dur = 0.8) { this.flashes.push({ id, t0: this.clock, dur, color: color || this.col(id) }) }

  arrive(s) {
    this.flash(s.to, s.color, 0.9)
    if (this.reduced) return
    for (let i = 0; i < 3; i++) this.ripples.push({ id: s.to, t0: this.clock + i * 0.18, dur: 1.3, color: s.color })
    const p = this.pos(s.to)
    this.burst(p.x, p.y, s.color, 22, 40, 150)
  }

  burst(x, y, color, n, v0, v1, life = [0.4, 0.9]) {
    const [r, g, b] = rgb(color)
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), v = rnd(v0, v1)
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rnd(...life), size: rnd(1, 2.4), r, g, b, drag: 0.96, kind: 'spark' })
    }
  }

  supernova() {
    const p = this.pos('core')
    this.screen = { t0: this.clock, dur: 1.6 }
    const maxR = Math.hypot(this.W, this.H) * 0.6
    ;['#ffffff', '#ffd98a', '#a54bff', '#4fa8ff'].forEach((c, i) =>
      this.waves.push({ x: p.x, y: p.y, t0: this.clock + i * 0.14, dur: 2.4, maxR, color: c }))
    if (this.reduced) return
    const palette = ['#ff7a59', '#2fe3a1', '#ff8a1f', '#7a8bff', '#ffd98a', '#ffffff', '#ff5fb0']
    this.burst(p.x, p.y, '#ffffff', 90, 120, 720, [1, 2.2])
    this.burst(p.x, p.y, '#ffd98a', 90, 80, 520, [1, 2.4])
    this.burst(p.x, p.y, '#a54bff', 70, 60, 420, [1.2, 2.6])
    for (let i = 0; i < 320; i++) {
      const a = rnd(-Math.PI, 0.3), v = rnd(180, 820), [r, g, b] = rgb(palette[i % palette.length])
      this.parts.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 0, max: rnd(3, 5.2), size: rnd(3, 7),
        r, g, b, drag: 0.987, grav: 280, kind: 'conf', rot: rnd(0, TAU), vr: rnd(-9, 9) })
    }
  }

  // ------------------------------------------------------------ цикл
  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.clock += dt
    if (!this.reduced) this.t += dt
    if (this.W) {
      this.place()
      this.drawBack()
      this.drawFx(dt)
    }
    this.raf = requestAnimationFrame(this.frame)
  }

  place() {
    for (const id in this.nodes) {
      const p = this.pos(id)
      this.nodes[id].style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`
    }
  }

  drawBack() {
    const c = this.bctx
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    c.clearRect(0, 0, this.W, this.H)
    for (const id in ORBITS) {
      const { rx, ry } = this.orbitRadii(id)
      const [r, g, b] = rgb(this.col(id))
      const act = this.status[id] && this.status[id] !== 'idle' && this.status[id] !== 'offline'
      c.beginPath()
      c.ellipse(this.W / 2, this.H / 2, rx, ry, 0, 0, TAU)
      c.lineWidth = act ? 5 : 3
      c.strokeStyle = `rgba(${r},${g},${b},${act ? 0.07 : 0.03})`
      c.setLineDash([])
      c.stroke()
      c.lineWidth = 1
      c.strokeStyle = `rgba(${r},${g},${b},${this.light ? (act ? 0.85 : 0.45) : (act ? 0.5 : 0.2)})`
      c.setLineDash([2, 7])
      c.stroke()
    }
    c.setLineDash([])
  }

  bez(s, e) {
    const a = this.pos(s.from), b = this.pos(s.to)
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len, ny = dx / len, off = len * 0.38 * s.side
    const c1 = { x: a.x + dx * 0.25 + nx * off, y: a.y + dy * 0.25 + ny * off }
    const c2 = { x: a.x + dx * 0.75 + nx * off * 0.7, y: a.y + dy * 0.75 + ny * off * 0.7 }
    const u = 1 - e
    return {
      x: u * u * u * a.x + 3 * u * u * e * c1.x + 3 * u * e * e * c2.x + e * e * e * b.x,
      y: u * u * u * a.y + 3 * u * u * e * c1.y + 3 * u * e * e * c2.y + e * e * e * b.y,
    }
  }

  glow(c, x, y, rad, [r, g, b], a) {
    const gr = c.createRadialGradient(x, y, 0, x, y, rad)
    gr.addColorStop(0, `rgba(${r},${g},${b},${a})`)
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`)
    c.fillStyle = gr
    c.beginPath()
    c.arc(x, y, rad, 0, TAU)
    c.fill()
  }

  spawn(x, y, vx, vy, color, max, size = 1.6, drag = 0.95) {
    if (this.parts.length > 2600) return
    const [r, g, b] = rgb(color)
    this.parts.push({ x, y, vx, vy, life: 0, max, size, r, g, b, drag, kind: 'spark' })
  }

  statusFx(dt) {
    if (this.reduced) return
    const c = this.fctx
    for (const id in ORBITS) {
      const st = this.status[id]
      const p = this.pos(id), R = this.R
      const color = this.col(id), rgbc = rgb(color)
      if (st === 'thinking') {
        for (let k = 0; k < 7; k++) {
          for (let j = 0; j < 4; j++) {
            const ang = this.clock * 2.4 + (k * TAU) / 7 - j * 0.13
            this.glow(c, p.x + Math.cos(ang) * (R + 17), p.y + Math.sin(ang) * (R + 17), 4 - j * 0.8, rgbc, 0.9 - j * 0.22)
          }
        }
      } else if (st === 'writing') {
        const n = Math.round(95 * dt + Math.random())
        for (let i = 0; i < n; i++) {
          const a = rnd(0, TAU), v = rnd(70, 190)
          this.spawn(p.x + Math.cos(a) * R, p.y + Math.sin(a) * R, Math.cos(a) * v, Math.sin(a) * v, Math.random() < 0.4 ? this.hi(color) : color, rnd(0.35, 0.8))
        }
      } else if (st === 'error') {
        if (Math.random() < 0.7) this.spawn(p.x + rnd(-R, R), p.y + rnd(-R, R), rnd(-60, 60), rnd(-90, 20), '#ff3b4d', rnd(0.3, 0.7), 1.8)
      }
      if (id === 'groq') { // шлейф скорости
        const sp = Math.hypot(p.vx, p.vy) || 1
        const dx = -p.vx / sp, dy = -p.vy / sp
        const act = st && st !== 'idle' && st !== 'offline'
        const n = Math.round((act ? 140 : 38) * dt + Math.random() * 0.8)
        for (let i = 0; i < n; i++) {
          const off = rnd(-R * 0.55, R * 0.55)
          this.spawn(p.x + dx * R * 0.7 - dy * off, p.y + dy * R * 0.7 + dx * off, dx * rnd(30, 120) + rnd(-12, 12), dy * rnd(30, 120) + rnd(-12, 12),
            Math.random() < 0.5 ? '#ffb347' : '#ff5a1f', rnd(0.5, 1.1), rnd(1.2, 2.6), 0.97)
        }
      }
    }
  }

  drawFx(dt) {
    const c = this.fctx
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    c.clearRect(0, 0, this.W, this.H)
    const OP = this.light ? 'source-over' : 'lighter'
    c.globalCompositeOperation = OP
    this.statusFx(dt)

    // корабли
    this.ships = this.ships.filter((s) => {
      const pr = (this.clock - s.t0) / s.dur
      if (pr >= 1) { this.arrive(s); return false }
      const e = ease(Math.max(0, pr))
      const h = this.bez(s, e), h2 = this.bez(s, Math.min(1, e + 0.015))
      const ang = Math.atan2(h2.y - h.y, h2.x - h.x)
      const col = rgb(s.color)
      for (let i = 0; i < 4; i++) {
        this.spawn(h.x + rnd(-2, 2), h.y + rnd(-2, 2), rnd(-18, 18) - Math.cos(ang) * 20, rnd(-18, 18) - Math.sin(ang) * 20,
          i % 2 ? this.hi(s.color) : s.color, rnd(0.6, 1.1), rnd(1.4, 3), 0.93)
      }
      this.glow(c, h.x, h.y, 22, col, 0.55)
      this.glow(c, h.x, h.y, 8, this.light ? col : [255, 255, 255], 0.95)
      c.save()
      c.translate(h.x, h.y)
      c.rotate(ang)
      c.fillStyle = this.light ? s.color : '#fff'
      c.beginPath(); c.moveTo(9, 0); c.lineTo(-5, 4.5); c.lineTo(-2.5, 0); c.lineTo(-5, -4.5); c.closePath(); c.fill()
      c.restore()
      return true
    })

    // связи планета ↔ инструмент
    this.links = this.links.filter((l) => {
      const p = (this.clock - l.t0) / l.dur
      if (p >= 1) { this.flash(l.agent, l.ret, 0.6); return false }
      const a = this.pos(l.agent), b = this.pos(l.sat)
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1
      const cx = (a.x + b.x) / 2 - (dy / len) * len * 0.3 * l.side, cy = (a.y + b.y) / 2 + (dx / len) * len * 0.3 * l.side
      const q = (t) => { const u = 1 - t; return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y } }
      const al = Math.sin(Math.PI * Math.min(1, p))
      const [lr, lg, lb] = rgb(l.color)
      c.beginPath(); c.moveTo(a.x, a.y); c.quadraticCurveTo(cx, cy, b.x, b.y)
      c.lineWidth = 1 + 1.8 * al
      c.strokeStyle = `rgba(${lr},${lg},${lb},${0.15 + 0.6 * al})`
      c.setLineDash([5, 5]); c.lineDashOffset = -this.clock * 70; c.stroke(); c.setLineDash([])
      const out = p < 0.5
      const h = q(out ? ease(p * 2) : 1 - ease((p - 0.5) * 2))
      const col = out ? l.color : l.ret
      for (let i = 0; i < 3; i++) this.spawn(h.x + rnd(-1.5, 1.5), h.y + rnd(-1.5, 1.5), rnd(-14, 14), rnd(-14, 14), i === 0 ? this.hi(col) : col, rnd(0.4, 0.8), rnd(1.2, 2.4), 0.93)
      this.glow(c, h.x, h.y, 15, rgb(col), 0.75)
      this.glow(c, h.x, h.y, 5, this.light ? rgb(col) : [255, 255, 255], 0.95)
      if (!out && !l.mid) {
        l.mid = true
        this.flash(l.sat, l.color, 0.85)
        for (let i = 0; i < 2; i++) this.ripples.push({ id: l.sat, t0: this.clock + i * 0.15, dur: 0.9, color: l.color })
        const s = this.pos(l.sat); this.burst(s.x, s.y, l.color, 14, 30, 110)
      }
      return true
    })

    // вспышки
    this.flashes = this.flashes.filter((f) => {
      const p = (this.clock - f.t0) / f.dur
      if (p >= 1) return false
      const q = this.pos(f.id)
      this.glow(c, q.x, q.y, this.radius(f.id) * (1.2 + p * 2.6), rgb(f.color), Math.pow(1 - p, 1.6) * 0.95)
      return true
    })

    // рябь
    this.ripples = this.ripples.filter((r) => {
      const p = (this.clock - r.t0) / r.dur
      if (p >= 1) return false
      if (p < 0) return true
      const q = this.pos(r.id), [cr, cg, cb] = rgb(r.color)
      c.beginPath()
      c.arc(q.x, q.y, this.radius(r.id) * 1.05 + this.R * (r.id.startsWith('tool:') ? 0.9 : 3.2) * ease(p), 0, TAU)
      c.lineWidth = 2.2 * (1 - p) + 0.4
      c.strokeStyle = `rgba(${cr},${cg},${cb},${(1 - p) * 0.8})`
      c.stroke()
      return true
    })

    // ударные волны сверхновой
    this.waves = this.waves.filter((w) => {
      const p = (this.clock - w.t0) / w.dur
      if (p >= 1) return false
      if (p < 0) return true
      const [cr, cg, cb] = rgb(w.color)
      c.beginPath()
      c.arc(w.x, w.y, w.maxR * (1 - Math.pow(1 - p, 3)), 0, TAU)
      c.lineWidth = 10 * (1 - p) + 1
      c.strokeStyle = `rgba(${cr},${cg},${cb},${(1 - p) * 0.7})`
      c.stroke()
      return true
    })

    // частицы
    const keep = []
    for (const p of this.parts) {
      p.life += dt
      if (p.life >= p.max) continue
      const k = Math.pow(p.drag, dt * 60)
      p.vx *= k
      p.vy = p.vy * k + (p.grav || 0) * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      const a = Math.pow(1 - p.life / p.max, 1.4)
      if (p.kind === 'conf') {
        p.rot += p.vr * dt
        c.globalCompositeOperation = 'source-over'
        c.save()
        c.translate(p.x, p.y)
        c.rotate(p.rot)
        c.scale(1, Math.abs(Math.cos(p.rot * 1.7)) * 0.9 + 0.1)
        c.fillStyle = `rgba(${p.r},${p.g},${p.b},${Math.min(1, a * 1.6)})`
        c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        c.restore()
        c.globalCompositeOperation = OP
      } else {
        c.fillStyle = `rgba(${p.r},${p.g},${p.b},${a})`
        c.beginPath()
        c.arc(p.x, p.y, p.size * (0.5 + a * 0.6), 0, TAU)
        c.fill()
      }
      keep.push(p)
    }
    this.parts = keep

    // вспышка экрана
    if (this.screen) {
      const p = (this.clock - this.screen.t0) / this.screen.dur
      if (p >= 1) this.screen = null
      else {
        const q = this.pos('core')
        this.glow(c, q.x, q.y, Math.hypot(this.W, this.H) * (0.25 + p * 0.5), this.light ? [255, 190, 120] : [255, 240, 255], Math.pow(1 - p, 2) * 0.85)
      }
    }
    c.globalCompositeOperation = 'source-over'
  }

  destroy() { cancelAnimationFrame(this.raf) }
}
