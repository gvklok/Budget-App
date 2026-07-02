import { useState, useEffect, useCallback } from 'react'
import { Pencil, Trash2, Plus, Tag, ChevronDown, ChevronUp, Receipt, PieChart } from 'lucide-react'
import { fmt, toCents } from '../api'
import { CHART_COLORS, LINE, statusColor } from '../theme'
import Modal from '../components/Modal'
import { Card, SectionLabel, Ring, Bar, Badge, PrimaryButton, IconButton, EmptyState, Segmented } from '../components/ui'

function c(cents) { return fmt(cents / 100) }
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtDate(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}

const inputClass =
  'w-full border border-line rounded-2xl px-3.5 py-2.5 text-ink outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-shadow bg-white'
const labelClass = 'block text-sm font-medium text-ink-2 mb-1.5'

// ── Donut Ring Chart — category breakdown ──────────────────────────────────────

function DonutChart({ segments }) {
  const SIZE = 216
  const cx = SIZE / 2, cy = SIZE / 2
  const R = 80, SW = 26
  const circ = 2 * Math.PI * R
  const total = segments.reduce((s, seg) => s + seg.planned, 0)
  const totalSpent = segments.reduce((s, seg) => s + seg.spent, 0)
  if (total === 0) return <p className="text-ink-3 text-sm text-center py-8">No planned spending to chart</p>

  let cumFrac = 0
  const GAP = 3

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={cx} cy={cy} r={R} fill="none" stroke={LINE} strokeWidth={SW} />
          {segments.map((seg, i) => {
            const frac = seg.planned / total
            const dash = Math.max(0, frac * circ - GAP)
            const rot = -90 + cumFrac * 360
            cumFrac += frac
            return (
              <circle key={i} cx={cx} cy={cy} r={R} fill="none"
                stroke={seg.color} strokeWidth={SW} strokeLinecap="round"
                strokeDasharray={`${dash} ${circ}`}
                transform={`rotate(${rot} ${cx} ${cy})`} />
            )
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-ink tabular">{c(totalSpent)}</span>
          <span className="text-xs text-ink-3">spent</span>
          <span className="text-xs text-ink-3/70 mt-0.5 tabular">of {c(total)}</span>
        </div>
      </div>
      <div className="w-full space-y-2.5">
        {segments.map((seg) => {
          const pct = seg.planned > 0 ? Math.round((seg.spent / seg.planned) * 100) : 0
          const over = seg.spent > seg.planned
          return (
            <div key={seg.label} className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: seg.color }} />
              <span className="flex-1 text-sm text-ink-2 truncate">{seg.label}</span>
              <span className={`text-xs font-mono font-semibold tabular ${over ? 'text-critical' : 'text-ink-2'}`}>
                {c(seg.spent)}
              </span>
              <span className="text-xs text-ink-3">/</span>
              <span className="text-xs font-mono text-ink-3 tabular">{c(seg.planned)}</span>
              <span className={`text-xs w-9 text-right tabular ${over ? 'text-critical' : 'text-ink-3'}`}>{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Allocation Bar — where expected income is going ────────────────────────────

function AllocationBar({ income, bills, funds, net }) {
  if (income <= 0) return null
  const rawBills = (bills / income) * 100
  const rawFunds = (funds / income) * 100
  const rawNet = Math.max(0, (net / income) * 100)
  const sum = rawBills + rawFunds + rawNet
  const scale = sum > 100 ? 100 / sum : 1
  const billsPct = rawBills * scale
  const fundsPct = rawFunds * scale
  const netPct = rawNet * scale

  return (
    <div className="space-y-3">
      <div className="h-3 rounded-full bg-paper overflow-hidden flex gap-[2px]">
        {billsPct > 0 && <div className="h-full bg-ink-3" style={{ width: `${billsPct}%` }} />}
        {fundsPct > 0 && <div className="h-full bg-accent" style={{ width: `${fundsPct}%` }} />}
        {netPct > 0 && <div className={`h-full ${net >= 0 ? 'bg-good' : 'bg-critical'}`} style={{ width: `${netPct}%` }} />}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-ink-2">
          <span className="w-2 h-2 rounded-full bg-ink-3 shrink-0" />Bills <span className="text-ink-3 tabular">{c(bills)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-ink-2">
          <span className="w-2 h-2 rounded-full bg-accent shrink-0" />Funds <span className="text-ink-3 tabular">{c(funds)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-ink-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${net >= 0 ? 'bg-good' : 'bg-critical'}`} />
          {net >= 0 ? 'Savings' : 'Short'} <span className="text-ink-3 tabular">{c(Math.abs(net))}</span>
        </span>
      </div>
    </div>
  )
}

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
    setSaving(true); setError('')
    try { await onSave({ name: name.trim(), amount_cents: toCents(amount), frequency }); onClose() }
    catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <Modal title={source ? 'Edit Income Source' : 'Add Income Source'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>Name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Salary, Freelance"
            className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Amount per payment</label>
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
            className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Frequency</label>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={inputClass}>
            {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        {error && <p className="text-sm text-critical">{error}</p>}
        <PrimaryButton type="submit" disabled={saving} className="w-full">
          {saving ? 'Saving…' : source ? 'Save Changes' : 'Add'}
        </PrimaryButton>
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
    e.preventDefault(); setSaving(true)
    try { await onSave({ monthly_contribution_cents: toCents(contribution || '0') }); onClose() }
    catch (err) { /* ignore */ } finally { setSaving(false) }
  }

  return (
    <Modal title={`${fund.name} — Monthly Contribution`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>Monthly contribution</label>
          <input autoFocus type="number" step="0.01" min="0" value={contribution}
            onChange={(e) => setContribution(e.target.value)} placeholder="0.00"
            className={inputClass} />
          <p className="text-xs text-ink-3 mt-1.5">Set to 0 to exclude from contributions total</p>
        </div>
        <PrimaryButton type="submit" disabled={saving} className="w-full">
          {saving ? 'Saving…' : 'Save'}
        </PrimaryButton>
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
    setSaving(true); setError('')
    try {
      const payload = {
        amount_cents: toCents(amount), date, merchant: merchant.trim() || null,
        ...(mode === 'category' ? { line_item_id: Number(lineItemId) } : { fund_id: Number(fundId) }),
      }
      await onSave(payload); onClose()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <Modal title="Log Transaction" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Segmented
          options={[{ value: 'category', label: 'Bill' }, { value: 'fund', label: 'Fund' }]}
          value={mode} onChange={setMode}
        />
        {mode === 'category' ? (
          <div>
            <label className={labelClass}>Bill</label>
            <select value={lineItemId} onChange={(e) => setLineItemId(e.target.value)} className={inputClass}>
              <option value="">Select…</option>
              {bills.map((li) => <option key={li.id} value={li.id}>{li.name}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label className={labelClass}>Fund</label>
            <select value={fundId} onChange={(e) => setFundId(e.target.value)} className={inputClass}>
              <option value="">Select…</option>
              {funds.map((f) => <option key={f.id} value={f.id}>{f.name} ({c(f.balance_cents)} available)</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={labelClass}>Amount</label>
          <input autoFocus type="number" step="0.01" min="0" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
            className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>
              Merchant <span className="text-ink-3 font-normal">(optional)</span>
            </label>
            <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="e.g. Walmart" className={inputClass} />
          </div>
        </div>
        {error && <p className="text-sm text-critical">{error}</p>}
        <PrimaryButton type="submit" disabled={saving} className="w-full">
          {saving ? 'Saving…' : 'Log'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

// ── Bill Line Item Modal ──────────────────────────────────────────────────────

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
    setSaving(true); setError('')
    try {
      await onSave({ name: name.trim(), type: 'bill', amount_cents: toCents(amount), actual_cents: 0, category_id: categoryId !== '' ? Number(categoryId) : null })
      onClose()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <Modal title={item ? 'Edit Bill' : 'Add Bill'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>Name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rent, Groceries" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Monthly amount</label>
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Category</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
            <option value="">Uncategorized</option>
            {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
        </div>
        {error && <p className="text-sm text-critical">{error}</p>}
        <PrimaryButton type="submit" disabled={saving} className="w-full">
          {saving ? 'Saving…' : item ? 'Save Changes' : 'Add'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

// ── Manage Categories Modal — list + rename + delete + add, all in one place ──

function ManageCategoriesModal({ categories, onClose, onCreate, onRename, onDelete }) {
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  async function handleAdd(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setAdding(true)
    try { await onCreate({ name: newName.trim() }); setNewName('') } finally { setAdding(false) }
  }

  function startRename(cat) { setRenamingId(cat.id); setRenameValue(cat.name) }

  async function commitRename(cat) {
    const trimmed = renameValue.trim()
    setRenamingId(null)
    if (!trimmed || trimmed === cat.name) return
    await onRename(cat.id, { name: trimmed })
  }

  return (
    <Modal title="Manage Categories" onClose={onClose}>
      <div className="space-y-4">
        {categories.length === 0 ? (
          <p className="text-sm text-ink-3">No categories yet — add one below.</p>
        ) : (
          <div className="rounded-2xl border border-line divide-y divide-line overflow-hidden">
            {categories.map((cat) => (
              <div key={cat.id} className="flex items-center gap-2 px-3.5 py-2">
                {renamingId === cat.id ? (
                  <input
                    autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(cat)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(cat)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    className="flex-1 border border-line rounded-lg px-2.5 py-1.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/40"
                  />
                ) : (
                  <span className="flex-1 text-sm text-ink">{cat.name}</span>
                )}
                <IconButton onClick={() => startRename(cat)}><Pencil size={13} /></IconButton>
                <IconButton onClick={() => onDelete(cat)} className="hover:bg-critical-soft hover:text-critical"><Trash2 size={13} /></IconButton>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleAdd} className="flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category name"
            className={`${inputClass} flex-1`} />
          <PrimaryButton type="submit" disabled={adding || !newName.trim()} className="px-4 shrink-0">Add</PrimaryButton>
        </form>
      </div>
    </Modal>
  )
}

// ── Shared expandable item row — bar-based spent/budget ───────────────────────

function ItemRow({ name, subtitle, budgetCents, spentCents, txns, onEdit, onDelete, onLogTx, onDeleteTx }) {
  const [expanded, setExpanded] = useState(false)
  const remaining = budgetCents - spentCents
  const over = spentCents > budgetCents
  const pct = budgetCents > 0 ? (spentCents / budgetCents) * 100 : 0
  const color = statusColor(pct)

  return (
    <div>
      <div className="flex items-center gap-2.5 px-4 py-3.5">
        <button onClick={() => setExpanded((v) => !v)}
          className="shrink-0 w-5 h-5 flex items-center justify-center text-ink-3 hover:text-ink-2">
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-ink truncate">{name}</p>
            <p className="text-sm tabular shrink-0">
              <span className={`font-semibold ${spentCents === 0 ? 'text-ink-3' : over ? 'text-critical' : 'text-ink'}`}>
                {spentCents === 0 ? '—' : c(spentCents)}
              </span>
              <span className="text-ink-3"> / {c(budgetCents)}</span>
            </p>
          </div>
          {subtitle && <p className="text-xs text-ink-3 truncate mt-0.5">{subtitle}</p>}
          {budgetCents > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <Bar pct={pct} color={color} height={6} />
              <span className={`text-[11px] w-16 text-right shrink-0 tabular ${over ? 'text-critical font-semibold' : 'text-ink-3'}`}>
                {over ? `−${c(Math.abs(remaining))}` : `${c(remaining)} left`}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {onLogTx && <IconButton onClick={onLogTx} title="Log transaction"><Receipt size={13} /></IconButton>}
          {onEdit && <IconButton onClick={onEdit}><Pencil size={13} /></IconButton>}
          {onDelete && <IconButton onClick={onDelete} className="hover:bg-critical-soft hover:text-critical"><Trash2 size={13} /></IconButton>}
        </div>
      </div>
      {expanded && (
        <div className="mx-4 mb-3 rounded-2xl bg-paper overflow-hidden">
          {txns.length === 0
            ? <p className="text-xs text-ink-3 px-4 py-3">No transactions this month</p>
            : <div className="divide-y divide-line">
                {txns.map((tx) => (
                  <div key={tx.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-xs text-ink-3 w-16 shrink-0">{fmtDate(tx.date)}</span>
                    <span className="flex-1 text-xs text-ink-2 truncate">{tx.merchant || '—'}</span>
                    <span className="font-mono text-xs font-semibold text-ink tabular">{c(tx.amount_cents)}</span>
                    <button onClick={() => onDeleteTx(tx)} className="w-6 h-6 flex items-center justify-center rounded-full text-ink-3 hover:bg-critical-soft hover:text-critical"><Trash2 size={11} /></button>
                  </div>
                ))}
              </div>
          }
        </div>
      )}
    </div>
  )
}

// ── Bill group (collapsible by category) ─────────────────────────────────────

function GroupSummary({ label, planned, spent }) {
  const pct = planned > 0 ? (spent / planned) * 100 : 0
  const remaining = planned - spent
  const over = spent > planned
  return (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-2 truncate">{label}</p>
      {spent > 0 && (
        <div className="flex-1 max-w-[120px]">
          <Bar pct={pct} color={statusColor(pct)} height={5} animate={false} />
        </div>
      )}
      <span className="text-xs font-semibold text-ink-2 tabular shrink-0 ml-auto">
        {spent > 0 ? c(spent) : '—'}<span className="text-ink-3 font-normal"> / {c(planned)}</span>
      </span>
    </div>
  )
}

function BillGroup({ label, bills, txnsByItemId, onEdit, onDelete, onLogTx, onDeleteTx }) {
  const [open, setOpen] = useState(true)
  const totalPlanned = bills.reduce((s, b) => s + b.amount_cents, 0)
  const totalSpent = bills.reduce((s, b) => s + (txnsByItemId[b.id] ?? []).reduce((a, t) => a + t.amount_cents, 0), 0)
  const totalRemaining = totalPlanned - totalSpent

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-paper/70 border-b border-line">
        <div className="w-5 shrink-0 flex items-center justify-center text-ink-3">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </div>
        {open
          ? <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</p>
          : <GroupSummary label={label} planned={totalPlanned} spent={totalSpent} />}
      </button>
      {open && (
        <>
          <div className="divide-y divide-line">
            {bills.map((b) => {
              const itemTxns = txnsByItemId[b.id] ?? []
              const spent = itemTxns.reduce((s, t) => s + t.amount_cents, 0)
              return <ItemRow key={b.id} name={b.name} budgetCents={b.amount_cents} spentCents={spent} txns={itemTxns}
                onEdit={() => onEdit(b)} onDelete={() => onDelete(b)} onLogTx={() => onLogTx(b.id)} onDeleteTx={onDeleteTx} />
            })}
          </div>
          {bills.length > 1 && (
            <div className="flex items-center px-4 py-2.5 border-t border-line bg-paper/50">
              <div className="w-5 shrink-0" />
              <p className="text-xs font-semibold text-ink-2 mr-auto">Subtotal</p>
              <span className={`text-xs font-semibold tabular ${totalSpent === 0 ? 'text-ink-3' : totalRemaining < 0 ? 'text-critical' : 'text-ink-2'}`}>
                {totalSpent === 0 ? '—' : c(totalSpent)}<span className="text-ink-3 font-normal"> / {c(totalPlanned)}</span>
              </span>
            </div>
          )}
        </>
      )}
    </Card>
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

  const [showBreakdown, setShowBreakdown] = useState(false)
  const [billsOpen, setBillsOpen] = useState(true)
  const [fundsOpen, setFundsOpen] = useState(true)
  const [incomeOpen, setIncomeOpen] = useState(false)

  const [showAddSource, setShowAddSource] = useState(false)
  const [editSource, setEditSource] = useState(null)
  const [showAddItem, setShowAddItem] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [showCatManager, setShowCatManager] = useState(false)
  const [editFundContrib, setEditFundContrib] = useState(null)
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
  async function handleDeleteSource(s) { if (!confirm(`Delete "${s.name}"?`)) return; await del(`/api/income-sources/${s.id}`); await load() }
  async function handleCreateItem(data) { await post('/api/line-items/', data); await load() }
  async function handleUpdateItem(id, data) { await patch(`/api/line-items/${id}`, data); await load() }
  async function handleDeleteItem(item) { if (!confirm(`Delete "${item.name}"?`)) return; await del(`/api/line-items/${item.id}`); await load() }
  async function handleCreateCat(data) { await post('/api/line-items/categories', data); await load() }
  async function handleUpdateCat(id, data) { await patch(`/api/line-items/categories/${id}`, data); await load() }
  async function handleDeleteCat(cat) { if (!confirm(`Delete "${cat.name}"? Bills become uncategorized.`)) return; await del(`/api/line-items/categories/${cat.id}`); await load() }
  async function handleUpdateFundContrib(id, data) { await patch(`/api/funds/${id}`, data); await load() }
  async function handleLogTx(data) { await post('/api/transactions/', data); await load() }
  async function handleDeleteTx(tx) { if (!confirm('Delete this transaction?')) return; await del(`/api/transactions/${tx.id}`); await load() }

  // Current month transactions
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const currentMonthTxns = transactions.filter((tx) => {
    const [y, m] = tx.date.split('-').map(Number)
    return y === currentYear && m === currentMonth
  })

  const txnsByItemId = {}
  for (const tx of currentMonthTxns.filter((t) => t.line_item_id)) {
    if (!txnsByItemId[tx.line_item_id]) txnsByItemId[tx.line_item_id] = []
    txnsByItemId[tx.line_item_id].push(tx)
  }
  const txnsByFundId = {}
  for (const tx of currentMonthTxns.filter((t) => t.fund_id)) {
    if (!txnsByFundId[tx.fund_id]) txnsByFundId[tx.fund_id] = []
    txnsByFundId[tx.fund_id].push(tx)
  }

  const bills = lineItems.filter((i) => i.type === 'bill')
  const catMap = Object.fromEntries(categories.map((cat) => [cat.id, cat.name]))
  const grouped = {}
  const uncategorized = []
  for (const b of bills) {
    if (b.category_id && catMap[b.category_id]) {
      if (!grouped[b.category_id]) grouped[b.category_id] = []
      grouped[b.category_id].push(b)
    } else { uncategorized.push(b) }
  }

  // Totals
  const totalBillPlanned = bills.reduce((s, b) => s + b.amount_cents, 0)
  const totalBillSpent = bills.reduce((s, b) => s + (txnsByItemId[b.id] ?? []).reduce((a, t) => a + t.amount_cents, 0), 0)
  const totalFundPlanned = funds.reduce((s, f) => s + f.monthly_contribution_cents, 0)
  const totalFundSpent = funds.reduce((s, f) => s + (txnsByFundId[f.id] ?? []).reduce((a, t) => a + t.amount_cents, 0), 0)
  const totalPlanned = totalBillPlanned + totalFundPlanned
  const totalSpent = totalBillSpent + totalFundSpent
  const billPct = totalBillPlanned > 0 ? (totalBillSpent / totalBillPlanned) * 100 : 0
  const fundPct = totalFundPlanned > 0 ? (totalFundSpent / totalFundPlanned) * 100 : 0
  const overBillsCount = bills.filter((b) => (txnsByItemId[b.id] ?? []).reduce((s, t) => s + t.amount_cents, 0) > b.amount_cents).length
  const overFundsCount = funds.filter((f) => (txnsByFundId[f.id] ?? []).reduce((s, t) => s + t.amount_cents, 0) > f.monthly_contribution_cents).length

  // Donut chart segments
  const chartSegments = []
  let colorIdx = 0
  for (const cat of categories) {
    const catBills = grouped[cat.id] ?? []
    const planned = catBills.reduce((s, b) => s + b.amount_cents, 0)
    const spent = catBills.reduce((s, b) => s + (txnsByItemId[b.id] ?? []).reduce((a, t) => a + t.amount_cents, 0), 0)
    if (planned > 0) chartSegments.push({ label: cat.name, color: CHART_COLORS[colorIdx++ % CHART_COLORS.length], planned, spent })
  }
  if (uncategorized.length > 0) {
    const planned = uncategorized.reduce((s, b) => s + b.amount_cents, 0)
    const spent = uncategorized.reduce((s, b) => s + (txnsByItemId[b.id] ?? []).reduce((a, t) => a + t.amount_cents, 0), 0)
    if (planned > 0) chartSegments.push({ label: 'Uncategorized', color: '#9c9484', planned, spent })
  }
  for (const f of funds) {
    if (f.monthly_contribution_cents > 0) {
      const spent = (txnsByFundId[f.id] ?? []).reduce((s, t) => s + t.amount_cents, 0)
      chartSegments.push({ label: f.name, color: CHART_COLORS[colorIdx++ % CHART_COLORS.length], planned: f.monthly_contribution_cents, spent })
    }
  }

  const thisMonthName = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`

  return (
    <div className="px-4 pt-6 pb-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-ink tracking-tight">Expenses</h1>
        <button onClick={() => setLogTx({})}
          className="flex items-center gap-1.5 bg-ink text-white text-sm font-semibold px-4 py-2 rounded-full active:scale-[0.98] transition-transform">
          <Receipt size={15} />Log
        </button>
      </div>

      {/* This month's income allocation */}
      {summary && summary.expected_income_cents > 0 && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-ink-3">{thisMonthName} · Expected income</p>
            {summary.expected_savings_cents >= 0 ? (
              <Badge tone="good">{Math.round((summary.expected_savings_cents / summary.expected_income_cents) * 100)}% saved</Badge>
            ) : (
              <Badge tone="critical">Overspending</Badge>
            )}
          </div>
          <p className="text-3xl font-bold text-ink tabular">{c(summary.expected_income_cents)}</p>

          <AllocationBar
            income={summary.expected_income_cents}
            bills={summary.expected_bills_total_cents}
            funds={summary.expected_fund_contributions_total_cents}
            net={summary.expected_savings_cents}
          />
        </Card>
      )}

      {/* Spending progress — Bills and Funds are funded differently, so tracked separately */}
      {(totalBillPlanned > 0 || totalFundPlanned > 0) && (
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-4">Spending Progress</p>
          <div className="grid grid-cols-2 gap-3">
            {totalBillPlanned > 0 && (
              <div className="flex flex-col items-center gap-2.5 text-center">
                <Ring pct={billPct} size={76} stroke={8} color={statusColor(billPct)}>
                  <span className="text-base font-bold text-ink tabular">{Math.round(billPct)}%</span>
                </Ring>
                <div>
                  <p className="text-xs font-semibold text-ink-2">Bills</p>
                  <p className="text-xs text-ink-3 tabular">{c(totalBillSpent)} / {c(totalBillPlanned)}</p>
                </div>
              </div>
            )}
            {totalFundPlanned > 0 && (
              <div className="flex flex-col items-center gap-2.5 text-center">
                <Ring pct={fundPct} size={76} stroke={8} color={statusColor(fundPct)}>
                  <span className="text-base font-bold text-ink tabular">{Math.round(fundPct)}%</span>
                </Ring>
                <div>
                  <p className="text-xs font-semibold text-ink-2">Funds</p>
                  <p className="text-xs text-ink-3 tabular">{c(totalFundSpent)} / {c(totalFundPlanned)}</p>
                </div>
              </div>
            )}
          </div>

          <button onClick={() => setShowBreakdown((v) => !v)}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-ink-2 mt-4 pt-4 border-t border-line">
            <PieChart size={13} />{showBreakdown ? 'Hide' : 'Show'} category breakdown
          </button>
          {showBreakdown && <div className="mt-4"><DonutChart segments={chartSegments} /></div>}
        </Card>
      )}

      {/* Income Sources — collapsible, it's setup not a daily glance */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <button onClick={() => setIncomeOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            {incomeOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}Income Sources
          </button>
          <button onClick={() => setShowAddSource(true)} className="flex items-center gap-1 text-sm font-semibold text-ink">
            <Plus size={16} />Add
          </button>
        </div>
        {incomeOpen && (
          incomeSources.length === 0 ? (
            <EmptyState title="No income sources yet" action={
              <button onClick={() => setShowAddSource(true)} className="text-sm font-semibold text-accent">Add income source →</button>
            } />
          ) : (
            <div className="space-y-2">
              {incomeSources.map((s) => (
                <Card key={s.id} className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink truncate">{s.name}</p>
                      <p className="text-xs text-ink-3 mt-0.5 tabular">{c(s.amount_cents)} · {freqLabel(s.frequency)}</p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <IconButton onClick={() => setEditSource(s)}><Pencil size={14} /></IconButton>
                      <IconButton onClick={() => handleDeleteSource(s)} className="hover:bg-critical-soft hover:text-critical"><Trash2 size={14} /></IconButton>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        )}
      </div>

      {/* Bills — collapsible */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <button onClick={() => setBillsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            {billsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}Bills
            {overBillsCount > 0 && <Badge tone="critical">{overBillsCount} over budget</Badge>}
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowCatManager(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-ink-2 border border-line bg-white rounded-full pl-2.5 pr-3 py-1.5 active:scale-[0.98] transition-transform">
              <Tag size={12} />Categories
            </button>
            <button onClick={() => setShowAddItem(true)}
              className="flex items-center gap-1 text-sm font-semibold text-ink pl-2">
              <Plus size={16} />Add
            </button>
          </div>
        </div>

        {billsOpen && (
          <>
            {bills.length === 0 ? (
              <EmptyState title="No bills yet — add one above" />
            ) : (
              <div className="space-y-3">
                {categories.map((cat) => {
                  const group = grouped[cat.id]
                  if (!group?.length) return null
                  return <BillGroup key={cat.id} label={cat.name} bills={group} txnsByItemId={txnsByItemId}
                    onEdit={setEditItem} onDelete={handleDeleteItem}
                    onLogTx={(id) => setLogTx({ lineItemId: id })} onDeleteTx={handleDeleteTx} />
                })}
                {uncategorized.length > 0 && (
                  <BillGroup label="Uncategorized" bills={uncategorized} txnsByItemId={txnsByItemId}
                    onEdit={setEditItem} onDelete={handleDeleteItem}
                    onLogTx={(id) => setLogTx({ lineItemId: id })} onDeleteTx={handleDeleteTx} />
                )}
                <div className="flex items-center px-4 py-3">
                  <p className="flex-1 text-sm font-bold text-ink">Total</p>
                  <span className={`text-sm font-bold tabular ${(totalBillPlanned - totalBillSpent) < 0 ? 'text-critical' : 'text-ink'}`}>
                    {totalBillSpent === 0 ? '—' : c(totalBillSpent)}<span className="text-ink-3 font-normal"> / {c(totalBillPlanned)}</span>
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Funds — collapsible */}
      {funds.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <button onClick={() => setFundsOpen((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              {fundsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}Funds
              {overFundsCount > 0 && <Badge tone="critical">{overFundsCount} over budget</Badge>}
            </button>
          </div>
          {fundsOpen && (
            <Card className="overflow-hidden">
              <div className="divide-y divide-line">
                {funds.map((fund) => {
                  const fundTxns = txnsByFundId[fund.id] ?? []
                  const spent = fundTxns.reduce((s, t) => s + t.amount_cents, 0)
                  return <ItemRow key={fund.id} name={fund.name}
                    subtitle={fund.monthly_contribution_cents === 0 ? 'No contribution set' : null}
                    budgetCents={fund.monthly_contribution_cents} spentCents={spent} txns={fundTxns}
                    onEdit={() => setEditFundContrib(fund)}
                    onLogTx={() => setLogTx({ fundId: fund.id })}
                    onDeleteTx={handleDeleteTx} />
                })}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Modals */}
      {logTx && <LogTransactionModal bills={bills} funds={funds} defaultLineItemId={logTx.lineItemId} defaultFundId={logTx.fundId} onClose={() => setLogTx(null)} onSave={handleLogTx} />}
      {showAddSource && <IncomeSourceModal onClose={() => setShowAddSource(false)} onSave={handleCreateSource} />}
      {editSource && <IncomeSourceModal source={editSource} onClose={() => setEditSource(null)} onSave={(d) => handleUpdateSource(editSource.id, d)} />}
      {showAddItem && <LineItemModal categories={categories} onClose={() => setShowAddItem(false)} onSave={handleCreateItem} />}
      {editItem && <LineItemModal item={editItem} categories={categories} onClose={() => setEditItem(null)} onSave={(d) => handleUpdateItem(editItem.id, d)} />}
      {showCatManager && (
        <ManageCategoriesModal
          categories={categories}
          onClose={() => setShowCatManager(false)}
          onCreate={handleCreateCat}
          onRename={handleUpdateCat}
          onDelete={handleDeleteCat}
        />
      )}
      {editFundContrib && <FundContributionModal fund={editFundContrib} onClose={() => setEditFundContrib(null)} onSave={(d) => handleUpdateFundContrib(editFundContrib.id, d)} />}
    </div>
  )
}
