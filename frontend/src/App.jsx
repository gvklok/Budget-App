import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { BucketColorProvider } from './useBucketColors'
import Layout from './components/Layout'
import FundsPage from './pages/FundsPage'
import FundDetailPage from './pages/FundDetailPage'
import ExpensesPage from './pages/ExpensesPage'
import TransactionsPage from './pages/TransactionsPage'
import OverviewPage from './pages/OverviewPage'
import ChecklistPage from './pages/ChecklistPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <BucketColorProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/funds" replace />} />
          <Route element={<Layout />}>
            <Route path="/funds" element={<FundsPage />} />
            <Route path="/funds/:id" element={<FundDetailPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/checklist" element={<ChecklistPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </BucketColorProvider>
  )
}
