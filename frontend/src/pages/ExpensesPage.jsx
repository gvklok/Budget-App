import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Pencil, Trash2, Plus, Tag, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Receipt, PieChart, AlertTriangle } from 'lucide-react'
import { fmt, toCents, apiGet, apiPost, apiPatch, apiDel } from '../api'
import { LINE, CRITICAL, ACCENT, CALM, statusColor, colorForId } from '../theme'
import Modal from '../components/Modal'
import { Card, SectionLabel, Ring, Bar, Badge, PrimaryButton, IconButton, EmptyState, Segmented } from '../components/ui'

function c(cents) { return fmt(cents / 100) }
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtDate(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}
function shiftMonth({ year, month }, delta) {
  let m = month + delta
  let y = year
  if (m < 1) { m = 12; y -= 1 }
  if (m > 12) { m = 1; y += 1 }
  return { year: y, month: m }
}

// Bills are supposed to be spent to plan — 100% is normal, not a warning, so
// the on-plan fill stays a calm, light sage rather than a heavy dark bar.
// Only overspending a Bill is a signal. Funds keep the shared statusColor
// (which has a warn zone) since they're discretionary.
function billStatusColor(pct) {
  return pct > 100 ? CRITICAL : CALM
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
                stroke={seg.color} strokeWidth={SW} strokeLinecap="butt"
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

function LogTransactionModal({ bills, funds, defaultLineItemId, defaultFundId, defaultDate, onClose, onSave }) {
  const today = defaultDate ?? new Date().toISOString().slice(0, 10)
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

// ── Source Labeling Prompt (U5) — mid-month Bill increases must say where the
// extra money is coming from: relabel from another Bill, or move real money
// from Savings. Cancel reverts the edit that triggered this.

function SourceLabelModal({ prompt, bills, onCancel, onReallocate, onTransfer }) {
  const otherBills = bills.filter((b) => b.id !== prompt.itemId)
  const [choice, setChoice] = useState('reduce')
  const [reduceFromId, setReduceFromId] = useState(otherBills[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    setSaving(true)
    setError('')
    try {
      if (choice === 'reduce') {
        if (!reduceFromId) return setError('Pick a Bill to reduce')
        await onReallocate(Number(reduceFromId))
      } else {
        await onTransfer()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const optionClass = (active) =>
    `flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-colors ${
      active ? 'border-accent bg-accent-soft' : 'border-line bg-white'
    }`

  return (
    <Modal title={`Where is the additional ${c(prompt.delta)} coming from?`} onClose={onCancel}>
      <div className="space-y-4">
        <p className="text-xs text-ink-3">{prompt.itemName} went up by {c(prompt.delta)} this month.</p>

        <label className={optionClass(choice === 'reduce')} onClick={() => setChoice('reduce')}>
          <input type="radio" checked={choice === 'reduce'} onChange={() => setChoice('reduce')} className="mt-1" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink">Reduce another Bill this month</p>
            <p className="text-xs text-ink-3 mt-0.5">No money moves — just relabels where the budget comes from. Monthly Reserve is unaffected.</p>
            {choice === 'reduce' && otherBills.length > 0 && (
              <select
                value={reduceFromId}
                onChange={(e) => setReduceFromId(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className={`${inputClass} mt-2`}
              >
                {otherBills.map((b) => <option key={b.id} value={b.id}>{b.name} — {c(b.amount_cents)}</option>)}
              </select>
            )}
            {choice === 'reduce' && otherBills.length === 0 && (
              <p className="text-xs text-critical mt-2">No other Bills this month to reduce from.</p>
            )}
          </div>
        </label>

        <label className={optionClass(choice === 'transfer')} onClick={() => setChoice('transfer')}>
          <input type="radio" checked={choice === 'transfer'} onChange={() => setChoice('transfer')} className="mt-1" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink">Transfer from Savings</p>
            <p className="text-xs text-ink-3 mt-0.5">Moves {c(prompt.delta)} from Savings into Monthly Reserve. Real money moves.</p>
          </div>
        </label>

        {error && <p className="text-sm text-critical">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onCancel} disabled={saving}
            className="flex-1 border border-line bg-white text-ink-2 font-semibold rounded-2xl py-3 disabled:opacity-40">
            Cancel
          </button>
          <PrimaryButton onClick={handleConfirm} disabled={saving || (choice === 'reduce' && otherBills.length === 0)} className="flex-1">
            {saving ? 'Saving…' : 'Confirm'}
          </PrimaryButton>
        </div>
      </div>
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

function ItemRow({ name, subtitle, budgetCents, spentCents, txns, onEdit, onDelete, onLogTx, onDeleteTx, negative, recoveryNote, color: colorOverride }) {
  const [expanded, setExpanded] = useState(false)
  const remaining = budgetCents - spentCents
  const over = spentCents > budgetCents
  const pct = budgetCents > 0 ? (spentCents / budgetCents) * 100 : 0
  const color = colorOverride ?? statusColor(pct)

  return (
    <div>
      <div className="px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <button onClick={() => setExpanded((v) => !v)}
            className="shrink-0 w-5 h-5 mt-0.5 flex items-center justify-center text-ink-3 hover:text-ink-2">
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          <div className="flex-1 min-w-0">
            {/* Name gets its own row, full width — nothing squeezes it to an ellipsis */}
            <div className="flex items-center justify-between gap-1.5">
              <p className="min-w-0 text-sm font-medium text-ink flex items-center gap-1.5">
                {negative && <AlertTriangle size={12} className="text-critical shrink-0" />}
                <span className="truncate">{name}</span>
              </p>
              <div className="flex items-center shrink-0">
                {onLogTx && <IconButton compact onClick={onLogTx} title="Log transaction"><Receipt size={12} /></IconButton>}
                {onEdit && <IconButton compact onClick={onEdit}><Pencil size={12} /></IconButton>}
                {onDelete && <IconButton compact onClick={onDelete} className="hover:bg-critical-soft hover:text-critical"><Trash2 size={12} /></IconButton>}
              </div>
            </div>
            {negative && <Badge tone="critical" className="mt-1">Recovering</Badge>}
            {subtitle && <p className="text-xs text-ink-3 mt-0.5">{subtitle}</p>}
            {recoveryNote && <p className="text-xs text-critical mt-0.5">{recoveryNote}</p>}
            {budgetCents > 0 && (
              <div className="mt-2">
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <span className="text-xs tabular">
                    <span className={`font-semibold ${spentCents === 0 ? 'text-ink-3' : over ? 'text-critical' : 'text-ink'}`}>
                      {spentCents === 0 ? '—' : c(spentCents)}
                    </span>
                    <span className="text-ink-3"> / {c(budgetCents)}</span>
                  </span>
                  <span className={`text-xs shrink-0 tabular ${over ? 'text-critical font-semibold' : 'text-ink-3'}`}>
                    {over ? `over by ${c(Math.abs(remaining))}` : `${c(remaining)} left`}
                  </span>
                </div>
                <Bar pct={pct} color={color} height={6} />
              </div>
            )}
          </div>
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
                    {onDeleteTx && <button onClick={() => onDeleteTx(tx)} className="w-6 h-6 flex items-center justify-center rounded-full text-ink-3 hover:bg-critical-soft hover:text-critical"><Trash2 size={11} /></button>}
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
          <Bar pct={pct} color={billStatusColor(pct)} height={5} animate={false} />
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
              const billPct = b.amount_cents > 0 ? (spent / b.amount_cents) * 100 : 0
              return <ItemRow key={b.id} name={b.name} budgetCents={b.amount_cents} spentCents={spent} txns={itemTxns}
                color={billStatusColor(billPct)}
                onEdit={onEdit && (() => onEdit(b))} onDelete={onDelete && (() => onDelete(b))}
                onLogTx={onLogTx && (() => onLogTx(b.id))} onDeleteTx={onDeleteTx} />
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
  const [effectiveDate, setEffectiveDate] = useState(null) // YYYY-MM-DD, from AppClock (U2)

  // U8: the viewed month lives in the URL, not just component state — so a
  // reload keeps you looking at the same month (and correctly re-locks it,
  // rather than silently jumping back to the current month on every refresh).
  const [searchParams, setSearchParams] = useSearchParams()
  const [selected, setSelectedRaw] = useState(() => {
    const y = Number(searchParams.get('year'))
    const m = Number(searchParams.get('month'))
    return y && m ? { year: y, month: m } : null
  })
  function setSelected(next) {
    setSelectedRaw(next)
    setSearchParams(next ? { year: String(next.year), month: String(next.month) } : {}, { replace: true })
  }

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
  const [reallocatePrompt, setReallocatePrompt] = useState(null) // U5: { itemId, itemName, delta, isNew, oldAmount? }
  const [unlockedMonth, setUnlockedMonth] = useState(null) // U8: { year, month } currently unlocked for editing this session
  const [loadError, setLoadError] = useState('')

  // Resolve the effective "today" once on mount, then default the viewed month to it
  // (unless the URL already names one).
  const loadEffectiveDate = useCallback(async () => {
    try {
      const d = await apiGet('/dev/current-date')
      setEffectiveDate(d.effective_date)
      if (!selected) {
        const [y, m] = d.effective_date.split('-').map(Number)
        setSelected({ year: y, month: m })
      }
      setLoadError('')
    } catch (err) {
      setLoadError(err.message || 'Failed to load')
    }
  }, [selected])

  useEffect(() => { loadEffectiveDate() }, [])

  const load = useCallback(async () => {
    if (!selected) return
    try {
      const [srcData, sumData, plan, catData, fundsData, txData, clock] = await Promise.all([
        apiGet('/income-sources'),
        apiGet(`/monthly-summary?year=${selected.year}&month=${selected.month}`),
        apiGet(`/plans/${selected.year}/${selected.month}`),
        apiGet('/line-items/categories'),
        apiGet('/funds/'),
        apiGet('/transactions/'),
        apiGet('/dev/current-date'),
      ])
      setIncomeSources(srcData)
      setSummary(sumData)
      setLineItems(plan.line_items)
      setCategories(catData)
      setFunds(fundsData)
      setTransactions(txData)
      setEffectiveDate(clock.effective_date)
      setLoadError('')
    } catch (err) {
      setLoadError(err.message || 'Failed to load')
    }
  }, [selected])

  useEffect(() => { load() }, [load])

  // U8: navigating away from an unlocked past month re-locks it (per-session unlock only)
  useEffect(() => { setUnlockedMonth(null) }, [selected?.year, selected?.month])

  useEffect(() => {
    window.addEventListener('dev-refresh', load)
    return () => window.removeEventListener('dev-refresh', load)
  }, [load])

  async function handleCreateSource(data) { await apiPost('/income-sources', data); await load() }
  async function handleUpdateSource(id, data) { await apiPatch(`/income-sources/${id}`, data); await load() }
  async function handleDeleteSource(s) { if (!confirm(`Delete "${s.name}"?`)) return; await apiDel(`/income-sources/${s.id}`); await load() }
  async function handleCreateItem(data) {
    const created = await apiPost('/line-items/', { ...data, year: selected.year, month: selected.month })
    await load()
    // U5: adding a new Bill to the CURRENT month always prompts for source labeling
    if (isCurrentMonth && created.type === 'bill' && created.amount_cents > 0) {
      setReallocatePrompt({ itemId: created.id, itemName: created.name, delta: created.amount_cents, isNew: true })
    }
  }
  async function handleUpdateItem(id, data) {
    const before = lineItems.find((i) => i.id === id)
    const updated = await apiPatch(`/line-items/${id}`, data)
    await load()
    // U5: only a Bill INCREASE in the CURRENT month prompts — decreases, Fund
    // edits, and edits to other months are silent.
    if (isCurrentMonth && updated.type === 'bill' && before && updated.amount_cents > before.amount_cents) {
      setReallocatePrompt({
        itemId: id, itemName: updated.name,
        delta: updated.amount_cents - before.amount_cents,
        isNew: false, oldAmount: before.amount_cents,
      })
    }
  }
  async function handleDeleteItem(item) { if (!confirm(`Delete "${item.name}"?`)) return; await apiDel(`/line-items/${item.id}`); await load() }
  async function handleCreateCat(data) { await apiPost('/line-items/categories', data); await load() }
  async function handleUpdateCat(id, data) { await apiPatch(`/line-items/categories/${id}`, data); await load() }
  async function handleDeleteCat(cat) { if (!confirm(`Delete "${cat.name}"? Bills become uncategorized.`)) return; await apiDel(`/line-items/categories/${cat.id}`); await load() }
  async function handleUpdateFundContrib(id, data) { await apiPatch(`/funds/${id}`, data); await load() }
  async function handleLogTx(data) { await apiPost('/transactions/', data); await load() }
  async function handleDeleteTx(tx) { if (!confirm('Delete this transaction?')) return; await apiDel(`/transactions/${tx.id}`); await load() }

  // U5: resolve the source-labeling prompt
  async function handleReallocate(decreasedLineItemId) {
    await apiPost('/line-items/reallocate', {
      increased_line_item_id: reallocatePrompt.itemId,
      decreased_line_item_id: decreasedLineItemId,
      amount_cents: reallocatePrompt.delta,
    })
    await load()
    setReallocatePrompt(null)
  }
  async function handleTransferForPrompt() {
    await apiPost('/transfers/', { from_bucket: 'savings', to_bucket: 'mr', amount_cents: reallocatePrompt.delta })
    await load()
    setReallocatePrompt(null)
  }
  async function handleCancelPrompt() {
    if (reallocatePrompt.isNew) {
      await apiDel(`/line-items/${reallocatePrompt.itemId}`)
    } else {
      await apiPatch(`/line-items/${reallocatePrompt.itemId}`, { amount_cents: reallocatePrompt.oldAmount })
    }
    await load()
    setReallocatePrompt(null)
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-64 px-4">
        <Card className="p-6 text-center max-w-sm">
          <p className="text-sm text-critical mb-4">{loadError}</p>
          <PrimaryButton onClick={selected ? load : loadEffectiveDate}>Retry</PrimaryButton>
        </Card>
      </div>
    )
  }

  if (!selected) {
    return <div className="flex items-center justify-center h-64 text-ink-3">Loading…</div>
  }

  // Transactions in the VIEWED month (U3) — navigating the month selector
  // changes what counts as "this month" throughout the page.
  const currentYear = selected.year
  const currentMonth = selected.month
  const [effYear, effMonth] = (effectiveDate ?? `${currentYear}-${String(currentMonth).padStart(2, '0')}`).split('-').map(Number)
  const isCurrentMonth = currentYear === effYear && currentMonth === effMonth
  const isPastMonth = currentYear < effYear || (currentYear === effYear && currentMonth < effMonth)
  const isUnlockedForThisMonth = !!(unlockedMonth && unlockedMonth.year === currentYear && unlockedMonth.month === currentMonth)
  const locked = isPastMonth && !isUnlockedForThisMonth
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
  // A page-level Bills "Total" is only informative when it aggregates more
  // than one group — with exactly one populated group of >1 bills, that
  // group's own Subtotal already shows the identical number.
  const populatedBillGroupCount = Object.values(grouped).filter((g) => g.length > 0).length + (uncategorized.length > 0 ? 1 : 0)
  const billTotalRedundant = populatedBillGroupCount === 1 && bills.length > 1

  // Totals
  // U1: transfer-out Funds (401k, Roth, HSA, ...) don't count as spending — the
  // money moved to another account you own. They're reported separately below.
  const fundSpent = (f) => (txnsByFundId[f.id] ?? []).reduce((a, t) => a + t.amount_cents, 0)
  const totalBillPlanned = bills.reduce((s, b) => s + b.amount_cents, 0)
  const totalBillSpent = bills.reduce((s, b) => s + (txnsByItemId[b.id] ?? []).reduce((a, t) => a + t.amount_cents, 0), 0)
  const totalFundPlanned = funds.reduce((s, f) => s + f.monthly_contribution_cents, 0)
  const totalFundSpent = funds.filter((f) => f.destination_type !== 'transfer_out').reduce((s, f) => s + fundSpent(f), 0)
  const transfersOutTotal = funds.filter((f) => f.destination_type === 'transfer_out').reduce((s, f) => s + fundSpent(f), 0)
  const totalPlanned = totalBillPlanned + totalFundPlanned
  const totalSpent = totalBillSpent + totalFundSpent
  const billPct = totalBillPlanned > 0 ? (totalBillSpent / totalBillPlanned) * 100 : 0
  const fundPct = totalFundPlanned > 0 ? (totalFundSpent / totalFundPlanned) * 100 : 0
  const overBillsCount = bills.filter((b) => (txnsByItemId[b.id] ?? []).reduce((s, t) => s + t.amount_cents, 0) > b.amount_cents).length
  const overFundsCount = funds.filter((f) => (txnsByFundId[f.id] ?? []).reduce((s, t) => s + t.amount_cents, 0) > f.monthly_contribution_cents).length

  // Donut chart segments
  const chartSegments = []
  for (const cat of categories) {
    const catBills = grouped[cat.id] ?? []
    const planned = catBills.reduce((s, b) => s + b.amount_cents, 0)
    const spent = catBills.reduce((s, b) => s + (txnsByItemId[b.id] ?? []).reduce((a, t) => a + t.amount_cents, 0), 0)
    if (planned > 0) chartSegments.push({ label: cat.name, color: colorForId(cat.id), planned, spent })
  }
  if (uncategorized.length > 0) {
    const planned = uncategorized.reduce((s, b) => s + b.amount_cents, 0)
    const spent = uncategorized.reduce((s, b) => s + (txnsByItemId[b.id] ?? []).reduce((a, t) => a + t.amount_cents, 0), 0)
    if (planned > 0) chartSegments.push({ label: 'Uncategorized', color: '#9c9484', planned, spent })
  }
  for (const f of funds) {
    if (f.monthly_contribution_cents > 0 && f.destination_type !== 'transfer_out') {
      const spent = (txnsByFundId[f.id] ?? []).reduce((s, t) => s + t.amount_cents, 0)
      chartSegments.push({ label: f.name, color: colorForId(f.id), planned: f.monthly_contribution_cents, spent })
    }
  }

  const thisMonthName = `${MONTHS[currentMonth - 1]} ${currentYear}`
  const logTxDefaultDate = isCurrentMonth ? effectiveDate : `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`

  return (
    <div className="px-4 pt-6 pb-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-ink tracking-tight">Expenses</h1>
        {!locked && (
          <button onClick={() => setLogTx({})}
            className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-semibold px-4 py-2 rounded-full active:scale-[0.98] transition-transform">
            <Receipt size={15} />Log
          </button>
        )}
      </div>

      {/* Month selector (U3) */}
      <div className="flex items-center justify-center gap-1">
        <IconButton onClick={() => setSelected(shiftMonth(selected, -1))}><ChevronLeft size={16} /></IconButton>
        <p className="text-sm font-semibold text-ink w-32 text-center tabular">{thisMonthName}</p>
        <IconButton onClick={() => setSelected(shiftMonth(selected, 1))}><ChevronRight size={16} /></IconButton>
        {!isCurrentMonth && (
          <button
            onClick={() => setSelected({ year: effYear, month: effMonth })}
            className="text-xs font-semibold text-accent ml-1"
          >
            Today
          </button>
        )}
      </div>

      {/* Read-only / edit-unlock indicator (U8) — past months only; current and
          future months are always editable with no lock at all */}
      {isPastMonth && (
        <div className="flex items-center justify-center">
          {locked ? (
            <div className="flex items-center gap-2 bg-paper border border-line rounded-full px-3 py-1.5">
              <Badge tone="neutral">Read only</Badge>
              <button onClick={() => setUnlockedMonth({ year: currentYear, month: currentMonth })}
                className="text-xs font-semibold text-accent">
                Edit
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-warn-soft border border-warn/20 rounded-full px-3 py-1.5">
              <Badge tone="warn">Editing</Badge>
              <button onClick={() => setUnlockedMonth(null)} className="text-xs font-semibold text-ink-2">
                Done
              </button>
            </div>
          )}
        </div>
      )}

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
                <Ring pct={billPct} size={76} stroke={8} color={billStatusColor(billPct)}>
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

          {transfersOutTotal > 0 && (
            <div className="mt-4 pt-4 border-t border-line flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-ink-2">Transfers out</p>
                <p className="text-[11px] text-ink-3">Moved to accounts you own — not spending</p>
              </div>
              <span className="text-sm font-semibold text-accent tabular">{c(transfersOutTotal)}</span>
            </div>
          )}

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
          {!locked && (
            <button onClick={() => setShowAddSource(true)} className="flex items-center gap-1 text-sm font-semibold text-ink">
              <Plus size={16} />Add
            </button>
          )}
        </div>
        {incomeOpen && (
          incomeSources.length === 0 ? (
            <EmptyState title="No income sources yet" action={
              !locked && <button onClick={() => setShowAddSource(true)} className="text-sm font-semibold text-accent">Add income source →</button>
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
                    {!locked && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <IconButton onClick={() => setEditSource(s)}><Pencil size={14} /></IconButton>
                        <IconButton onClick={() => handleDeleteSource(s)} className="hover:bg-critical-soft hover:text-critical"><Trash2 size={14} /></IconButton>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )
        )}
      </div>

      {/* Bills — collapsible, month-scoped (U3/U4: unplanned months auto-load
          from the most recent prior plan, so there's always a plan by the time
          this renders) */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <button onClick={() => setBillsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            {billsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}Bills
            {overBillsCount > 0 && <Badge tone="critical">{overBillsCount} over budget</Badge>}
          </button>
          {!locked && (
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
          )}
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
                    onEdit={locked ? undefined : setEditItem} onDelete={locked ? undefined : handleDeleteItem}
                    onLogTx={locked ? undefined : (id) => setLogTx({ lineItemId: id })} onDeleteTx={locked ? undefined : handleDeleteTx} />
                })}
                {uncategorized.length > 0 && (
                  <BillGroup label="Uncategorized" bills={uncategorized} txnsByItemId={txnsByItemId}
                    onEdit={locked ? undefined : setEditItem} onDelete={locked ? undefined : handleDeleteItem}
                    onLogTx={locked ? undefined : (id) => setLogTx({ lineItemId: id })} onDeleteTx={locked ? undefined : handleDeleteTx} />
                )}
                {!billTotalRedundant && (
                  <div className="flex items-center px-4 py-3">
                    <p className="flex-1 text-sm font-bold text-ink">Total</p>
                    <span className={`text-sm font-bold tabular ${(totalBillPlanned - totalBillSpent) < 0 ? 'text-critical' : 'text-ink'}`}>
                      {totalBillSpent === 0 ? '—' : c(totalBillSpent)}<span className="text-ink-3 font-normal"> / {c(totalBillPlanned)}</span>
                    </span>
                  </div>
                )}
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
                  const subtitle = fund.destination_type === 'transfer_out'
                    ? 'Transfer out — not counted as spending'
                    : fund.monthly_contribution_cents === 0 ? 'No contribution set' : null
                  // U9: recovery timeline for Funds allowed to go negative
                  const isNegative = fund.balance_cents < 0
                  let recoveryNote = null
                  if (isNegative) {
                    recoveryNote = fund.monthly_contribution_cents > 0
                      ? `At ${c(fund.monthly_contribution_cents)}/mo, back to $0 in ~${Math.ceil(Math.abs(fund.balance_cents) / fund.monthly_contribution_cents)} months`
                      : 'No contribution set — will not recover automatically'
                  }
                  // Transfer-out funds hitting their target is SUCCESS (money moved to an
                  // account you own), never danger — so they never wear the warn/critical
                  // statusColor zones a discretionary Fund would at the same percentage.
                  const isTransferOut = fund.destination_type === 'transfer_out'
                  return <ItemRow key={fund.id} name={fund.name}
                    subtitle={subtitle} negative={isNegative} recoveryNote={recoveryNote}
                    budgetCents={fund.monthly_contribution_cents} spentCents={spent} txns={fundTxns}
                    color={isTransferOut ? ACCENT : undefined}
                    onEdit={locked ? undefined : () => setEditFundContrib(fund)}
                    onLogTx={locked ? undefined : () => setLogTx({ fundId: fund.id })}
                    onDeleteTx={locked ? undefined : handleDeleteTx} />
                })}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Modals */}
      {logTx && <LogTransactionModal bills={bills} funds={funds} defaultLineItemId={logTx.lineItemId} defaultFundId={logTx.fundId} defaultDate={logTxDefaultDate} onClose={() => setLogTx(null)} onSave={handleLogTx} />}
      {reallocatePrompt && (
        <SourceLabelModal
          prompt={reallocatePrompt}
          bills={bills}
          onCancel={handleCancelPrompt}
          onReallocate={handleReallocate}
          onTransfer={handleTransferForPrompt}
        />
      )}
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
