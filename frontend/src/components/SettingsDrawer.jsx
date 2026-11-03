import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Crown, Eye, EyeOff, KeyRound, RefreshCw, X } from 'lucide-react'
import { AGENTS, ORDER } from '../agents'

const SRC = { env: '.env', ui: 'память сервера', none: 'нет ключа', demo: 'демо' }

function Card({ title, color, icon: Ic, children }) {
  return (
    <div className="rounded-2xl p-3.5" style={{ background: 'var(--card-bg)', border: `1px solid ${color}44`, boxShadow: `inset 0 0 24px ${color}0f` }}>
      <div className="mb-2.5 flex items-center gap-2 font-display text-[12px] font-bold uppercase tracking-[.16em]" style={{ color }}>
        {Ic && <span className="grid h-6 w-6 place-items-center rounded-full" style={{ background: `${color}22`, border: `1px solid ${color}66` }}><Ic size={13} /></span>}{title}
      </div>
      {children}
    </div>
  )
}
const selectCls = 'field w-full rounded-lg px-2.5 py-2 text-[12.5px] outline-none focus:border-sky-400'

export default function SettingsDrawer({ open, onClose, settings, loading, onSave, onRefresh }) {
  const [keys, setKeys] = useState({})
  const [show, setShow] = useState({})
  const [models, setModels] = useState({})
  const [orch, setOrch] = useState({ provider: '', model: '' })

  useEffect(() => {
    if (!settings) return
    setModels(Object.fromEntries(settings.providers.map((p) => [p.id, p.model])))
    setOrch({ provider: settings.orchestrator.provider || '', model: settings.orchestrator.model || '' })
  }, [settings, open])

  const prov = (id) => settings?.providers.find((p) => p.id === id)
  const orchModels = prov(orch.provider)?.models || []
  const apply = async () => {
    await onSave({ keys, models, orchestrator: orch })
    setKeys({})
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="bg" className="fixed inset-0 z-40 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside key="panel" role="dialog" aria-label="Настройки" className="glass fixed bottom-3 right-3 top-3 z-50 flex w-[min(440px,calc(100vw-1.5rem))] flex-col"
            initial={{ x: 520, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 520, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
            <header className="flex items-center gap-2 px-4 py-3">
              <KeyRound size={16} className="text-sky-300" />
              <h2 className="font-display text-sm font-bold uppercase tracking-[.16em]">Настройки миссии</h2>
              <button className="btn-ghost ml-auto !p-2" onClick={onRefresh} title="Обновить списки моделей" aria-label="Обновить модели"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
              <button className="btn-ghost !p-2" onClick={onClose} aria-label="Закрыть"><X size={14} /></button>
            </header>
            <div className="flex-1 space-y-3 overflow-auto px-4 pb-3">
              <p className="text-[11.5px] leading-relaxed text-slate-300/80">Ключи из <code>.env</code> подхватываются автоматически. Ключ из этого окна хранится только в памяти сервера. Списки моделей запрашиваются у API провайдера.</p>
              {settings?.demo && <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-[11.5px] text-amber-200">Включён DEMO_MODE: провайдеры имитируются.</div>}

              <Card title="Оркестратор — центр управления" color="#e0a21a" icon={Crown}>
                <div className="grid grid-cols-2 gap-2">
                  <select className={selectCls} value={orch.provider} onChange={(e) => setOrch({ provider: e.target.value, model: '' })} aria-label="Провайдер оркестратора">
                    <option value="">авто</option>
                    {settings?.providers.filter((p) => p.has_key).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select className={selectCls} value={orch.model} onChange={(e) => setOrch({ ...orch, model: e.target.value })} disabled={!orch.provider} aria-label="Модель оркестратора">
                    <option value="">по умолчанию</option>
                    {orchModels.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </Card>

              {ORDER.map((id) => {
                const p = prov(id)
                const A = AGENTS[id]
                return (
                  <Card key={id} title={A.name} color={A.color} icon={A.icon}>
                    <div className="mb-1.5 flex items-center justify-between text-[11px]">
                      <span className="text-slate-300/70">Ключ: <b style={{ color: p?.has_key ? '#2fe3a1' : '#ff8a8a' }}>{SRC[p?.key_source || 'none']}</b> {p?.key_hint}</span>
                      {p?.models_error && <span className="max-w-[55%] truncate text-red-300" title={p.models_error}>{p.models_error}</span>}
                    </div>
                    <div className="relative mb-2">
                      <input type={show[id] ? 'text' : 'password'} autoComplete="off" spellCheck="false" className={selectCls + ' pr-9'} placeholder="API-ключ (необязательно, если есть в .env)"
                        value={keys[id] || ''} onChange={(e) => setKeys({ ...keys, [id]: e.target.value })} />
                      <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setShow({ ...show, [id]: !show[id] })} aria-label="Показать ключ">
                        {show[id] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <select className={selectCls} value={models[id] || ''} onChange={(e) => setModels({ ...models, [id]: e.target.value })} disabled={!p?.models.length} aria-label={`Модель ${A.name}`}>
                      {!p?.models.length && <option value="">{p?.has_key ? 'нет списка моделей' : 'добавьте ключ'}</option>}
                      {p?.models.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </Card>
                )
              })}
            </div>
            <footer className="flex gap-2 px-4 py-3">
              <button className="btn-neon flex-1" onClick={async () => { await apply(); onClose() }}>Применить</button>
              <button className="btn-ghost" onClick={apply}>Сохранить</button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
