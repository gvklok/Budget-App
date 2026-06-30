import { useState, useEffect, useCallback } from 'react'
import { Pencil, Trash2, Plus, Tag } from 'lucide-react'
import { fmt, toCents } from '../api'
import Modal from '../components/Modal'

function c(cents) {
  return fmt(cents / 100)
}

const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'weekly', label: 'Weekly' },
]

function freqLabel(f) {
  return FREQUENCIES.find((x) => x.value === f)?.label ?? f
}

// ── Modals ────────────────────────────────────────────────────────────────────

function IncomeModal({ source, onClose, onSave }) {
  const [name, setName] = useState(source?.name ?? '')
  const [amount, setAmount] = useState(source ? (source.amount_cents / 100).toFixed(2) : '')
  const [frequency, setFrequency] = useState(source?.frequency ?? 'biweekly')
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
    <Modal title={source ? 'Edit Income' : 'Add Income'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Salary, Freelance"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Amount per paycheck</label>
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
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
          {saving ? 'Saving…' : source ? 'Save Changes' : 'Add Income'}
        </button>
      </form>
    </Modal>
  )
}

function ExpenseModal({ expense, categories, onClose, onSave }) {
  const [name, setName] = useState(expense?.name ?? '')
  const [amount, setAmount] = useState(expense ? (expense.amount_cents / 100).toFixed(2) : '')
  const [actual, setActual] = useState(expense?.actual_cents ? (expense.actual_cents / 100).toFixed(2) : '')
  const [categoryId, setCategoryId] = useState(expense?.category_id ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    if (!amount) return setError('Planned amount is required')
    setSaving(true)
    setError('')
    try {
      await onSave({
        name: name.trim(),
        amount_cents: toCents(amount),
        actual_cents: actual ? toCents(actual) : 0,
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
    <Modal title={expense ? 'Edit Bill' : 'Add Bill'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rent, Groceries, Utilities"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Planned</label>
            <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Actual <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input type="number" step="0.01" min="0" value={actual} onChange={(e) => setActual(e.target.value)}
              placeholder="0.00"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400 bg-white">
            <option value="">Uncategorized</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={saving}
          className="w-full bg-slate-900 text-white font-semibold rounded-xl py-3 disabled:opacity-50">
          {saving ? 'Saving…' : expense ? 'Save Changes' : 'Add Bill'}
        </button>
      </form>
    </Modal>
  )
}

function CategoryModal({ category, onClose, onSave }) {
  const [name, setName] = useState(category?.name ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({ name: name.trim() })
      onClose()
    } finally {
      setSaving(false)
    }
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

// ── Bill group ────────────────────────────────────────────────────────────────

function BillGroup({ label, bills, onEdit, onDelete }) {
  const totalPlanned = bills.reduce((s, b) => s + b.amount_cents, 0)
  const totalActual = bills.reduce((s, b) => s + b.actual_cents, 0)

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <div className="flex gap-6 text-xs font-semibold text-slate-400 pr-10">
          <span className="w-20 text-right">Planned</span>
          <span className="w-20 text-right">Actual</span>
        </div>
      </div>
      <div className="divide-y divide-slate-50">
        {bills.map((b) => {
          const over = b.actual_cents > b.amount_cents
          return (
            <div key={b.id} className="flex items-center gap-3 px-4 py-3">
              <p className="flex-1 text-sm text-slate-800 truncate">{b.name}</p>
              <span className="w-20 text-right font-mono text-sm text-slate-600">{c(b.amount_cents)}</span>
              <span className={`w-20 text-right font-mono text-sm font-medium ${
                b.actual_cents === 0 ? 'text-slate-300' : over ? 'text-red-500' : 'text-emerald-600'
              }`}>
                {b.actual_cents === 0 ? '—' : c(b.actual_cents)}
              </span>
              <div className="flex items-center gap-1 shrink-0 w-16 justify-end">
                <button onClick={() => onEdit(b)}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                  <Pencil size={13} />
                </button>
                <button onClick={() => onDelete(b)}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-400">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {bills.length > 1 && (
        <div className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-100 bg-slate-50">
          <p className="flex-1 text-xs font-semibold text-slate-500">Subtotal</p>
          <span className="w-20 text-right font-mono text-xs font-semibold text-slate-600">{c(totalPlanned)}</span>
          <span className={`w-20 text-right font-mono text-xs font-semibold ${
            totalActual === 0 ? 'text-slate-300' : totalActual > totalPlanned ? 'text-red-500' : 'text-emerald-600'
          }`}>
            {totalActual === 0 ? '—' : c(totalActual)}
          </span>
          <div className="w-16" />
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const [sources, setSources] = useState([])
  const [expenses, setExpenses] = useState([])
  const [categories, setCategories] = useState([])
  const [projection, setProjection] = useState(null)

  const [showAddIncome, setShowAddIncome] = useState(false)
  const [editSource, setEditSource] = useState(null)
  const [showAddExpense, setShowAddExpense] = useState(false)
  const [editExpense, setEditExpense] = useState(null)
  const [showAddCat, setShowAddCat] = useState(false)
  const [editCat, setEditCat] = useState(null)

  const load = useCallback(async () => {
    const [sRes, eRes, catRes, pRes] = await Promise.all([
      fetch('/api/income/'),
      fetch('/api/expenses/'),
      fetch('/api/expenses/categories'),
      fetch('/api/income/projection'),
    ])
    setSources(await sRes.json())
    setExpenses(await eRes.json())
    setCategories(await catRes.json())
    setProjection(await pRes.json())
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
  async function del(url) {
    await fetch(url, { method: 'DELETE' })
  }

  async function handleCreateIncome(data) { await post('/api/income/', data); await load() }
  async function handleUpdateIncome(id, data) { await patch(`/api/income/${id}`, data); await load() }
  async function handleDeleteIncome(s) { if (!confirm(`Delete "${s.name}"?`)) return; await del(`/api/income/${s.id}`); await load() }

  async function handleCreateExpense(data) { await post('/api/expenses/', data); await load() }
  async function handleUpdateExpense(id, data) { await patch(`/api/expenses/${id}`, data); await load() }
  async function handleDeleteExpense(e) { if (!confirm(`Delete "${e.name}"?`)) return; await del(`/api/expenses/${e.id}`); await load() }

  async function handleCreateCat(data) { await post('/api/expenses/categories', data); await load() }
  async function handleUpdateCat(id, data) { await patch(`/api/expenses/categories/${id}`, data); await load() }
  async function handleDeleteCat(cat) {
    if (!confirm(`Delete category "${cat.name}"? Bills in it will become uncategorized.`)) return
    await del(`/api/expenses/categories/${cat.id}`)
    await load()
  }

  // Group bills by category
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]))
  const grouped = {}
  const uncategorized = []
  for (const e of expenses) {
    if (e.category_id && catMap[e.category_id]) {
      if (!grouped[e.category_id]) grouped[e.category_id] = []
      grouped[e.category_id].push(e)
    } else {
      uncategorized.push(e)
    }
  }

  const totalPlanned = expenses.reduce((s, e) => s + e.amount_cents, 0)
  const totalActual = expenses.reduce((s, e) => s + e.actual_cents, 0)
  const net = projection?.net_cents ?? 0

  return (
    <div className="px-4 pt-6 pb-6 space-y-6">
      <h1 className="text-3xl font-bold text-slate-950">Expenses</h1>

      {/* Monthly Projection */}
      {projection && (
        <div className="bg-slate-950 text-white rounded-3xl p-5 space-y-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">Monthly Projection</p>
          <div className="space-y-1.5">
            {projection.income_items.map((i) => (
              <div key={i.id} className="flex justify-between text-sm text-slate-300">
                <span>{i.name}</span>
                <span className="font-mono text-emerald-400">+{c(i.monthly_cents)}</span>
              </div>
            ))}
            {projection.income_items.length === 0 && <p className="text-sm text-slate-500">No income sources yet</p>}
            <div className="flex justify-between text-sm font-semibold border-t border-slate-700 pt-1.5">
              <span>Total income</span>
              <span className="font-mono text-emerald-400">+{c(projection.total_income_cents)}</span>
            </div>
          </div>
          {(projection.bill_items.length > 0 || projection.fund_items.length > 0) && (
            <div className="space-y-1.5">
              {projection.bill_items.map((b) => (
                <div key={b.id} className="flex justify-between text-sm text-slate-300">
                  <span>{b.name}</span>
                  <span className="font-mono text-red-400">−{c(b.monthly_cents)}</span>
                </div>
              ))}
              {projection.fund_items.map((f) => (
                <div key={f.id} className="flex justify-between text-sm text-slate-300">
                  <span>{f.name}</span>
                  <span className="font-mono text-red-400">−{c(f.monthly_cents)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-semibold border-t border-slate-700 pt-1.5">
                <span>Total outflows</span>
                <span className="font-mono text-red-400">−{c(projection.total_outflows_cents)}</span>
              </div>
            </div>
          )}
          <div className={`flex justify-between items-center rounded-2xl px-4 py-3 ${net >= 0 ? 'bg-emerald-900/50' : 'bg-red-900/50'}`}>
            <span className="font-semibold text-sm">Net to Savings</span>
            <span className={`font-mono font-bold text-lg ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {net >= 0 ? '+' : '−'}{c(Math.abs(net))}
            </span>
          </div>
        </div>
      )}

      {/* Bills */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bills</p>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowAddCat(true)}
              className="flex items-center gap-1 text-xs font-semibold text-slate-500">
              <Tag size={13} />
              Category
            </button>
            <button onClick={() => setShowAddExpense(true)}
              className="flex items-center gap-1 text-sm font-semibold text-slate-900">
              <Plus size={16} />
              Add
            </button>
          </div>
        </div>

        {/* Category pills with rename/delete */}
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

        {expenses.length === 0 ? (
          <div className="bg-white rounded-3xl border border-dashed border-slate-200 p-8 text-center">
            <p className="text-slate-400 text-sm">No bills yet — add one above</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Categorized groups */}
            {categories.map((cat) => {
              const bills = grouped[cat.id]
              if (!bills?.length) return null
              return (
                <BillGroup
                  key={cat.id}
                  label={cat.name}
                  bills={bills}
                  onEdit={setEditExpense}
                  onDelete={handleDeleteExpense}
                />
              )
            })}
            {/* Uncategorized */}
            {uncategorized.length > 0 && (
              <BillGroup
                label="Uncategorized"
                bills={uncategorized}
                onEdit={setEditExpense}
                onDelete={handleDeleteExpense}
              />
            )}
            {/* Grand total */}
            {expenses.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-3">
                <p className="flex-1 text-sm font-bold text-slate-900">Total</p>
                <span className="w-20 text-right font-mono text-sm font-bold text-slate-900">{c(totalPlanned)}</span>
                <span className={`w-20 text-right font-mono text-sm font-bold ${
                  totalActual === 0 ? 'text-slate-300' : totalActual > totalPlanned ? 'text-red-500' : 'text-emerald-600'
                }`}>
                  {totalActual === 0 ? '—' : c(totalActual)}
                </span>
                <div className="w-16" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Income Sources */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Income</p>
          <button onClick={() => setShowAddIncome(true)}
            className="flex items-center gap-1 text-sm font-semibold text-slate-900">
            <Plus size={16} />
            Add
          </button>
        </div>
        {sources.length === 0 ? (
          <div className="bg-white rounded-3xl border border-dashed border-slate-200 p-8 text-center">
            <p className="text-slate-400 text-sm">No income sources — add one above</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map((s) => (
              <div key={s.id} className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{s.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{c(s.amount_cents)} · {freqLabel(s.frequency)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setEditSource(s)}
                      className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDeleteIncome(s)}
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

      {showAddIncome && <IncomeModal onClose={() => setShowAddIncome(false)} onSave={handleCreateIncome} />}
      {editSource && <IncomeModal source={editSource} onClose={() => setEditSource(null)} onSave={(d) => handleUpdateIncome(editSource.id, d)} />}
      {showAddExpense && <ExpenseModal categories={categories} onClose={() => setShowAddExpense(false)} onSave={handleCreateExpense} />}
      {editExpense && <ExpenseModal expense={editExpense} categories={categories} onClose={() => setEditExpense(null)} onSave={(d) => handleUpdateExpense(editExpense.id, d)} />}
      {showAddCat && <CategoryModal onClose={() => setShowAddCat(false)} onSave={handleCreateCat} />}
      {editCat && <CategoryModal category={editCat} onClose={() => setEditCat(null)} onSave={(d) => handleUpdateCat(editCat.id, d)} />}
    </div>
  )
}
