import { useState } from 'react'
import { fmt, toCents } from '../api'
import Modal from './Modal'
import { PrimaryButton } from './ui'

function c(cents) {
  return fmt(cents / 100)
}

const inputClass =
  'w-full border border-line rounded-2xl px-3.5 py-2.5 text-ink outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-shadow bg-white'
const labelClass = 'block text-sm font-medium text-ink-2 mb-1.5'

// Shared by FundsPage (generic transfer between any two buckets) and
// FundDetailPage (a specific fund preselected as one side, direction
// switchable). `initialFrom`/`initialTo` let a caller preselect a bucket
// without hard-coding which side it lands on.
export default function TransferModal({ state, onClose, onTransfer, initialFrom, initialTo }) {
  const buckets = [
    { id: 'savings', label: 'Savings', balance_cents: state.savings.balance_cents },
    { id: 'mr', label: 'Monthly Reserve', balance_cents: state.monthly_reserve.balance_cents },
    ...state.funds.map((f) => ({ id: `fund:${f.id}`, label: f.name, balance_cents: f.balance_cents })),
  ]

  const [from, setFrom] = useState(initialFrom ?? buckets[0].id)
  const [to, setTo] = useState(initialTo ?? (buckets[1]?.id ?? buckets[0].id))
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const fromBucket = buckets.find((b) => b.id === from)
  const toBuckets = buckets.filter((b) => b.id !== from)

  const amountCents = toCents(amount)
  const amountInvalid = !amount || amountCents <= 0
  const insufficient = !amountInvalid && fromBucket && amountCents > fromBucket.balance_cents
  const validationMessage = insufficient
    ? `Only ${c(fromBucket.balance_cents)} available in ${fromBucket.label}`
    : ''

  function handleFromChange(val) {
    setFrom(val)
    if (to === val) setTo(buckets.find((b) => b.id !== val)?.id ?? '')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (amountInvalid) return setError('Enter an amount greater than $0')
    if (insufficient) return setError(validationMessage)
    setSaving(true)
    setError('')
    try {
      await onTransfer({ from_bucket: from, to_bucket: to, amount_cents: amountCents })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const selectClass = `${inputClass} appearance-none`

  return (
    <Modal title="Transfer" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelClass}>From</label>
          <select value={from} onChange={(e) => handleFromChange(e.target.value)} className={selectClass}>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} — {c(b.balance_cents)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>To</label>
          <select value={to} onChange={(e) => setTo(e.target.value)} className={selectClass}>
            {toBuckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} — {c(b.balance_cents)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Amount</label>
          <p className="text-xs text-ink-3 mb-1.5">
            Available: {fromBucket ? c(fromBucket.balance_cents) : '—'}
          </p>
          <input
            autoFocus
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
          {validationMessage && <p className="text-xs text-critical mt-1.5">{validationMessage}</p>}
        </div>
        {error && <p className="text-sm text-critical">{error}</p>}
        <PrimaryButton type="submit" disabled={saving || amountInvalid || insufficient} className="w-full">
          {saving ? 'Transferring…' : 'Transfer'}
        </PrimaryButton>
      </form>
    </Modal>
  )
}
