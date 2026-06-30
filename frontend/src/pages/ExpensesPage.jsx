import { useState, useEffect, useCallback } from 'react'
import { Pencil, Trash2, Plus, Tag } from 'lucide-react'
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

// ── Line Item Modal ───────────────────────────────────────────────────────────

function LineItemModal({ item, categories, funds, onClose, onSave }) {
  const [name, setName] = useState(item?.name ?? '')
  const [type, setType] = useState(item?.type ?? 'bill')
  const [amount, setAmount] = useState(item ? (item.amount_cents / 100).toFixed(2) : '')
  const [actual, setActual] = useState(item?.actual_cents ? (item.actual_cents / 100).toFixed(2) : '')
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '')
  const [fundId, setFundId] = useState(item?.fund_id ?? '')
  const [newFundName, setNewFundName] = useState('')
  const [fundMode, setFundMode] = useState('existing')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    if (!amount) return setError('Amount is required')
    if (type === 'fund' && fundMode === 'existing' && !fundId) return setError('Select a fund')
    if (type === 'fund' && fundMode === 'new' && !newFundName.trim()) return setError('Enter a fund name')
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: name.trim(),
        type,
        amount_cents: toCents(amount),
        actual_cents: actual ? toCents(actual) : 0,
        category_id: type === 'bill' && categoryId !== '' ? Number(categoryId) : null,
        fund_id: type === 'fund' && fundMode === 'existing' && fundId !== '' ? Number(fundId) : null,
        new_fund_name: type === 'fund' && fundMode === 'new' ? newFundName.trim() : null,
      }
      await onSave(payload)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const selectClass = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400 bg-white'

  return (
    <Modal title={item ? 'Edit Line Item' : 'Add Line Item'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rent, Groceries, Vacation"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
        </div>

        {!item && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
            <div className="flex gap-2">
              {['bill', 'fund'].map((t) => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                    type === t ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
                  }`}>
                  {t === 'bill' ? 'Bill' : 'Fund Contribution'}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Planned</label>
            <input type="number" step="0.01" min="0" value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Actual <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input type="number" step="0.01" min="0" value={actual}
              onChange={(e) => setActual(e.target.value)} placeholder="0.00"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
          </div>
        </div>

        {type === 'bill' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectClass}>
              <option value="">Uncategorized</option>
              {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </select>
          </div>
        )}

        {type === 'fund' && (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">Fund</label>
            <div className="flex gap-2">
              {['existing', 'new'].map((m) => (
                <button key={m} type="button" onClick={() => setFundMode(m)}
                  className={`flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                    fundMode === m ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'
                  }`}>
                  {m === 'existing' ? 'Link existing' : 'Create new'}
                </button>
              ))}
            </div>
            {fundMode === 'existing' ? (
              <select value={fundId} onChange={(e) => setFundId(e.target.value)} className={selectClass}>
                <option value="">Select fund…</option>
                {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            ) : (
              <input value={newFundName} onChange={(e) => setNewFundName(e.target.value)}
                placeholder="New fund name"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900 outline-none focus:ring-2 focus:ring-slate-400" />
            )}
          </div>
        )}

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
          const over = b.actual_cents > 0 && b.actual_cents > b.amount_cents
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
  const [incomeSources, setIncomeSources] = useState([])
  const [summary, setSummary] = useState(null)
  const [lineItems, setLineItems] = useState([])
  const [categories, setCategories] = useState([])
  const [funds, setFunds] = useState([])

  const [showAddSource, setShowAddSource] = useState(false)
  const [editSource, setEditSource] = useState(null)
  const [showAddItem, setShowAddItem] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [showAddCat, setShowAddCat] = useState(false)
  const [editCat, setEditCat] = useState(null)

  const load = useCallback(async () => {
    const [srcRes, sumRes, itemsRes, catRes, fundsRes] = await Promise.all([
      fetch('/api/income-sources'),
      fetch('/api/monthly-summary'),
      fetch('/api/line-items/'),
      fetch('/api/line-items/categories'),
      fetch('/api/funds/'),
    ])
    setIncomeSources(await srcRes.json())
    setSummary(await sumRes.json())
    setLineItems(await itemsRes.json())
    setCategories(await catRes.json())
    setFunds(await fundsRes.json())
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

  const bills = lineItems.filter((i) => i.type === 'bill')
  const fundItems = lineItems.filter((i) => i.type === 'fund')
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

  const totalPlanned = bills.reduce((s, b) => s + b.amount_cents, 0)
  const totalActual = bills.reduce((s, b) => s + b.actual_cents, 0)

  const thisMonthName = (() => {
    const d = new Date()
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  })()

  return (
    <div className="px-4 pt-6 pb-6 space-y-6">
      <h1 className="text-3xl font-bold text-slate-950">Expenses</h1>

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
            <span className="font-semibold text-sm">Net to Savings</span>
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
              return <BillGroup key={cat.id} label={cat.name} bills={group} onEdit={setEditItem} onDelete={handleDeleteItem} />
            })}
            {uncategorized.length > 0 && (
              <BillGroup label="Uncategorized" bills={uncategorized} onEdit={setEditItem} onDelete={handleDeleteItem} />
            )}
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
          </div>
        )}
      </div>

      {/* Fund Contributions */}
      {fundItems.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3 px-1">Fund Contributions</p>
          <div className="space-y-2">
            {fundItems.map((item) => {
              const linked = funds.find((f) => f.id === item.fund_id)
              return (
                <div key={item.id} className="bg-white rounded-3xl border border-slate-100 shadow-sm p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{item.name}</p>
                      {linked && <p className="text-xs text-slate-400 mt-0.5">→ {linked.name}</p>}
                    </div>
                    <p className="font-mono font-bold text-slate-900">{c(item.amount_cents)}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setEditItem(item)}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDeleteItem(item)}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddSource && <IncomeSourceModal onClose={() => setShowAddSource(false)} onSave={handleCreateSource} />}
      {editSource && <IncomeSourceModal source={editSource} onClose={() => setEditSource(null)} onSave={(d) => handleUpdateSource(editSource.id, d)} />}
      {showAddItem && <LineItemModal categories={categories} funds={funds} onClose={() => setShowAddItem(false)} onSave={handleCreateItem} />}
      {editItem && <LineItemModal item={editItem} categories={categories} funds={funds} onClose={() => setEditItem(null)} onSave={(d) => handleUpdateItem(editItem.id, d)} />}
      {showAddCat && <CategoryModal onClose={() => setShowAddCat(false)} onSave={handleCreateCat} />}
      {editCat && <CategoryModal category={editCat} onClose={() => setEditCat(null)} onSave={(d) => handleUpdateCat(editCat.id, d)} />}
    </div>
  )
}
