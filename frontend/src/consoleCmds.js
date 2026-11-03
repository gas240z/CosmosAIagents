// Команды бортового компьютера (чисто клиентские, поверх уже полученных событий).
import { notifyMemory } from './useMemory'
import { ACTORS, AGENTS, ORDER, PHASES, STATUS_LABEL, TOOLS } from './agents'

export const COMMANDS = {
  help: 'список команд',
  status: 'сводка миссии',
  agents: 'агенты, модели и статусы',
  tasks: 'задачи и зависимости',
  files: 'файлы проекта',
  tools: 'вызовы инструментов агентов',
  cat: 'cat <файл> — показать содержимое',
  open: 'open <файл> — открыть в окне',
  focus: 'focus <агент|orch> — переключить поток',
  contract: 'контракт проекта',
  review: 'результат ревью',
  logs: 'последние события и сбои',
  memory: 'что запомнил оркестратор',
  remember: 'remember <текст> — запомнить',
  forget: 'forget <id|all> — забыть',
  theme: 'theme light|dark — тема',
  follow: 'follow on|off — автопрокрутка',
  run: 'run <запрос> — запустить миссию',
  cancel: 'отменить текущую миссию',
  clear: 'очистить консоль',
}

const GLYPH = { pending: '○', running: '◐', done: '✓', failed: '✖' }
const o = (t, k = 'out') => ({ k, t })
const kb = (b) => (b > 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`)

export function resolveActor(q) {
  q = (q || '').toLowerCase()
  if (!q) return null
  if ('orchestrator'.startsWith(q) || q === 'core' || q === 'оркестратор') return 'orchestrator'
  return ORDER.find((id) => id.startsWith(q) || AGENTS[id].name.toLowerCase().startsWith(q)) || null
}

export async function execute(line, ctx) {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  const arg = rest.join(' ')
  const s = ctx.state
  switch ((cmd || '').toLowerCase()) {
    case 'help':
    case '?':
      return [o('Доступные команды (Tab — автодополнение, ↑/↓ — история):', 'dim'), ...Object.entries(COMMANDS).map(([c, d]) => o(`  ${c.padEnd(9)} ${d}`))]
    case 'status': {
      const done = s.tasks.filter((t) => s.taskState[t.id]?.status === 'done').length
      const act = ORDER.filter((id) => ['thinking', 'writing'].includes(s.agents[id].status))
      const ph = PHASES.find((p) => p.id === s.phase)?.label || s.phaseLabel || '—'
      return [
        o(`Миссия: ${s.runId ? (s.done ? 'выполнена ✓' : s.fatal ? 'прервана ✖' : s.running ? 'в полёте' : 'ожидание') : 'не запущена'}`),
        o(`Запрос:  ${s.prompt || '—'}`),
        o(`Фаза:    ${ph}`),
        o(`Задачи:  ${done}/${s.tasks.length} · файлов: ${s.files.filter((f) => f.state === 'done').length}`),
        o(`Активны: ${act.length ? act.map((id) => AGENTS[id].name).join(', ') : 'никто'}`),
        ...(s.fatal ? [o(`Ошибка:  ${s.fatal}`, 'err')] : []),
      ]
    }
    case 'agents':
    case 'models':
      return [
        o(`Оркестратор · ${s.orch?.provider || '—'} / ${s.orch?.model || '—'}`, 'ok'),
        ...ORDER.map((id) => {
          const a = s.agents[id]
          return o(`${AGENTS[id].name.padEnd(10)} ${(a.available ? STATUS_LABEL[a.status] : 'нет ключа').padEnd(9)} ✓${a.done}  ${a.model || '—'}${a.title && ['thinking', 'writing'].includes(a.status) ? '  ← ' + a.title : ''}`)
        }),
      ]
    case 'tasks':
      if (!s.tasks.length) return [o('Плана пока нет.', 'dim')]
      return s.tasks.map((t) => {
        const st = s.taskState[t.id]?.status || 'pending'
        return o(`${GLYPH[st]} ${t.id.padEnd(5)} ${(ACTORS[s.taskState[t.id]?.agent || t.agent]?.name || '').padEnd(10)} ${t.title}${t.depends_on.length ? '  ⇠ ' + t.depends_on.join(',') : ''}`, st === 'failed' ? 'err' : st === 'done' ? 'ok' : 'out')
      })
    case 'tools': {
      const rows = ORDER.map((id) => {
        const t = s.tools?.[id] || {}
        return o(`${AGENTS[id].name.padEnd(10)} ` + TOOLS.map((x) => `${x.id}×${t[x.id]?.count || 0}`).join('  '))
      })
      const last = (s.toolLog || []).slice(-8).map((l) => o(`  ${l.ok ? '✓' : '✖'} ${(ACTORS[l.agent]?.name || l.agent).padEnd(11)} ${l.tool}(${l.arg || ''}) → ${l.summary}`, l.ok ? 'out' : 'err'))
      return [o('Инструменты (спутники вокруг планет):', 'dim'), ...rows, ...(last.length ? [o('Последние вызовы:', 'dim'), ...last] : [o('Вызовов пока не было.', 'dim')])]
    }
    case 'files':
      if (!s.files.length) return [o('Файлов пока нет.', 'dim')]
      return s.files.map((f) => o(`${f.state === 'done' ? '✓' : '…'} ${f.path}  ${f.state === 'done' ? kb(f.size) : 'пишется'}  [${ACTORS[f.agent]?.name || f.agent}]`))
    case 'cat': {
      if (!arg) return [o('Использование: cat <файл>', 'err')]
      const f = s.files.find((x) => x.path === arg) || s.files.find((x) => x.path.endsWith(arg))
      if (!f) return [o(`Нет такого файла: ${arg}`, 'err')]
      try {
        const j = await (await fetch(`/api/runs/${s.runId}/file?path=${encodeURIComponent(f.path)}`)).json()
        const ln = (j.content || '').split('\n')
        return [o(`── ${f.path} ──`, 'dim'), ...ln.slice(0, 80).map((x) => o(x)), ...(ln.length > 80 ? [o(`… ещё ${ln.length - 80} строк — open ${f.path}`, 'dim')] : [])]
      } catch { return [o('Не удалось прочитать файл', 'err')] }
    }
    case 'open': {
      const f = s.files.find((x) => x.path === arg) || s.files.find((x) => x.path.endsWith(arg))
      if (!f) return [o(`Нет такого файла: ${arg || ''}`, 'err')]
      ctx.openFile(f.path)
      return [o(`Открываю ${f.path}`, 'ok')]
    }
    case 'focus': {
      const id = resolveActor(arg)
      if (!id) return [o('Использование: focus anthropic|openai|groq|gemini|orch', 'err')]
      ctx.focus(id)
      return [o(`Поток: ${ACTORS[id].name}`, 'ok')]
    }
    case 'contract': {
      const c = s.contract
      if (!c) return [o('Контракт ещё не зафиксирован.', 'dim')]
      return [o(`${c.project_name} — ${c.summary}`, 'ok'), o(`Стек: ${c.stack}`), o(`Правила: ${c.conventions}`), ...c.files.map((f) => o(`  ${f.path} — ${f.purpose}`))]
    }
    case 'review': {
      const r = s.review
      if (!r) return [o('Ревью ещё не проводилось.', 'dim')]
      if (r.state === 'start') return [o('Оркестратор сверяет файлы…', 'dim')]
      return [o(r.ok ? 'Ревью: несостыковок нет ✓' : `Ревью: найдено проблем — ${r.issues.length}`, r.ok ? 'ok' : 'err'), o(r.summary || ''), ...r.issues.map((i) => o(`  • ${(i.files || []).join(', ')}: ${i.problem}`))]
    }
    case 'memory': {
      try {
        const items = (await (await fetch('/api/memory')).json()).items || []
        if (!items.length) return [o('Память пуста. remember <текст> — добавить.', 'dim')]
        return items.slice().reverse().map((i) => o(`${i.kind === 'note' ? '✎' : '▣'} ${i.id}  ${i.text}`))
      } catch { return [o('Не удалось прочитать память', 'err')] }
    }
    case 'remember': {
      if (!arg) return [o('Использование: remember <текст>', 'err')]
      const r = await fetch('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: arg }) })
      notifyMemory()
      return r.ok ? [o('Запомнил ✓', 'ok')] : [o('Слишком коротко или уже запомнено', 'err')]
    }
    case 'forget': {
      if (!arg) return [o('Использование: forget <id|all> (id — в команде memory)', 'err')]
      const r = arg === 'all' ? await fetch('/api/memory', { method: 'DELETE' }) : await fetch(`/api/memory/${encodeURIComponent(arg)}`, { method: 'DELETE' })
      notifyMemory()
      return r.ok ? [o(arg === 'all' ? 'Память очищена' : 'Забыл ✓', 'ok')] : [o(`Нет записи ${arg}`, 'err')]
    }
    case 'logs':
      return s.logs.length ? s.logs.slice(-10).map((l) => o(`[${l.level || 'warn'}] ${l.message}`, 'err')) : [o('Сбоев и повторов не было.', 'ok')]
    case 'theme': {
      const v = (arg || 'toggle').toLowerCase()
      const light = v === 'light' || v === 'светлая' ? true : v === 'dark' || v === 'тёмная' ? false : !ctx.light
      ctx.setLight(light)
      return [o(`Тема: ${light ? 'светлая' : 'тёмная'}`, 'ok')]
    }
    case 'follow':
      ctx.setFollow(arg !== 'off')
      return [o(`Автопрокрутка: ${arg !== 'off' ? 'вкл' : 'выкл'}`, 'ok')]
    case 'run':
      if (!arg) return [o('Использование: run <запрос>', 'err')]
      if (s.running) return [o('Миссия уже идёт. Сначала cancel.', 'err')]
      ctx.start(arg)
      return [o('Запуск миссии…', 'ok')]
    case 'cancel':
      if (!s.running) return [o('Нечего отменять.', 'dim')]
      ctx.cancel()
      return [o('Отмена…', 'ok')]
    case 'clear':
      ctx.clear()
      return []
    case '':
      return []
    default:
      return [o(`Неизвестная команда: ${cmd}. Введите help`, 'err')]
  }
}

export function suggestions(input, state) {
  const parts = input.split(/\s+/)
  const first = parts[0].toLowerCase()
  if (parts.length <= 1) return Object.keys(COMMANDS).filter((c) => c.startsWith(first) && c !== first).map((c) => c)
  const q = parts.slice(1).join(' ').toLowerCase()
  if (first === 'cat' || first === 'open') return state.files.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 6).map((f) => `${first} ${f.path}`)
  if (first === 'focus') return ['orchestrator', ...ORDER].filter((a) => a.startsWith(q) && a !== q).map((a) => `focus ${a}`)
  if (first === 'theme') return ['light', 'dark'].filter((a) => a.startsWith(q) && a !== q).map((a) => `theme ${a}`)
  return []
}
