import { LayoutDashboard } from 'lucide-react'
import { Card } from '../components/ui'

export default function OverviewPage() {
  return (
    <div className="px-4 pt-6 pb-6">
      <h1 className="text-3xl font-bold text-ink tracking-tight mb-5">Overview</h1>
      <Card className="p-8 flex flex-col items-center text-center gap-2">
        <div className="w-12 h-12 rounded-full bg-accent-soft text-accent flex items-center justify-center mb-1">
          <LayoutDashboard size={20} />
        </div>
        <p className="text-ink font-semibold">Analytics coming soon</p>
        <p className="text-sm text-ink-3 max-w-xs">Trends, monthly comparisons, and spending insights will live here.</p>
      </Card>
    </div>
  )
}
