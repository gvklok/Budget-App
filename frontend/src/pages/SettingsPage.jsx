import { SlidersHorizontal } from 'lucide-react'
import { Card } from '../components/ui'

export default function SettingsPage() {
  return (
    <div className="px-4 pt-6 pb-6">
      <h1 className="text-3xl font-bold text-ink tracking-tight mb-5">Settings</h1>
      <Card className="p-8 flex flex-col items-center text-center gap-2">
        <div className="w-12 h-12 rounded-full bg-accent-soft text-accent flex items-center justify-center mb-1">
          <SlidersHorizontal size={20} />
        </div>
        <p className="text-ink font-semibold">Nothing to configure yet</p>
        <p className="text-sm text-ink-3 max-w-xs">App-wide preferences will live here.</p>
      </Card>
    </div>
  )
}
