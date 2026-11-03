import { useCallback, useEffect, useState } from 'react'

export function useSettings() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/settings${refresh ? '?refresh=true' : ''}`)
      setSettings(await r.json())
    } catch { /* сервер ещё не поднялся */ }
    setLoading(false)
  }, [])

  const save = useCallback(async (body) => {
    setLoading(true)
    try {
      const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      setSettings(await r.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  return { settings, loading, load, save }
}
