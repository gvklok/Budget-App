import { useState } from 'react'
import { SlidersHorizontal, Monitor, Sun, Moon, Check } from 'lucide-react'
import { Card, SectionLabel, Segmented, PrimaryButton } from '../components/ui'
import { useTheme } from '../useTheme'
import { apiGet } from '../api'
import pkg from '../../package.json'

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: <Monitor size={13} /> },
  { value: 'light', label: 'Light', icon: <Sun size={13} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={13} /> },
]

function BackupCard() {
  const [state, setState] = useState('idle') // idle | working | done | error
  const [error, setError] = useState('')

  async function handleDownload() {
    setState('working')
    setError('')
    try {
      const payload = await apiGet('/export')
      const dateStr = (payload.exported_at || '').slice(0, 10)
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `budget-export-${dateStr}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setState('done')
      setTimeout(() => setState('idle'), 2000)
    } catch (err) {
      setError(err.message || 'Export failed')
      setState('error')
    }
  }

  return (
    <Card className="p-4 mb-3">
      <p className="text-sm font-medium text-ink mb-3">Backup</p>
      <PrimaryButton onClick={handleDownload} disabled={state === 'working'} className="w-full flex items-center justify-center gap-1.5">
        {state === 'done' ? (
          <>
            <Check size={15} /> Saved ✓
          </>
        ) : state === 'working' ? (
          'Preparing…'
        ) : (
          'Download backup'
        )}
      </PrimaryButton>
      {error && <p className="text-xs text-critical mt-2.5">{error}</p>}
      <p className="text-xs text-ink-3 mt-3">
        Everything — balances, plans, transactions, history — as one JSON file. Keep it somewhere safe.
      </p>
    </Card>
  )
}

export default function SettingsPage() {
  const [theme, setTheme] = useTheme()

  return (
    <div className="px-4 pt-6 pb-6">
      <h1 className="text-3xl font-bold text-ink tracking-tight mb-5">Settings</h1>

      <SectionLabel>Appearance</SectionLabel>
      <Card className="p-4 mb-3">
        <p className="text-sm font-medium text-ink mb-3">Theme</p>
        <Segmented options={THEME_OPTIONS} value={theme} onChange={setTheme} />
        <p className="text-xs text-ink-3 mt-3">
          {theme === 'system'
            ? "Follows your device's appearance setting."
            : `Always ${theme}, regardless of your device setting.`}
        </p>
      </Card>

      <SectionLabel>Data</SectionLabel>
      <BackupCard />

      <Card className="p-8 flex flex-col items-center text-center gap-2">
        <div className="w-12 h-12 rounded-full bg-accent-soft text-accent-ink flex items-center justify-center mb-1">
          <SlidersHorizontal size={20} />
        </div>
        <p className="text-ink font-semibold">Nothing else to configure yet</p>
        <p className="text-sm text-ink-3 max-w-xs">More app-wide preferences will live here.</p>
      </Card>

      <p className="text-center text-xs text-ink-3 mt-6">Budget v{pkg.version}</p>
    </div>
  )
}
