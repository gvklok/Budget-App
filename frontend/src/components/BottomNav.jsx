import { NavLink } from 'react-router-dom'
import { Wallet, ReceiptText, LayoutDashboard, SlidersHorizontal, CheckSquare } from 'lucide-react'

const tabs = [
  { to: '/funds', icon: Wallet, label: 'Funds' },
  { to: '/expenses', icon: ReceiptText, label: 'Expenses' },
  { to: '/overview', icon: LayoutDashboard, label: 'Overview' },
  { to: '/settings', icon: SlidersHorizontal, label: 'Settings' },
  { to: '/checklist', icon: CheckSquare, label: 'Checklist' },
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 safe-bottom z-40">
      <div className="flex items-stretch max-w-lg mx-auto">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 pt-3 gap-0.5 text-xs font-medium transition-colors ${
                isActive ? 'text-green-600' : 'text-slate-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={22} strokeWidth={isActive ? 2.5 : 1.8} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
