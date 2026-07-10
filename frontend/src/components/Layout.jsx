import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'
import NewMonthBanner from './NewMonthBanner'

export default function Layout() {
  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <main className="flex-1 pb-28 max-w-lg mx-auto w-full">
        <NewMonthBanner />
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
