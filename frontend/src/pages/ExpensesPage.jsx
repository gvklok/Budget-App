import { useState, useEffect, useCallback } from 'react'
import { Pencil, Trash2, Plus, Tag, ChevronDown, ChevronUp, Receipt } from 'lucide-react'
import { fmt, toCents } from '../api'
import Modal from '../components/Modal'

function c(cents) { return fmt(cents / 100) }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Income Source Modal ───────────────────────────────────────────────────────

const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'weekly', label: 'Weekly' },
]
function freqLabel(f) { return FREQUENCIES.find((x) => x.value === f)?.label ?? f }

function IncomeSourceModal({ source, onClose, onSave }) {
  const [name, setName] = useState(source?.name ?? '')
  const [amount, setAmount] = useState(source ? (source.amount_cents / 100).toFixed(2) : '')
  const [frequency, setFrequency] = useState(source?.frequency ?? 'monthly')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    if (!amount) return setError('Amount is required')
    setSaving(true)
    setError('')
    try {
      await onSave({ name: name.trim(), amount_cents: toCents(amount), frequency })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={source ? 'Edit Income Source' : 'Add Income Source'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Salary, Freelance, Rental"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Amount per payment</label>
          <input type="number" step="0.01" min="0" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Frequency</label>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400 bg-white">
            {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={saving}
          className="w-full bg-slate-900 text-white font-semibold rounded-xl py-3 disabled:opacity-50">
          {saving ? 'Saving…' : source ? 'Save Changes' : 'Add'}
        </button>
      </form>
    </Modal>
  )
}

// ── Fund Contribution Modal ───────────────────────────────────────────────────

function FundContributionModal({ fund, onClose, onSave }) {
  const [contribution, setContribution] = useState(
    fund.monthly_contribution_cents > 0 ? (fund.monthly_contribution_cents / 100).toFixed(2) : ''
  )
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave({ monthly_contribution_cents: toCents(contribution || '0') })
      onClose()
    } catch (err) {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`${fund.name} — Monthly Contribution`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Monthly contribution</label>
          <input autoFocus type="number" step="0.01" min="0" value={contribution}
            onChange={(e) => setContribution(e.target.value)} placeholder="0.00"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
          <p className="text-xs text-slate-400 mt-1">Set to 0 to exclude from fund contributions total</p>
        </div>
        <button type="submit" disabled={saving}
          className="w-full bg-slate-900 text-white font-semibold rounded-xl py-3 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Modal>
  )
}

// ── Log Transaction Modal ─────────────────────────────────────────────────────

function LogTransactionModal({ bills, funds, defaultLineItemId, defaultFundId, onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10)
  const [mode, setMode] = useState(defaultFundId ? 'fund' : 'category')
  const [lineItemId, setLineItemId] = useState(defaultLineItemId ?? '')
  const [fundId, setFundId] = useState(defaultFundId ?? '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [merchant, setMerchant] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (mode === 'category' && !lineItemId) return setError('Select a line item')
    if (mode === 'fund' && !fundId) return setError('Select a fund')
    if (!amount) return setError('Amount is required')
    setSaving(true)
    setError('')
    try {
      const payload = {
        amount_cents: toCents(amount),
        date,
        merchant: merchant.trim() || null,
        ...(mode === 'category' ? { line_item_id: Number(lineItemId) } : { fund_id: Number(fundId) }),
      }
      await onSave(payload)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const tabClass = (active) =>
    `flex-1 py-2 text-sm font-semibold rounded-xl border transition-colors ${
      active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'
    }`

  return (
    <Modal title="Log Transaction" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-2">
          <button type="button" className={tabClass(mode === 'category')} onClick={() => setMode('category')}>
            Bill
          </button>
          <button type="button" className={tabClass(mode === 'fund')} onClick={() => setMode('fund')}>
            Fund
          </button>
        </div>

        {mode === 'category' ? (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Bill</label>
            <select value={lineItemId} onChange={(e) => setLineItemId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400 bg-white">
              <option value="">Select…</option>
              {bills.map((li) => <option key={li.id} value={li.id}>{li.name}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Fund</label>
            <select value={fundId} onChange={(e) => setFundId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400 bg-white">
              <option value="">Select…</option>
              {funds.map((f) => <option key={f.id} value={f.id}>{f.name} ({c(f.balance_cents)} available)</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
          <input autoFocus type="number" step="0.01" min="0" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Merchant <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Walmart"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={saving}
          className="w-full bg-slate-900 text-white font-semibold rounded-xl py-3 disabled:opacity-50">
          {saving ? 'Saving…' : 'Log'}
        </button>
      </form>
    </Modal>
  )
}

// ── Bill Line Item Modal ───────────────────────────────────────────────────────

function LineItemModal({ item, categories, onClose, onSave }) {
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item ? (item.amount_cents / 100).toFixed(2) : '')
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    if (!amount) return setError('Amount is required')
    setSaving(true)
    setError('')
    try {
      await onSave({
        name: name.trim(),
        type: 'bill',
        amount_cents: toCents(amount),
        actual_cents: 0,
        category_id: categoryId !== '' ? Number(categoryId) : null,
      })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={item ? 'Edit Bill' : 'Add Bill'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rent, Groceries, Netflix"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Monthly amount</label>
          <input type="number" step="0.01" min="0" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400 bg-white">
            <option value="">Uncategorized</option>
            {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={saving}
          className="w-full bg-slate-900 text-white font-semibold rounded-xl py-3 disabled:opacity-50">
          {saving ? 'Saving…' : item ? 'Save Changes' : 'Add'}
        </button>
      </form>
    </Modal>
  )
}

// ── Category Modal ────────────────────────────────────────────────────────────

function CategoryModal({ category, onClose, onSave }) {
  const [name, setName] = useState(category?.name ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try { await onSave({ name: name.trim() }); onClose() } finally { setSaving(false) }
  }

  return (
    <Modal title={category ? 'Rename Category' : 'New Category'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Fixed, Insurance, Groceries"
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
        <button type="submit" disabled={saving || !name.trim()}
          className="w-full bg-slate-900 text-white font-semibold rounded-xl py-3 disabled:opacity-50">
          {saving ? 'Saving…' : category ? 'Rename' : 'Create'}
        </button>
      </form>
    </Modal>
  )
}

// ── Shared expandable row ─────────────────────────────────────────────────────

function ItemRow({ name, subtitle, budgetCents, spentCents, txns, onEdit, onDelete, onLogTx, onDeleteTx }) {
  const [expanded, setExpanded] = useState(false)
  const remaining = budgetCents - spentCents
  const over = spentCents > budgetCents

  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-3">
        <button onClick={() => setExpanded((v) => !v)}
          className="shrink-0 w-5 h-5 flex items-center justify-center text-slate-300 hover:text-slate-500">
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-800 truncate">{name}</p>
          {subtitle && <p className="text-xs text-slate-400 truncate">{subtitle}</p>}
        </div>
        <span className="w-20 text-right font-mono text-sm text-slate-500">{c(budgetCents)}</span>
        <span className={`w-20 text-right font-mono text-sm font-semibold ${
          spentCents === 0 ? 'text-slate-300' : over ? 'text-red-500' : 'text-slate-700'
        }`}>
          {spentCents === 0 ? '—' : c(spentCents)}
        </span>
        <span className={`w-20 text-right font-mono text-sm font-semibold ${
          over ? 'text-red-500' : remaining === budgetCents ? 'text-slate-300' : 'text-emerald-600'
        }`}>
          {over ? `−${c(Math.abs(remaining))}` : c(remaining)}
        </span>
        <div className="flex items-center gap-1 shrink-0 w-20 justify-end">
          {onLogTx && (
            <button onClick={onLogTx}
              className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100" title="Log transaction">
              <Receipt size={13} />
            </button>
          )}
          {onEdit && (
            <button onClick={onEdit}
              className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
              <Pencil size={13} />
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete}
              className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-400">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mx-4 mb-3 rounded-xl border border-slate-100 overflow-hidden">
          {txns.length === 0 ? (
            <p className="text-xs text-slate-400 px-4 py-3">No transactions this month</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {txns.map((tx) => (
                <div key={tx.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs text-slate-400 w-20 shrink-0">{tx.date}</span>
                  <span className="flex-1 text-xs text-slate-600 truncate">{tx.merchant || '—'}</span>
                  <span className="font-mono text-xs font-semibold text-slate-800">{c(tx.amount_cents)}</span>
                  <button onClick={() => onDeleteTx(tx)}
                    className="w-6 h-6 flex items-center justify-center rounded-full text-slate-300 hover:bg-red-50 hover:text-red-400">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Bill group (by category) ──────────────────────────────────────────────────

const COL_HEADER = (
  <div className="flex text-xs font-semibold text-slate-400">
    <span className="w-20 text-right">Budget</span>
    <span className="w-20 text-right">Spent</span>
    <span className="w-20 text-right">Left</span>
    <div className="w-20" />
  </div>
)

function BillGroup({ label, bills, txnsByItemId, onEdit, onDelete, onLogTx, onDeleteTx }) {
  const totalPlanned = bills.reduce((s, b) => s + b.amount_cents, 0)
  const totalSpent = bills.reduce((s, b) => s + (txnsByItemId[b.id] ?? []).reduce((a, t) => a + t.amount_cents, 0), 0)
  const totalRemaining = totalPlanned - totalSpent

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center px-4 py-3 bg-slate-50 border-b border-slate-100">
        <div className="w-5 shrink-0" />
        <p className="flex-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        {COL_HEADER}
      </div>
      <div className="divide-y divide-slate-50">
        {bills.map((b) => {
          const itemTxns = txnsByItemId[b.id] ?? []
          const spent = itemTxns.reduce((s, t) => s + t.amount_cents, 0)
          return (
            <ItemRow key={b.id}
              name={b.name} budgetCents={b.amount_cents} spentCents={spent} txns={itemTxns}
              onEdit={() => onEdit(b)} onDelete={() => onDelete(b)}
              onLogTx={() => onLogTx(b.id)} onDeleteTx={onDeleteTx} />
          )
        })}
      </div>
      {bills.length > 1 && (
        <div className="flex items-center px-4 py-2.5 border-t border-slate-100 bg-slate-50">
          <div className="w-5 shrink-0" />
          <p className="flex-1 text-xs font-semibold text-slate-500">Subtotal</p>
          <span className="w-20 text-right font-mono text-xs font-semibold text-slate-600">{c(totalPlanned)}</span>
          <span className={`w-20 text-right font-mono text-xs font-semibold ${totalSpent === 0 ? 'text-slate-300' : 'text-slate-700'}`}>
            {totalSpent === 0 ? '—' : c(totalSpent)}
          </span>
          <span className={`w-20 text-right font-mono text-xs font-semibold ${
            totalRemaining < 0 ? 'text-red-500' : totalSpent === 0 ? 'text-slate-300' : 'text-emerald-600'
          }`}>
            {totalSpent === 0 ? '—' : totalRemaining < 0 ? `−${c(Math.abs(totalRemaining))}` : c(totalRemaining)}
          </span>
          <div className="w-20" />
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const [incomeSources, setIncomeSources] = useState([])
  const [summary, setSummary] = useState(null)
  const [lineItems, setLineItems] = useState([])
  const [categories, setCategories] = useState([])
  const [funds, setFunds] = useState([])
  const [transactions, setTransactions] = useState([])

  const [showAddSource, setShowAddSource] = useState(false)
  const [editSource, setEditSource] = useState(null)
  const [showAddItem, setShowAddItem] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [showAddCat, setShowAddCat] = useState(false)
  const [editCat, setEditCat] = useState(null)
  const [editFundContrib, setEditFundContrib] = useState(null) // fund to edit contribution
  // logTx: null=closed, { lineItemId, fundId } = open
  const [logTx, setLogTx] = useState(null)

  const load = useCallback(async () => {
    const [srcRes, sumRes, itemsRes, catRes, fundsRes, txRes] = await Promise.all([
      fetch('/api/income-sources'),
      fetch('/api/monthly-summary'),
      fetch('/api/line-items/'),
      fetch('/api/line-items/categories'),
      fetch('/api/funds/'),
      fetch('/api/transactions/'),
    ])
    setIncomeSources(await srcRes.json())
    setSummary(await sumRes.json())
    setLineItems(await itemsRes.json())
    setCategories(await catRes.json())
    setFunds(await fundsRes.json())
    setTransactions(await txRes.json())
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    window.addEventListener('dev-refresh', load)
    return () => window.removeEventListener('dev-refresh', load)
  }, [load])

  async function post(url, data) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Failed') }
    return r.json()
  }
  async function patch(url, data) {
    const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Failed') }
    return r.json()
  }
  async function del(url) { await fetch(url, { method: 'DELETE' }) }

  async function handleCreateSource(data) { await post('/api/income-sources', data); await load() }
  async function handleUpdateSource(id, data) { await patch(`/api/income-sources/${id}`, data); await load() }
  async function handleDeleteSource(s) {
    if (!confirm(`Delete "${s.name}"?`)) return
    await del(`/api/income-sources/${s.id}`)
    await load()
  }
  async function handleCreateItem(data) { await post('/api/line-items/', data); await load() }
  async function handleUpdateItem(id, data) { await patch(`/api/line-items/${id}`, data); await load() }
  async function handleDeleteItem(item) {
    if (!confirm(`Delete "${item.name}"?`)) return
    await del(`/api/line-items/${item.id}`)
    await load()
  }
  async function handleCreateCat(data) { await post('/api/line-items/categories', data); await load() }
  async function handleUpdateCat(id, data) { await patch(`/api/line-items/categories/${id}`, data); await load() }
  async function handleDeleteCat(cat) {
    if (!confirm(`Delete category "${cat.name}"? Bills in it become uncategorized.`)) return
    await del(`/api/line-items/categories/${cat.id}`)
    await load()
  }
  async function handleUpdateFundContrib(id, data) { await patch(`/api/funds/${id}`, data); await load() }
  async function handleLogTx(data) { await post('/api/transactions/', data); await load() }
  async function handleDeleteTx(tx) {
    if (!confirm('Delete this transaction?')) return
    await del(`/api/transactions/${tx.id}`)
    await load()
  }

  // Only current-month transactions
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const currentMonthTxns = transactions.filter((tx) => {
    const [y, m] = tx.date.split('-').map(Number)
    return y === currentYear && m === currentMonth
  })

  // Bill transactions by line_item_id
  const txnsByItemId = {}
  for (const tx of currentMonthTxns.filter((t) => t.line_item_id)) {
    if (!txnsByItemId[tx.line_item_id]) txnsByItemId[tx.line_item_id] = []
    txnsByItemId[tx.line_item_id].push(tx)
  }

  // Fund transactions by fund_id (direct spending)
  const txnsByFundId = {}
  for (const tx of currentMonthTxns.filter((t) => t.fund_id)) {
    if (!txnsByFundId[tx.fund_id]) txnsByFundId[tx.fund_id] = []
    txnsByFundId[tx.fund_id].push(tx)
  }

  // Bills only
  const bills = lineItems.filter((i) => i.type === 'bill')
  const catMap = Object.fromEntries(categories.map((cat) => [cat.id, cat.name]))
  const grouped = {}
  const uncategorized = []
  for (const b of bills) {
    if (b.category_id && catMap[b.category_id]) {
      if (!grouped[b.category_id]) grouped[b.category_id] = []
      grouped[b.category_id].push(b)
    } else {
      uncategorized.push(b)
    }
  }

  const totalBillPlanned = bills.reduce((s, b) => s + b.amount_cents, 0)
  const totalBillSpent = bills.reduce((s, b) => s + (txnsByItemId[b.id] ?? []).reduce((a, t) => a + t.amount_cents, 0), 0)
  const totalBillRemaining = totalBillPlanned - totalBillSpent

  const thisMonthName = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`

  return (
    <div className="px-4 pt-6 pb-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-950">Expenses</h1>
        <button onClick={() => setLogTx({})}
          className="flex items-center gap-1.5 bg-slate-900 text-white text-sm font-semibold px-4 py-2 rounded-2xl">
          <Receipt size={15} />Log
        </button>
      </div>

      {/* Monthly Summary */}
      {summary && (
        <div className="bg-slate-950 text-white rounded-3xl p-5 space-y-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">{thisMonthName}</p>
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm text-slate-300">
              <span>Expected income</span>
              <span className="font-mono text-emerald-400">+{c(summary.expected_income_cents)}</span>
            </div>
            {summary.expected_bills_total_cents > 0 && (
              <div className="flex justify-between text-sm text-slate-300">
                <span>Bills</span>
                <span className="font-mono text-red-400">−{c(summary.expected_bills_total_cents)}</span>
              </div>
            )}
            {summary.expected_fund_contributions_total_cents > 0 && (
              <div className="flex justify-between text-sm text-slate-300">
                <span>Fund contributions</span>
                <span className="font-mono text-red-400">−{c(summary.expected_fund_contributions_total_cents)}</span>
              </div>
            )}
          </div>
          <div className={`flex justify-between items-center rounded-2xl px-4 py-3 ${summary.expected_savings_cents >= 0 ? 'bg-emerald-900/50' : 'bg-red-900/50'}`}>
            <div>
              <span className="font-semibold text-sm">Net to Savings</span>
              {summary.expected_income_cents > 0 && (
                <p className={`text-xs mt-0.5 ${summary.expected_savings_cents >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                  {Math.round((summary.expected_savings_cents / summary.expected_income_cents) * 100)}% savings rate
                </p>
              )}
            </div>
            <span className={`font-mono font-bold text-lg ${summary.expected_savings_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {summary.expected_savings_cents >= 0 ? '+' : '−'}{c(Math.abs(summary.expected_savings_cents))}
            </span>
          </div>
        </div>
      )}

      {/* Income Sources */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Income</p>
          <button onClick={() => setShowAddSource(true)}
            className="flex items-center gap-1 text-sm font-semibold text-slate-900">
            <Plus size={16} />Add
          </button>
        </div>
        {incomeSources.length === 0 ? (
          <div className="bg-white rounded-3xl border border-dashed border-slate-200 p-8 text-center">
            <p className="text-slate-400 text-sm mb-2">No income sources yet</p>
            <button onClick={() => setShowAddSource(true)}
              className="text-sm font-semibold text-slate-900">Add income source →</button>
          </div>
        ) : (
          <div className="space-y-2">
            {incomeSources.map((s) => (
              <div key={s.id} className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{s.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{c(s.amount_cents)} · {freqLabel(s.frequency)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setEditSource(s)}
                      className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDeleteSource(s)}
                      className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-400">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bills */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bills</p>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowAddCat(true)}
              className="flex items-center gap-1 text-xs font-semibold text-slate-500">
              <Tag size={13} />Category
            </button>
            <button onClick={() => setShowAddItem(true)}
              className="flex items-center gap-1 text-sm font-semibold text-slate-900">
              <Plus size={16} />Add
            </button>
          </div>
        </div>

        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {categories.map((cat) => (
              <div key={cat.id} className="flex items-center gap-1 bg-slate-100 rounded-full px-3 py-1">
                <span className="text-xs font-medium text-slate-600">{cat.name}</span>
                <button onClick={() => setEditCat(cat)} className="text-slate-400 hover:text-slate-600 ml-1">
                  <Pencil size={11} />
                </button>
                <button onClick={() => handleDeleteCat(cat)} className="text-slate-400 hover:text-red-400">
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {bills.length === 0 ? (
          <div className="bg-white rounded-3xl border border-dashed border-slate-200 p-8 text-center">
            <p className="text-slate-400 text-sm">No bills yet — add one above</p>
          </div>
        ) : (
          <div className="space-y-3">
            {categories.map((cat) => {
              const group = grouped[cat.id]
              if (!group?.length) return null
              return (
                <BillGroup key={cat.id} label={cat.name} bills={group} txnsByItemId={txnsByItemId}
                  onEdit={setEditItem} onDelete={handleDeleteItem}
                  onLogTx={(id) => setLogTx({ lineItemId: id })} onDeleteTx={handleDeleteTx} />
              )
            })}
            {uncategorized.length > 0 && (
              <BillGroup label="Uncategorized" bills={uncategorized} txnsByItemId={txnsByItemId}
                onEdit={setEditItem} onDelete={handleDeleteItem}
                onLogTx={(id) => setLogTx({ lineItemId: id })} onDeleteTx={handleDeleteTx} />
            )}
            <div className="flex items-center px-4 py-3">
              <div className="w-5 shrink-0" />
              <p className="flex-1 text-sm font-bold text-slate-900">Total</p>
              <span className="w-20 text-right font-mono text-sm font-bold text-slate-900">{c(totalBillPlanned)}</span>
              <span className={`w-20 text-right font-mono text-sm font-bold ${totalBillSpent === 0 ? 'text-slate-300' : 'text-slate-700'}`}>
                {totalBillSpent === 0 ? '—' : c(totalBillSpent)}
              </span>
              <span className={`w-20 text-right font-mono text-sm font-bold ${
                totalBillRemaining < 0 ? 'text-red-500' : totalBillSpent === 0 ? 'text-slate-300' : 'text-emerald-600'
              }`}>
                {totalBillSpent === 0 ? '—' : totalBillRemaining < 0 ? `−${c(Math.abs(totalBillRemaining))}` : c(totalBillRemaining)}
              </span>
              <div className="w-20" />
            </div>
          </div>
        )}
      </div>

      {/* Funds */}
      {funds.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3 px-1">Funds</p>
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex items-center px-4 py-3 bg-slate-50 border-b border-slate-100">
              <div className="w-5 shrink-0" />
              <p className="flex-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Fund</p>
              {COL_HEADER}
            </div>
            <div className="divide-y divide-slate-50">
              {funds.map((fund) => {
                const fundTxns = txnsByFundId[fund.id] ?? []
                const spent = fundTxns.reduce((s, t) => s + t.amount_cents, 0)
                return (
                  <ItemRow key={fund.id}
                    name={fund.name}
                    subtitle={fund.monthly_contribution_cents === 0 ? 'No contribution set' : null}
                    budgetCents={fund.monthly_contribution_cents}
                    spentCents={spent}
                    txns={fundTxns}
                    onEdit={() => setEditFundContrib(fund)}
                    onLogTx={() => setLogTx({ fundId: fund.id })}
                    onDeleteTx={handleDeleteTx}
                  />
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {logTx && (
        <LogTransactionModal
          bills={bills}
          funds={funds}
          defaultLineItemId={logTx.lineItemId}
          defaultFundId={logTx.fundId}
          onClose={() => setLogTx(null)}
          onSave={handleLogTx}
        />
      )}
      {showAddSource && <IncomeSourceModal onClose={() => setShowAddSource(false)} onSave={handleCreateSource} />}
      {editSource && <IncomeSourceModal source={editSource} onClose={() => setEditSource(null)} onSave={(d) => handleUpdateSource(editSource.id, d)} />}
      {showAddItem && <LineItemModal categories={categories} onClose={() => setShowAddItem(false)} onSave={handleCreateItem} />}
      {editItem && <LineItemModal item={editItem} categories={categories} onClose={() => setEditItem(null)} onSave={(d) => handleUpdateItem(editItem.id, d)} />}
      {showAddCat && <CategoryModal onClose={() => setShowAddCat(false)} onSave={handleCreateCat} />}
      {editCat && <CategoryModal category={editCat} onClose={() => setEditCat(null)} onSave={(d) => handleUpdateCat(editCat.id, d)} />}
      {editFundContrib && (
        <FundContributionModal
          fund={editFundContrib}
          onClose={() => setEditFundContrib(null)}
          onSave={(d) => handleUpdateFundContrib(editFundContrib.id, d)}
        />
      )}
    </div>
  )
}
