import { useEffect, useState } from 'react'
import { Monitor, Sun, Moon, Check } from 'lucide-react'
import { Card, SectionLabel, Segmented, PrimaryButton, BucketColorPicker } from '../components/ui'
import { useTheme } from '../useTheme'
import { useBucketColors } from '../useBucketColors'
import { BUCKET_COLOR_PRESETS, DEFAULT_BUCKET_PRESET } from '../bucketColorPresets'
import { apiGet } from '../api'
import DevOverlay from '../components/DevOverlay'
import pkg from '../../package.json'

// Tracks the resolved `.dark` class on <html> — separate from useTheme's own
// 'system'/'light'/'dark' preference string — so the bucket-color swatch
// previews always reflect what's actually on screen, including when
// 'system' silently flips with the OS.
function useIsDarkResolved() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const observer = new MutationObserver(() => setIsDark(document.documentElement.classList.contains('dark')))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return isDark
}

const BUCKET_FIELDS = [
  { key: 'bills', label: 'Bills' },
  { key: 'funds', label: 'Funds' },
  { key: 'savings', label: 'Savings' },
]

function BucketColorsCard() {
  const [selection, setBucketPreset] = useBucketColors()
  const isDark = useIsDarkResolved()

  return (
    <Card className="p-4 mb-3">
      <p className="text-sm font-medium text-ink mb-1">Bucket Colors</p>
      <p className="text-xs text-ink-3 mb-4">
        Bills, Funds, and Savings each get one color, used everywhere that concept shows up —
        Overview charts, Funds page, Expenses bars. Pick a preset per bucket, or reset to default.
      </p>
      <div className="flex flex-col gap-4">
        {BUCKET_FIELDS.map(({ key, label }) => (
          <BucketColorPicker
            key={key}
            label={label}
            presets={BUCKET_COLOR_PRESETS}
            value={selection[key]}
            defaultKey={DEFAULT_BUCKET_PRESET[key]}
            onChange={(presetKey) => setBucketPreset(key, presetKey)}
            isDark={isDark}
          />
        ))}
      </div>
    </Card>
  )
}

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
        Download your data — balances, plans, transactions, history — as one JSON file. Backup to computer, cloud, or external drive.
    
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

      <BucketColorsCard />

      <SectionLabel>Data</SectionLabel>
      <BackupCard />

      <SectionLabel>Developer Tools</SectionLabel>
      <Card className="p-4">
        <p className="text-xs text-ink-3 mb-3">
          This is for overiding values and testing things that aren't normally exposed in the UI. Use with caution.
        </p>
        <DevOverlay />
      </Card>

      <p className="text-center text-xs text-ink-3 mt-6">Budget v{pkg.version}</p>
    </div>
  )
}
