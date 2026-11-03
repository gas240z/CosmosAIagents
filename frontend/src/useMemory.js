import { useCallback, useEffect, useState } from 'react'

// Память проекта на сервере (backend/data/memory.json). Перечитывается по событию 'orchestra:memory'.
export const notifyMemory = () => window.dispatchEvent(new Event('orchestra:memory'))

export function useMemory() {
  const [items, setItems] = useState([])
  const load = useCallback(async () => {
    try { setItems((await (await fetch('/api/memory')).json()).items || []) } catch { /* сервер ещё не поднялся */ }
  }, [])
  useEffect(() => {
    load()
    window.addEventListener('orchestra:memory', load)
    return () => window.removeEventListener('orchestra:memory', load)
  }, [load])

  const add = useCallback(async (text) => {
    const r = await fetch('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Не удалось сохранить')
    setItems((await r.json()).items)
  }, [])
  const remove = useCallback(async (id) => { setItems((await (await fetch(`/api/memory/${id}`, { method: 'DELETE' })).json()).items) }, [])
  const clear = useCallback(async () => { await fetch('/api/memory', { method: 'DELETE' }); setItems([]) }, [])
  return { items, add, remove, clear, reload: load }
}
