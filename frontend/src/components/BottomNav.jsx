import { NavLink } from 'react-router-dom'
import { Wallet, ReceiptText, LayoutDashboard, SlidersHorizontal, CheckSquare } from 'lucide-react'

const tabs = [
  { to: '/funds', icon: Wallet, label: 'Funds' },
  { to: '/expenses', icon: ReceiptText, label: 'Expenses' },
  { to: '/overview', icon: LayoutDashboard, label: 'Overview' },
  { to: '/checklist', icon: CheckSquare, label: 'Checklist' },
  { to: '/settings', icon: SlidersHorizontal, label: 'Settings' },
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 safe-bottom z-40 px-3 pb-3">
      <div className="flex items-stretch gap-0.5 max-w-lg mx-auto bg-white/90 backdrop-blur-md border border-line rounded-[28px] shadow-pop px-1.5 py-1.5">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-semibold rounded-[22px] transition-colors"
          >
            {({ isActive }) => (
              <>
                <span className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors ${isActive ? 'bg-accent-soft text-accent' : 'text-ink-3'}`}>
                  <Icon size={19} strokeWidth={isActive ? 2.4 : 1.8} />
                </span>
                <span className={isActive ? 'text-ink' : 'text-ink-3'}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
