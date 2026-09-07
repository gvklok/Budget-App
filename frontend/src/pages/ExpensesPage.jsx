import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Pencil, Trash2, Plus, Tag, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Receipt, PieChart, AlertTriangle, ArrowUpDown, List, X } from 'lucide-react'
import { fmt, toCents, apiGet, apiPost, apiPatch, apiDel } from '../api'
import { LINE, INK_3, CRITICAL, BILLS, FUNDS_HUE, SAVING, SAVING_TEXT, TRANSFER_OUT, billStatusColor, fundStatusColor, colorForId, colorForName, entityColor, billColor } from '../theme'
import Modal from '../components/Modal'
import { Card, SectionLabel, Ring, Bar, Badge, PrimaryButton, IconButton, EmptyState, Segmented, OverflowMenu, ColorSwatchPicker, RecoveryBadge } from '../components/ui'
import { useRefetchOnFocus } from '../hooks'

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

const inputClass =
  'w-full border border-line rounded-2xl px-3.5 py-2.5 text-ink outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-shadow bg-card'
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

  const netColor = net >= 0 ? SAVING : CRITICAL

  return (
    <div className="space-y-3">
      <div className="h-3 rounded-full bg-paper overflow-hidden flex gap-[2px]">
        {billsPct > 0 && <div className="h-full" style={{ width: `${billsPct}%`, background: BILLS }} />}
        {fundsPct > 0 && <div className="h-full" style={{ width: `${fundsPct}%`, background: FUNDS_HUE }} />}
        {netPct > 0 && <div className="h-full" style={{ width: `${netPct}%`, background: netColor }} />}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-ink-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: BILLS }} />Bills <span className="text-ink-3 tabular">{c(bills)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-ink-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: FUNDS_HUE }} />Funds <span className="text-ink-3 tabular">{c(funds)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-ink-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: netColor }} />
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
  // anchor_date drives weekly/biweekly/monthly schedules; semimonthly uses two
  // day-of-month numbers instead. Legacy sources (pre-schedule) come through
  // with these all null — render empty rather than crash, per spec.
  const [anchorDate, setAnchorDate] = useState(source?.anchor_date ?? '')
  const [semiDay1, setSemiDay1] = useState(source?.semimonthly_day1 != null ? String(source.semimonthly_day1) : '')
  const [semiDay2, setSemiDay2] = useState(source?.semimonthly_day2 != null ? String(source.semimonthly_day2) : '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const isSemimonthly = frequency === 'semimonthly'
  const needsAnchor = frequency === 'monthly' || frequency === 'biweekly' || frequency === 'weekly'

  function validDay(v) {
    const n = Number(v)
    return v !== '' && Number.isInteger(n) && n >= 1 && n <= 31
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    if (!amount) return setError('Amount is required')
    if (needsAnchor && !anchorDate) return setError('Next pay date is required')
    if (isSemimonthly && (!validDay(semiDay1) || !validDay(semiDay2))) {
      return setError('Enter both pay days (1–31)')
    }
    setSaving(true); setError('')
    const payload = { name: name.trim(), amount_cents: toCents(amount), frequency }
    if (needsAnchor) payload.anchor_date = anchorDate
    if (isSemimonthly) { payload.semimonthly_day1 = Number(semiDay1); payload.semimonthly_day2 = Number(semiDay2) }
    try { await onSave(payload); onClose() }
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
        {needsAnchor && (
          <div>
            <label className={labelClass}>Next pay date</label>
            <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} className={inputClass} />
            <p className="text-xs text-ink-3 mt-1.5">
              {frequency === 'monthly' ? 'Repeats on this day every month.' : 'The app counts forward/back from this date.'}
            </p>
          </div>
        )}
        {isSemimonthly && (
          <div>
            <label className={labelClass}>Pay days</label>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <input type="number" min="1" max="31" step="1" value={semiDay1}
                  onChange={(e) => setSemiDay1(e.target.value)} placeholder="e.g. 1"
                  className={inputClass} />
                <p className="text-[11px] text-ink-3 mt-1">First pay day of month</p>
              </div>
              <div className="flex-1">
                <input type="number" min="1" max="31" step="1" value={semiDay2}
                  onChange={(e) => setSemiDay2(e.target.value)} placeholder="e.g. 15"
                  className={inputClass} />
                <p className="text-[11px] text-ink-3 mt-1">Second pay day of month</p>
              </div>
            </div>
            <p className="text-xs text-ink-3 mt-1.5">Use 31 for "last day of the month" — it'll adjust for shorter months automatically.</p>
          </div>
        )}
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

function LogTransactionModal({ bills, funds, incomeSources, defaultLineItemId, defaultFundId, defaultSourceId, defaultDate, onClose, onSave, onSaveSplit, onLogPaycheck, onLogMiscIncome }) {
  const today = defaultDate ?? new Date().toISOString().slice(0, 10)
  const [mode, setMode] = useState(defaultSourceId ? 'paycheck' : defaultFundId ? 'fund' : 'category')
  const [lineItemId, setLineItemId] = useState(defaultLineItemId ?? '')
  const [fundId, setFundId] = useState(defaultFundId ?? '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [merchant, setMerchant] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Split — the receipt total (above) is entered whole; each split row peels
  // off an exact amount to a DIFFERENT bucket (own Bill/Fund picker, since a
  // split can be a different type than the main selection), and whatever's
  // left implicitly stays with the main bucket. Collapsed by default — this
  // is a power feature, not part of the default logging flow.
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitRows, setSplitRows] = useState([])

  function toggleSplit() {
    setSplitOpen((v) => {
      const next = !v
      if (next && splitRows.length === 0) setSplitRows([{ key: Math.random().toString(36).slice(2), mode, itemId: '', amount: '' }])
      if (!next) setSplitRows([])
      return next
    })
  }
  function addSplitRow() {
    setSplitRows((rows) => [...rows, { key: Math.random().toString(36).slice(2), mode, itemId: '', amount: '' }])
  }
  function updateSplitRow(key, patch) {
    setSplitRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }
  function removeSplitRow(key) {
    setSplitRows((rows) => rows.filter((r) => r.key !== key))
  }

  // Live remainder — sums whatever's typed so far (even an incomplete row),
  // so the "X gets: $Y" math updates as he types, before he's picked a bucket.
  const splitsSumCents = splitRows.reduce((s, r) => s + (r.amount && Number(r.amount) > 0 ? toCents(r.amount) : 0), 0)
  const splitRemainderCents = toCents(amount || '0') - splitsSumCents
  const filledSplitRows = splitRows.filter((r) => r.itemId !== '' || r.amount !== '')
  const incompleteSplitRow = filledSplitRows.some((r) => !r.itemId || !r.amount || Number(r.amount) <= 0)
  const splitInvalid = splitOpen && (incompleteSplitRow || splitRemainderCents < 0)
  const mainSplitLabel = mode === 'category'
    ? (bills.find((b) => String(b.id) === String(lineItemId))?.name ?? 'The main Bill')
    : (funds.find((f) => String(f.id) === String(fundId))?.name ?? 'The main Fund')

  // Other income mode — one-off, non-recurring income (gift, Zelle, etc).
  // Lands in Savings, no source_id.
  const [miscAmount, setMiscAmount] = useState('')
  const [miscLabel, setMiscLabel] = useState('')
  const [miscDate, setMiscDate] = useState(today)

  // Paycheck mode — no fund/date/merchant, money lands on Savings now. Amount
  // pre-fills from the selected source (editable — bonus/odd checks) and
  // re-fills whenever the source selection changes.
  const initialSourceId = defaultSourceId ?? incomeSources?.[0]?.id ?? ''
  const [sourceId, setSourceId] = useState(initialSourceId)
  const [paycheckAmount, setPaycheckAmount] = useState(() => {
    const src = incomeSources?.find((s) => s.id === initialSourceId)
    return src ? (src.amount_cents / 100).toFixed(2) : ''
  })
  function handleSourceChange(id) {
    const numId = id === '' ? '' : Number(id)
    setSourceId(numId)
    const src = incomeSources?.find((s) => s.id === numId)
    if (src) setPaycheckAmount((src.amount_cents / 100).toFixed(2))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (mode === 'paycheck') {
      if (!sourceId) return setError('Select an income source')
      if (!paycheckAmount) return setError('Amount is required')
      setSaving(true); setError('')
      try {
        await onLogPaycheck({ source_id: Number(sourceId), amount_cents: toCents(paycheckAmount) })
        onClose()
      } catch (err) { setError(err.message) } finally { setSaving(false) }
      return
    }
    if (mode === 'other') {
      if (!miscAmount) return setError('Amount is required')
      setSaving(true); setError('')
      try {
        await onLogMiscIncome({ amount_cents: toCents(miscAmount), label: miscLabel.trim() || null, date: miscDate })
        onClose()
      } catch (err) { setError(err.message) } finally { setSaving(false) }
      return
    }
    if (mode === 'category' && !lineItemId) return setError('Select a line item')
    if (mode === 'fund' && !fundId) return setError('Select a fund')
    if (!amount) return setError('Amount is required')

    if (splitOpen) {
      if (incompleteSplitRow) return setError('Every split needs a bucket and a positive amount')
      const validSplitRows = splitRows.filter((r) => r.itemId && r.amount && Number(r.amount) > 0)
      if (validSplitRows.length > 0) {
        const totalCents = toCents(amount)
        const splitsSum = validSplitRows.reduce((s, r) => s + toCents(r.amount), 0)
        if (splitsSum > totalCents) return setError('Splits add up to more than the total amount')
        setSaving(true); setError('')
        try {
          const payload = {
            date, merchant: merchant.trim() || null,
            total_amount_cents: totalCents,
            main: mode === 'category' ? { line_item_id: Number(lineItemId) } : { fund_id: Number(fundId) },
            splits: validSplitRows.map((r) => ({
              amount_cents: toCents(r.amount),
              ...(r.mode === 'category' ? { line_item_id: Number(r.itemId) } : { fund_id: Number(r.itemId) }),
            })),
          }
          await onSaveSplit(payload); onClose()
        } catch (err) { setError(err.message) } finally { setSaving(false) }
        return
      }
    }

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
          options={[{ value: 'category', label: 'Bill' }, { value: 'fund', label: 'Fund' }, { value: 'paycheck', label: 'Paycheck' }, { value: 'other', label: 'Other Income' }]}
          value={mode} onChange={setMode}
        />
        {mode === 'category' && (
          <div>
            <label className={labelClass}>Bill</label>
            <select value={lineItemId} onChange={(e) => setLineItemId(e.target.value)} className={inputClass}>
              <option value="">Select…</option>
              {bills.map((li) => <option key={li.id} value={li.id}>{li.name}</option>)}
            </select>
          </div>
        )}
        {mode === 'fund' && (
          <div>
            <label className={labelClass}>Fund</label>
            <select value={fundId} onChange={(e) => setFundId(e.target.value)} className={inputClass}>
              <option value="">Select…</option>
              {funds.map((f) => <option key={f.id} value={f.id}>{f.name} ({c(f.balance_cents)} available)</option>)}
            </select>
          </div>
        )}
        {mode === 'paycheck' && (
          incomeSources && incomeSources.length > 0 ? (
            <>
              <div>
                <label className={labelClass}>Income source</label>
                <select value={sourceId} onChange={(e) => handleSourceChange(e.target.value)} className={inputClass}>
                  <option value="">Select…</option>
                  {incomeSources.map((s) => <option key={s.id} value={s.id}>{s.name} ({c(s.amount_cents)})</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Amount</label>
                <input autoFocus type="number" step="0.01" min="0" value={paycheckAmount}
                  onChange={(e) => setPaycheckAmount(e.target.value)} placeholder="0.00"
                  className={inputClass} />
                <p className="text-xs text-ink-3 mt-1.5">Pre-filled from the source — edit for a bonus or odd check.</p>
              </div>
              {paycheckAmount && Number(paycheckAmount) > 0 && (
                <p className="text-sm font-semibold" style={{ color: SAVING_TEXT }}>
                  + {c(toCents(paycheckAmount))} → Savings
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-3">Add an income source below first.</p>
          )
        )}
        {mode === 'other' && (
          <>
            <div>
              <label className={labelClass}>Amount</label>
              <input autoFocus type="number" step="0.01" min="0" value={miscAmount}
                onChange={(e) => setMiscAmount(e.target.value)} placeholder="0.00"
                className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <input value={miscLabel} onChange={(e) => setMiscLabel(e.target.value)}
                placeholder="e.g. Birthday gift from Mom, Zelle from Dave" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Date</label>
              <input type="date" value={miscDate} onChange={(e) => setMiscDate(e.target.value)} className={inputClass} />
            </div>
            {miscAmount && Number(miscAmount) > 0 && (
              <p className="text-sm font-semibold" style={{ color: SAVING_TEXT }}>
                + {c(toCents(miscAmount))} → Savings
              </p>
            )}
          </>
        )}
        {mode !== 'paycheck' && mode !== 'other' && (
          <>
            <div>
              <label className={labelClass}>Amount</label>
              <input autoFocus type="number" step="0.01" min="0" value={amount}
                onChange={(e) => setAmount(e.target.value)} placeholder="0.00 — full receipt total"
                className={inputClass} />
            </div>

            <button type="button" onClick={toggleSplit} className="text-xs font-semibold text-accent-ink">
              {splitOpen ? 'Cancel split' : '+ Split this'}
            </button>

            {splitOpen && (
              <div className="space-y-3 rounded-2xl border border-line p-3.5 bg-paper/50">
                <p className="text-xs text-ink-3">Splits go to their own bucket — whatever's left stays with the main one.</p>
                {splitRows.map((row) => {
                  const rowItems = row.mode === 'category' ? bills : funds
                  return (
                    <div key={row.key} className="space-y-2 rounded-xl bg-card border border-line p-2.5">
                      <div className="flex items-center gap-2">
                        <Segmented
                          options={[{ value: 'category', label: 'Bill' }, { value: 'fund', label: 'Fund' }]}
                          value={row.mode} onChange={(v) => updateSplitRow(row.key, { mode: v, itemId: '' })}
                        />
                        <button type="button" onClick={() => removeSplitRow(row.key)}
                          className="ml-auto w-7 h-7 flex items-center justify-center rounded-full text-ink-3 hover:bg-critical-soft hover:text-critical shrink-0">
                          <X size={14} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select value={row.itemId} onChange={(e) => updateSplitRow(row.key, { itemId: e.target.value })} className={inputClass}>
                          <option value="">Select…</option>
                          {rowItems.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                        </select>
                        <input type="number" step="0.01" min="0" value={row.amount}
                          onChange={(e) => updateSplitRow(row.key, { amount: e.target.value })}
                          placeholder="0.00" className={inputClass} />
                      </div>
                    </div>
                  )
                })}
                <button type="button" onClick={addSplitRow} className="text-xs font-semibold text-accent-ink">
                  + Add another split
                </button>
                <p className={`text-sm font-semibold ${splitRemainderCents < 0 ? 'text-critical' : 'text-ink'}`}>
                  {mainSplitLabel} gets: {c(splitRemainderCents)}
                </p>
                {splitRemainderCents < 0 && (
                  <p className="text-xs text-critical -mt-2">Splits add up to more than the total — reduce one.</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Merchant</label>
                <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Optional — e.g. Walmart" className={inputClass} />
              </div>
            </div>
          </>
        )}
        {error && <p className="text-sm text-critical">{error}</p>}
        <PrimaryButton type="submit"
          disabled={saving || splitInvalid || (mode === 'paycheck' && (!incomeSources || incomeSources.length === 0))}
          className="w-full">
          {saving ? 'Saving…' : mode === 'paycheck' ? 'Log paycheck' : mode === 'other' ? 'Log income' : 'Log'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}

// ── Bill Line Item Modal ──────────────────────────────────────────────────────

function LineItemModal({ item, categories, onClose, onSave, onDelete }) {
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState(item ? (item.amount_cents / 100).toFixed(2) : '')
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '')
  const [color, setColor] = useState(item?.color ?? null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    if (!amount) return setError('Amount is required')
    setSaving(true); setError('')
    try {
      await onSave({ name: name.trim(), type: 'bill', amount_cents: toCents(amount), actual_cents: 0, category_id: categoryId !== '' ? Number(categoryId) : null, color })
      onClose()
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  async function handleDeleteClick() {
    setDeleting(true)
    setError('')
    try {
      const deleted = await onDelete(item)
      if (deleted) onClose()
    } catch (err) {
      setError(err.message || 'Delete failed')
    } finally {
      setDeleting(false)
    }
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
        <ColorSwatchPicker value={color} onChange={setColor} autoColor={colorForName(name.trim() || 'Bill')} />
        {error && <p className="text-sm text-critical">{error}</p>}
        <PrimaryButton type="submit" disabled={saving} className="w-full">
          {saving ? 'Saving…' : item ? 'Save Changes' : 'Add'}
        </PrimaryButton>
        {/* Quiet destructive action, edit-mode only — mirrors EditFundModal's
            "Delete fund" footer so a bill row never needs its own trash icon
            (owner kept almost-tapping it there). */}
        {item && onDelete && (
          <div className="pt-3 border-t border-line">
            <button
              type="button"
              onClick={handleDeleteClick}
              disabled={deleting}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-critical py-1.5 disabled:opacity-40"
            >
              <Trash2 size={13} />
              {deleting ? 'Deleting…' : 'Delete bill'}
            </button>
          </div>
        )}
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
      active ? 'border-accent bg-accent-soft' : 'border-line bg-card'
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
            className="flex-1 border border-line bg-card text-ink-2 font-semibold rounded-2xl py-3 disabled:opacity-40">
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

function ManageCategoriesModal({
  categories, onClose, onCreate, onRename, onDelete,
  reordering, reorderList, reorderError, reorderSaving, populatedCatIds = new Set(), onStartReorder, onMoveReorder, onFinishReorder,
}) {
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
        {categories.length > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-3">
              {reordering ? 'Sets the order Bill groups appear in on Expenses.' : 'Order controls how Bill groups appear on Expenses.'}
            </p>
            {reordering ? (
              <button
                onClick={onFinishReorder}
                disabled={reorderSaving}
                className="text-xs font-semibold bg-accent text-white rounded-full px-3.5 py-1.5 disabled:opacity-40 active:scale-[0.98] transition-transform shrink-0"
              >
                {reorderSaving ? 'Saving…' : 'Done'}
              </button>
            ) : (
              <button onClick={onStartReorder} className="flex items-center gap-1 text-xs font-semibold text-ink-2 shrink-0">
                <ArrowUpDown size={13} />Reorder
              </button>
            )}
          </div>
        )}
        {reorderError && <p className="text-xs text-critical -mt-2">{reorderError}</p>}

        {reordering ? (
          <div className="rounded-2xl border border-line divide-y divide-line overflow-hidden">
            {reorderList.map((cat, index) => {
              // Disable a direction once there's no *populated* (has bills this
              // month) category left to swap with that way — otherwise the
              // button looks live but the click has zero visible effect.
              const noUp = !reorderList.slice(0, index).some((c) => populatedCatIds.has(c.id))
              const noDown = !reorderList.slice(index + 1).some((c) => populatedCatIds.has(c.id))
              return (
                <ReorderRow key={cat.id} name={cat.name}
                  first={noUp} last={noDown}
                  onUp={() => onMoveReorder(index, -1)} onDown={() => onMoveReorder(index, 1)} />
              )
            })}
          </div>
        ) : categories.length === 0 ? (
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
                    className="flex-1 border border-line rounded-lg px-2.5 py-1.5 text-base text-ink outline-none focus:ring-2 focus:ring-accent/40"
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
        {!reordering && (
          <form onSubmit={handleAdd} className="flex gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category name"
              className={`${inputClass} flex-1`} />
            <PrimaryButton type="submit" disabled={adding || !newName.trim()} className="px-4 shrink-0">Add</PrimaryButton>
          </form>
        )}
      </div>
    </Modal>
  )
}

// ── Shared expandable item row — bar-based spent/budget ───────────────────────

function ItemRow({ name, subtitle, budgetCents, spentCents, txns, onEdit, onLogTx, onDeleteTx, negative, recoveryNote, color: colorOverride }) {
  const [expanded, setExpanded] = useState(false)
  const remaining = budgetCents - spentCents
  const over = spentCents > budgetCents
  const pct = budgetCents > 0 ? (spentCents / budgetCents) * 100 : 0
  const color = colorOverride ?? fundStatusColor(pct)

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
              {/* Pencil left, Log rightmost (and a touch larger, not compact) —
                  the frequent action sits where the thumb lands; delete moved
                  into the edit modal as a quiet destructive action instead of
                  living on the row (owner kept almost-tapping it). */}
              <div className="flex items-center gap-0.5 shrink-0">
                {onEdit && <IconButton compact onClick={onEdit}><Pencil size={12} /></IconButton>}
                {onLogTx && <IconButton onClick={onLogTx} title="Log transaction"><Receipt size={14} /></IconButton>}
              </div>
            </div>
            {negative && <RecoveryBadge note={recoveryNote} className="mt-1" />}
            {subtitle && <p className="text-xs text-ink-3 mt-0.5">{subtitle}</p>}
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

function GroupSummary({ label, planned, spent, color }) {
  const pct = planned > 0 ? (spent / planned) * 100 : 0
  const remaining = planned - spent
  const over = spent > planned
  return (
    <div className="flex items-center gap-3 flex-1 min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-2 truncate">{label}</p>
      {spent > 0 && (
        <div className="flex-1 max-w-[120px]">
          <Bar pct={pct} color={pct > 100 ? CRITICAL : color} height={5} animate={false} />
        </div>
      )}
      <span className="text-xs font-semibold text-ink-2 tabular shrink-0 ml-auto">
        {spent > 0 ? c(spent) : '—'}<span className="text-ink-3 font-normal"> / {c(planned)}</span>
      </span>
    </div>
  )
}

function BillGroup({ label, bills, txnsByItemId, onEdit, onLogTx, onDeleteTx }) {
  const [open, setOpen] = useState(false)
  const totalPlanned = bills.reduce((s, b) => s + b.amount_cents, 0)
  const totalSpent = bills.reduce((s, b) => s + (txnsByItemId[b.id] ?? []).reduce((a, t) => a + t.amount_cents, 0), 0)
  const totalRemaining = totalPlanned - totalSpent
  // Collapsed summary bar reads as the topmost (first-in-order) bill's own
  // identity color, not a shared status color — so each category's collapsed
  // bar is visually distinct rather than every one looking the same.
  const topBillColor = bills.length > 0 ? billColor(bills[0]) : BILLS

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-paper/70 border-b border-line">
        <div className="w-5 shrink-0 flex items-center justify-center text-ink-3">
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </div>
        {open
          ? <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</p>
          : <GroupSummary label={label} planned={totalPlanned} spent={totalSpent} color={topBillColor} />}
      </button>
      {open && (
        <>
          <div className="divide-y divide-line">
            {bills.map((b) => {
              const itemTxns = txnsByItemId[b.id] ?? []
              const spent = itemTxns.reduce((s, t) => s + t.amount_cents, 0)
              const billPct = b.amount_cents > 0 ? (spent / b.amount_cents) * 100 : 0
              // Rows read as their own entity (billColor — custom color if set,
              // else a stable name-hash so a Bill's color never shifts month to
              // month even though its line-item id does; matching Where-it-went
              // and the Fund identity dots) rather than the semantic Bills brown —
              // that brown is reserved for aggregates (ring, allocation bar, group
              // subtotal bar via GroupSummary/billStatusColor). Overspend still
              // escalates to CRITICAL — honesty over identity.
              return <ItemRow key={b.id} name={b.name} budgetCents={b.amount_cents} spentCents={spent} txns={itemTxns}
                color={billPct > 100 ? CRITICAL : billColor(b)}
                onEdit={onEdit && (() => onEdit(b))}
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

// ── Reorder row — shared flat-list row for Bills/Funds reorder mode ──────────
// Calm, buttons-only reordering (no HTML5 drag-and-drop — unreliable on
// touch). First/last row disable their respective direction.

function ReorderRow({ name, amountCents, first, last, onUp, onDown }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-transform duration-[120ms]">
      <p className="flex-1 min-w-0 text-sm font-medium text-ink truncate">{name}</p>
      {amountCents != null && <span className="text-xs text-ink-3 tabular shrink-0">{c(amountCents)}</span>}
      <div className="flex items-center shrink-0 gap-1">
        <button
          onClick={onUp}
          disabled={first}
          className="w-10 h-10 flex items-center justify-center rounded-full text-ink-2 hover:bg-paper disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label={`Move ${name} up`}
        >
          <ChevronUp size={17} />
        </button>
        <button
          onClick={onDown}
          disabled={last}
          className="w-10 h-10 flex items-center justify-center rounded-full text-ink-2 hover:bg-paper disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label={`Move ${name} down`}
        >
          <ChevronDown size={17} />
        </button>
      </div>
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

  // Reorder mode — Bills (flattens category grouping while active, so order
  // is unambiguous) and Funds (reuses the funds reorder endpoint — Funds
  // section here lists Funds themselves, same order as FundsPage).
  const [billsReordering, setBillsReordering] = useState(false)
  const [billsReorderList, setBillsReorderList] = useState([])
  const [billsReorderError, setBillsReorderError] = useState('')
  const [billsReorderSaving, setBillsReorderSaving] = useState(false)
  const [fundsReordering, setFundsReordering] = useState(false)
  const [fundsReorderList, setFundsReorderList] = useState([])
  const [fundsReorderError, setFundsReorderError] = useState('')
  const [fundsReorderSaving, setFundsReorderSaving] = useState(false)
  // Categories — controls which order Bill groups appear in on this page (see
  // ManageCategoriesModal below); same up/down interaction, lives here rather
  // than in the modal so it follows the Bills/Funds precedent exactly.
  const [catReordering, setCatReordering] = useState(false)
  const [catReorderList, setCatReorderList] = useState([])
  const [catReorderError, setCatReorderError] = useState('')
  const [catReorderSaving, setCatReorderSaving] = useState(false)

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
  useRefetchOnFocus(load)

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
  async function handleDeleteItem(item) {
    if (!confirm(`Delete "${item.name}"?`)) return false
    await apiDel(`/line-items/${item.id}`)
    await load()
    return true
  }
  async function handleCreateCat(data) { await apiPost('/line-items/categories', data); await load() }
  async function handleUpdateCat(id, data) { await apiPatch(`/line-items/categories/${id}`, data); await load() }
  async function handleDeleteCat(cat) { if (!confirm(`Delete "${cat.name}"? Bills become uncategorized.`)) return; await apiDel(`/line-items/categories/${cat.id}`); await load() }
  async function handleUpdateFundContrib(id, data) { await apiPatch(`/funds/${id}`, data); await load() }
  async function handleLogTx(data) { await apiPost('/transactions/', data); await load() }
  async function handleLogSplitTx(data) { await apiPost('/transactions/split', data); await load() }
  async function handleLogPaycheck(data) {
    await apiPost('/paycheck', data)
    await load()
    window.dispatchEvent(new Event('dev-refresh'))
  }
  async function handleLogMiscIncome(data) {
    await apiPost('/income/misc', data)
    await load()
    window.dispatchEvent(new Event('dev-refresh'))
  }
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

  // Bills reorder mode — flattens category grouping to a single ungrouped
  // list (in true plan sort_order) so priority is unambiguous while active;
  // the grouped view re-derives from the persisted sort_order afterwards.
  function startBillsReorder() {
    setBillsReorderList([...bills].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id))
    setBillsReorderError('')
    setBillsReordering(true)
  }
  // Positions (in the flattened list) of every bill sharing `categoryId`, in
  // list order — used to keep Up/Down moves confined to one category's block
  // even if that block isn't contiguous (e.g. after past corrupted saves).
  function billsCategorySlots(list, categoryId) {
    const slots = []
    list.forEach((b, i) => { if (b.category_id === categoryId) slots.push(i) })
    return slots
  }
  function moveBillsReorder(index, dir) {
    setBillsReorderList((prev) => {
      const slots = billsCategorySlots(prev, prev[index].category_id)
      const pos = slots.indexOf(index)
      const targetPos = pos + dir
      if (targetPos < 0 || targetPos >= slots.length) return prev
      const target = slots[targetPos]
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  async function finishBillsReorder() {
    setBillsReorderSaving(true)
    setBillsReorderError('')
    try {
      await apiPost('/line-items/reorder', { ordered_ids: billsReorderList.map((b) => b.id) })
      await load()
      setBillsReordering(false)
    } catch (err) {
      setBillsReorderError(err.message || 'Reorder failed — order restored')
      await load()
      setBillsReordering(false)
    } finally {
      setBillsReorderSaving(false)
    }
  }

  // Funds reorder mode — reuses the FundsPage priority order (same endpoint,
  // same list) since this section literally lists Funds, not line items.
  function startFundsReorder() {
    setFundsReorderList(funds)
    setFundsReorderError('')
    setFundsReordering(true)
  }
  function moveFundsReorder(index, dir) {
    setFundsReorderList((prev) => {
      const target = index + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  async function finishFundsReorder() {
    setFundsReorderSaving(true)
    setFundsReorderError('')
    try {
      await apiPost('/funds/reorder', { ordered_ids: fundsReorderList.map((f) => f.id) })
      await load()
      setFundsReordering(false)
    } catch (err) {
      setFundsReorderError(err.message || 'Reorder failed — order restored')
      await load()
      setFundsReordering(false)
    } finally {
      setFundsReorderSaving(false)
    }
  }

  // Categories reorder mode — same flat-list up/down pattern as Funds; this
  // order is what the backend groups Bills by on this page (and everywhere
  // categories are used), so reordering here visibly reorders Bill groups.
  function startCatReorder() {
    setCatReorderList(categories)
    setCatReorderError('')
    setCatReordering(true)
  }
  function moveCatReorder(index, dir) {
    // Categories with zero bills this month render no Bill group at all, so a
    // plain adjacent-index swap can silently land on one of those — the click
    // "succeeds" (order data changes) but nothing visibly moves on Expenses,
    // which reads as completely broken. Skip past empty categories so a click
    // always swaps with the next category that's actually showing on screen
    // (or does nothing, if there is no such neighbor in that direction).
    const populatedIds = new Set(
      lineItems.filter((i) => i.type === 'bill' && i.category_id).map((i) => i.category_id)
    )
    setCatReorderList((prev) => {
      let target = index + dir
      while (target >= 0 && target < prev.length && !populatedIds.has(prev[target].id)) {
        target += dir
      }
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  async function finishCatReorder() {
    setCatReorderSaving(true)
    setCatReorderError('')
    try {
      await apiPost('/line-items/categories/reorder', { ordered_ids: catReorderList.map((cat) => cat.id) })
      await load()
      setCatReordering(false)
    } catch (err) {
      setCatReorderError(err.message || 'Reorder failed — order restored')
      await load()
      setCatReordering(false)
    } finally {
      setCatReorderSaving(false)
    }
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
  // Which categories actually render a Bill group right now — drives the
  // reorder Up/Down disabled state so a button never looks clickable when
  // it would silently do nothing (see moveCatReorder).
  const populatedCatIds = new Set(Object.keys(grouped).map(Number))

  // Totals
  // U1: transfer-out Funds (401k, Roth, HSA, ...) don't count as spending — the
  // money moved to another account you own. They're reported separately below.
  const fundSpent = (f) => (txnsByFundId[f.id] ?? []).reduce((a, t) => a + t.amount_cents, 0)
  const totalBillPlanned = bills.reduce((s, b) => s + b.amount_cents, 0)
  const totalBillSpent = bills.reduce((s, b) => s + (txnsByItemId[b.id] ?? []).reduce((a, t) => a + t.amount_cents, 0), 0)
  const totalFundPlanned = funds.reduce((s, f) => s + f.monthly_contribution_cents, 0)
  const totalFundSpent = funds.filter((f) => f.destination_type !== 'transfer_out' && f.monthly_contribution_cents > 0).reduce((s, f) => s + fundSpent(f), 0)
  const transfersOutTotal = funds.filter((f) => f.destination_type === 'transfer_out').reduce((s, f) => s + fundSpent(f), 0)
  const totalPlanned = totalBillPlanned + totalFundPlanned
  const totalSpent = totalBillSpent + totalFundSpent
  const billPct = totalBillPlanned > 0 ? (totalBillSpent / totalBillPlanned) * 100 : 0
  const fundPct = totalFundPlanned > 0 ? (totalFundSpent / totalFundPlanned) * 100 : 0
  const overBillsCount = bills.filter((b) => (txnsByItemId[b.id] ?? []).reduce((s, t) => s + t.amount_cents, 0) > b.amount_cents).length
  const overFundsCount = funds.filter((f) => f.monthly_contribution_cents > 0 && (txnsByFundId[f.id] ?? []).reduce((s, t) => s + t.amount_cents, 0) > f.monthly_contribution_cents).length

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
    if (planned > 0) chartSegments.push({ label: 'Uncategorized', color: INK_3, planned, spent })
  }
  for (const f of funds) {
    if (f.monthly_contribution_cents > 0 && f.destination_type !== 'transfer_out') {
      const spent = (txnsByFundId[f.id] ?? []).reduce((s, t) => s + t.amount_cents, 0)
      chartSegments.push({ label: f.name, color: entityColor(f), planned: f.monthly_contribution_cents, spent })
    }
  }

  const thisMonthName = `${MONTHS[currentMonth - 1]} ${currentYear}`
  const logTxDefaultDate = isCurrentMonth ? effectiveDate : `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`

  return (
    <div className="px-4 pt-6 pb-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-ink tracking-tight">Expenses</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/transactions"
            title="All transactions"
            aria-label="All transactions"
            className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-paper hover:text-ink-2 transition-colors"
          >
            <List size={17} />
          </Link>
          {!locked && (
            // Ink-black — the one sanctioned black pill, reserved for buttons
            // that LOG money, deliberately distinct from the accent language.
            <button onClick={() => setLogTx({})}
              className="flex items-center gap-1.5 bg-ink hover:bg-ink/90 text-on-ink text-sm font-semibold px-4 py-2 rounded-full active:scale-[0.98] transition-transform">
              <Receipt size={15} />Log
            </button>
          )}
        </div>
      </div>

      {/* Month selector (U3) */}
      <div className="flex items-center justify-center gap-1">
        <IconButton onClick={() => setSelected(shiftMonth(selected, -1))}><ChevronLeft size={16} /></IconButton>
        <p className="text-sm font-semibold text-ink w-32 text-center tabular">{thisMonthName}</p>
        <IconButton onClick={() => setSelected(shiftMonth(selected, 1))}><ChevronRight size={16} /></IconButton>
        {!isCurrentMonth && (
          <button
            onClick={() => setSelected({ year: effYear, month: effMonth })}
            className="text-xs font-semibold text-accent-ink ml-1"
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
                className="text-xs font-semibold text-accent-ink">
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
          <p className="text-xs text-ink-2 -mt-2">
            Expected expenses {c(summary.expected_bills_total_cents + summary.expected_fund_contributions_total_cents)}
            {' '}· Bills {c(summary.expected_bills_total_cents)} + Funds {c(summary.expected_fund_contributions_total_cents)}
          </p>

          <AllocationBar
            income={summary.expected_income_cents}
            bills={summary.expected_bills_total_cents}
            funds={summary.expected_fund_contributions_total_cents}
            net={summary.expected_savings_cents}
          />

          {/* Income received so far this month — kept minimal (a line + thin
              bar, no new card) per owner's explicit ask not to clutter this
              section. */}
          <div className="pt-3 border-t border-line">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-ink-2">Income received so far</span>
              <span className="tabular font-semibold" style={{ color: SAVING_TEXT }}>
                {c(summary.actual_income_cents ?? 0)}
                <span className="text-ink-3 font-normal"> of {c(summary.expected_income_cents)}</span>
              </span>
            </div>
            <Bar pct={((summary.actual_income_cents ?? 0) / summary.expected_income_cents) * 100} color={SAVING} height={4} animate={false} />
          </div>
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
                <Ring pct={fundPct} size={76} stroke={8} color={fundStatusColor(fundPct)}>
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
              <span className="text-sm font-semibold tabular" style={{ color: TRANSFER_OUT }}>{c(transfersOutTotal)}</span>
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
              !locked && <button onClick={() => setShowAddSource(true)} className="text-sm font-semibold text-accent-ink">Add income source →</button>
            } />
          ) : (
            <div className="space-y-2">
              {incomeSources.map((s) => (
                <Card key={s.id} className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink truncate">{s.name}</p>
                      <p className="text-xs text-ink-3 mt-0.5 tabular">
                        {c(s.amount_cents)} · {freqLabel(s.frequency)}
                        {s.next_pay_date
                          ? ` · Next ${fmtDate(s.next_pay_date)}`
                          : ' · No schedule set'}
                      </p>
                    </div>
                    {!locked && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <IconButton onClick={() => setEditSource(s)}><Pencil size={14} /></IconButton>
                        <IconButton onClick={() => handleDeleteSource(s)} className="hover:bg-critical-soft hover:text-critical"><Trash2 size={14} /></IconButton>
                        {/* Rightmost — same thumb logic as ItemRow's Log button; the
                            frequent income action lives where the thumb lands. */}
                        <button onClick={() => setLogTx({ sourceId: s.id })}
                          className="flex items-center gap-1 text-xs font-semibold text-saving-ink bg-saving-soft rounded-full px-2.5 py-1.5 active:scale-[0.98] transition-transform">
                          <Plus size={12} />Paycheck
                        </button>
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
          <button onClick={() => setBillsOpen((v) => !v)} disabled={billsReordering}
            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3 disabled:opacity-60">
            {billsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}Bills
            {overBillsCount > 0 && <Badge tone="critical">{overBillsCount} over budget</Badge>}
          </button>
          {!locked && (
            billsReordering ? (
              <button
                onClick={finishBillsReorder}
                disabled={billsReorderSaving}
                className="text-xs font-semibold bg-accent text-white rounded-full px-3.5 py-1.5 disabled:opacity-40 active:scale-[0.98] transition-transform"
              >
                {billsReorderSaving ? 'Saving…' : 'Done'}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={() => setShowAddItem(true)}
                  className="flex items-center gap-1 text-sm font-semibold text-ink">
                  <Plus size={16} />Add
                </button>
                <OverflowMenu items={[
                  { label: 'Categories', icon: <Tag size={15} />, onClick: () => setShowCatManager(true) },
                  ...(bills.length > 1 ? [{ label: 'Reorder', icon: <ArrowUpDown size={15} />, onClick: startBillsReorder }] : []),
                ]} />
              </div>
            )
          )}
        </div>

        {billsReordering && (
          <p className="text-xs text-ink-3 -mt-2 mb-3 px-1">
            Sets display order — categories regroup automatically once you're done.
          </p>
        )}
        {billsReorderError && (
          <p className="text-xs text-critical -mt-2 mb-3 px-1">{billsReorderError}</p>
        )}

        {billsReordering ? (
          <Card className="overflow-hidden divide-y divide-line">
            {billsReorderList.map((b, index) => {
              const slots = billsCategorySlots(billsReorderList, b.category_id)
              const pos = slots.indexOf(index)
              return (
                <ReorderRow key={b.id} name={b.name} amountCents={b.amount_cents}
                  first={pos === 0} last={pos === slots.length - 1}
                  onUp={() => moveBillsReorder(index, -1)} onDown={() => moveBillsReorder(index, 1)} />
              )
            })}
          </Card>
        ) : billsOpen && (
          <>
            {bills.length === 0 ? (
              <EmptyState title="No bills yet — add one above" />
            ) : (
              <div className="space-y-3">
                {categories.map((cat) => {
                  const group = grouped[cat.id]
                  if (!group?.length) return null
                  return <BillGroup key={cat.id} label={cat.name} bills={group} txnsByItemId={txnsByItemId}
                    onEdit={locked ? undefined : setEditItem}
                    onLogTx={locked ? undefined : (id) => setLogTx({ lineItemId: id })} onDeleteTx={locked ? undefined : handleDeleteTx} />
                })}
                {uncategorized.length > 0 && (
                  <BillGroup label="Uncategorized" bills={uncategorized} txnsByItemId={txnsByItemId}
                    onEdit={locked ? undefined : setEditItem}
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

      {/* Funds — collapsible. Order here comes from /funds/ — reuses the same
          reorder endpoint FundsPage uses (this section lists Funds, not line
          items, so there's only one order to manage). */}
      {funds.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <button onClick={() => setFundsOpen((v) => !v)} disabled={fundsReordering}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3 disabled:opacity-60">
              {fundsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}Funds
              {overFundsCount > 0 && <Badge tone="critical">{overFundsCount} over budget</Badge>}
            </button>
            {!locked && (
              fundsReordering ? (
                <button
                  onClick={finishFundsReorder}
                  disabled={fundsReorderSaving}
                  className="text-xs font-semibold bg-accent text-white rounded-full px-3.5 py-1.5 disabled:opacity-40 active:scale-[0.98] transition-transform"
                >
                  {fundsReorderSaving ? 'Saving…' : 'Done'}
                </button>
              ) : funds.length > 1 && (
                <OverflowMenu items={[
                  { label: 'Reorder', icon: <ArrowUpDown size={15} />, onClick: startFundsReorder },
                ]} />
              )
            )}
          </div>

          {fundsReordering && (
            <p className="text-xs text-ink-3 -mt-2 mb-3 px-1">
              Top funds get filled first when Savings runs short.
            </p>
          )}
          {fundsReorderError && (
            <p className="text-xs text-critical -mt-2 mb-3 px-1">{fundsReorderError}</p>
          )}

          {fundsReordering ? (
            <Card className="overflow-hidden divide-y divide-line">
              {fundsReorderList.map((f, index) => (
                <ReorderRow key={f.id} name={f.name} amountCents={f.monthly_contribution_cents}
                  first={index === 0} last={index === fundsReorderList.length - 1}
                  onUp={() => moveFundsReorder(index, -1)} onDown={() => moveFundsReorder(index, 1)} />
              ))}
            </Card>
          ) : fundsOpen && (
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
                  // account you own), never danger — so they always wear the neutral
                  // TRANSFER_OUT stone rather than the warn/critical fundStatusColor
                  // zones a discretionary Fund would at the same percentage.
                  const isTransferOut = fund.destination_type === 'transfer_out'
                  // Bar fill reads as the fund's own identity color (matching its
                  // dot everywhere else) rather than the semantic FUNDS_HUE blue —
                  // that blue is reserved for aggregates (Funds ring, allocation
                  // bar, Overview charts). Overspend still escalates to CRITICAL —
                  // honesty over identity.
                  const fundPct = fund.monthly_contribution_cents > 0 ? (spent / fund.monthly_contribution_cents) * 100 : 0
                  return <ItemRow key={fund.id} name={fund.name}
                    subtitle={subtitle} negative={isNegative} recoveryNote={recoveryNote}
                    budgetCents={fund.monthly_contribution_cents} spentCents={spent} txns={fundTxns}
                    color={isTransferOut ? TRANSFER_OUT : (fundPct > 100 ? CRITICAL : entityColor(fund))}
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
      {logTx && (
        <LogTransactionModal
          bills={bills} funds={funds} incomeSources={incomeSources}
          defaultLineItemId={logTx.lineItemId} defaultFundId={logTx.fundId} defaultSourceId={logTx.sourceId}
          defaultDate={logTxDefaultDate}
          onClose={() => setLogTx(null)} onSave={handleLogTx} onSaveSplit={handleLogSplitTx} onLogPaycheck={handleLogPaycheck}
          onLogMiscIncome={handleLogMiscIncome}
        />
      )}
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
      {editItem && <LineItemModal item={editItem} categories={categories} onClose={() => setEditItem(null)} onSave={(d) => handleUpdateItem(editItem.id, d)} onDelete={handleDeleteItem} />}
      {showCatManager && (
        <ManageCategoriesModal
          categories={categories}
          onClose={() => setShowCatManager(false)}
          onCreate={handleCreateCat}
          onRename={handleUpdateCat}
          onDelete={handleDeleteCat}
          reordering={catReordering}
          reorderList={catReorderList}
          reorderError={catReorderError}
          reorderSaving={catReorderSaving}
          populatedCatIds={populatedCatIds}
          onStartReorder={startCatReorder}
          onMoveReorder={moveCatReorder}
          onFinishReorder={finishCatReorder}
        />
      )}
      {editFundContrib && <FundContributionModal fund={editFundContrib} onClose={() => setEditFundContrib(null)} onSave={(d) => handleUpdateFundContrib(editFundContrib.id, d)} />}
    </div>
  )
}
