import { useState, useEffect, useCallback } from 'react'
import { X, Sparkles } from 'lucide-react'

async function post(url) {
  const r = await fetch(url, { method: 'POST' })
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(err.detail || 'Request failed')
  }
  return r.json()
}

// U6: shows once per session until top-off AND distribute have both run for
// the effective current month — never tied to whatever month is being viewed
// on the Expenses page. Dismissing is session-only; it reappears on reload if
// the actions still haven't run (forgetting is worse than nagging).
export default function NewMonthBanner() {
  const [status, setStatus] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const r = await fetch('/api/current-month-status')
    setStatus(await r.json())
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    window.addEventListener('dev-refresh', load)
    return () => window.removeEventListener('dev-refresh', load)
  }, [load])

  async function handleRunBoth() {
    setRunning(true)
    setError('')
    try {
      try {
        await post('/api/monthly-reserve/top-off')
      } catch (err) {
        if (!err.message.includes('already at or above target')) throw err
      }
      try {
        await post('/api/funds/distribute')
      } catch (err) {
        if (!err.message.includes('No funds have a monthly contribution set')) throw err
      }
      await load()
      window.dispatchEvent(new Event('dev-refresh'))
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  if (!status || !status.needs_banner || dismissed) return null

  return (
    <div className="sticky top-0 z-30 px-4 pt-3">
      <div className="bg-ink/90 backdrop-blur-md text-white rounded-2xl px-4 py-3 shadow-pop flex items-center gap-3">
        <Sparkles size={16} className="text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold leading-snug">New month — top off Monthly Reserve and distribute Fund contributions?</p>
          {error && <p className="text-[11px] text-critical mt-1">{error}</p>}
        </div>
        <button
          onClick={handleRunBoth}
          disabled={running}
          className="text-xs font-semibold bg-accent text-white rounded-full px-3 py-1.5 disabled:opacity-40 shrink-0 whitespace-nowrap"
        >
          {running ? 'Running…' : 'Run both'}
        </button>
        <button onClick={() => setDismissed(true)} className="text-white/50 hover:text-white shrink-0">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
