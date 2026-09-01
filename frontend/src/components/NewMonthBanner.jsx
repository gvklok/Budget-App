import { useState, useEffect, useCallback } from 'react'
import { X, Sparkles } from 'lucide-react'
import { fmt, apiGet, apiPost } from '../api'

function c(cents) {
  return fmt(cents / 100)
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
  const [summary, setSummary] = useState('')

  const load = useCallback(async () => {
    try {
      setStatus(await apiGet('/current-month-status'))
    } catch {
      // On load failure: render nothing (per spec) rather than a broken banner.
      setStatus(null)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    window.addEventListener('dev-refresh', load)
    return () => window.removeEventListener('dev-refresh', load)
  }, [load])

  async function handleRunBoth() {
    setRunning(true)
    setError('')
    setSummary('')
    try {
      const topOff = await apiPost('/monthly-reserve/top-off')
      const distribute = await apiPost('/funds/distribute')

      const parts = []
      if (topOff.status === 'ok') parts.push(`Topped off ${c(topOff.moved_cents)}`)
      else if (topOff.status === 'already_at_target') parts.push('Reserve already full')
      else if (topOff.status === 'no_bills') parts.push('No Bills configured')

      if (distribute.status === 'ok') {
        const n = distribute.funded.length
        const total = distribute.funded.reduce((s, f) => s + f.amount_cents, 0)
        parts.push(n > 0 ? `Distributed ${c(total)} to ${n} fund${n === 1 ? '' : 's'}` : 'No funds had enough Savings to distribute')
      } else if (distribute.status === 'no_contributions') {
        parts.push('No contributions set')
      }

      setSummary(parts.join(' · '))
      await load()
      window.dispatchEvent(new Event('dev-refresh'))
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  // Once "Run both" completes, the backend marks the month executed and
  // needs_banner flips false on the next load — but we still want the summary
  // visible until the user dismisses it, so `summary` keeps the banner open.
  if (dismissed || (!summary && (!status || !status.needs_banner))) return null

  return (
    <div className="sticky top-0 z-30 px-4 pt-3">
      <div className="bg-ink/90 backdrop-blur-md text-on-ink rounded-2xl px-4 py-3 shadow-pop flex items-center gap-3">
        <Sparkles size={16} className="text-accent-ink shrink-0" />
        <div className="flex-1 min-w-0">
          {summary ? (
            <p className="text-xs font-semibold leading-snug">{summary}</p>
          ) : (
            <>
              <p className="text-xs font-semibold leading-snug">New month — top off Monthly Reserve and distribute Fund contributions?</p>
              <p className="text-[11px] text-on-ink/60 leading-snug mt-0.5">
                Refills your bill-paying pool and sends each fund its monthly amount, both from Savings.
              </p>
            </>
          )}
          {error && <p className="text-[11px] text-critical mt-1">{error}</p>}
        </div>
        {!summary && (
          <button
            onClick={handleRunBoth}
            disabled={running}
            className="text-xs font-semibold bg-accent text-white rounded-full px-3 py-1.5 disabled:opacity-40 shrink-0 whitespace-nowrap"
          >
            {running ? 'Running…' : 'Run both'}
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="w-8 h-8 -m-1 flex items-center justify-center rounded-full text-on-ink/50 hover:text-on-ink hover:bg-white/10 transition-colors shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
