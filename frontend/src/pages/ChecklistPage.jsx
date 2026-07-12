import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, Plus, Pencil, Trash2, X, RotateCcw } from 'lucide-react'
import { apiGet, apiPost, apiPatch, apiDel } from '../api'
import { Card, SectionLabel, EmptyState, PrimaryButton, IconButton, Bar } from '../components/ui'
import { ACCENT, LINE_STRONG } from '../theme'
import { useRefetchOnFocus } from '../hooks'

// ── ChecklistRow ──────────────────────────────────────────────────────────────
// Tap anywhere on the row to toggle. Edit/delete IconButtons stop propagation
// so they never trigger the toggle underneath them.

function ChecklistRow({ item, onToggle, onRename, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(item.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { setValue(item.name) }, [item.name])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function commitRename() {
    setEditing(false)
    const trimmed = value.trim()
    if (!trimmed || trimmed === item.name) { setValue(item.name); return }
    onRename(item.id, trimmed)
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3.5 cursor-pointer active:bg-paper transition-colors"
        onClick={() => !editing && onToggle(item)}
      >
        <span
          className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors"
          style={item.is_checked ? { background: ACCENT, borderColor: ACCENT } : { borderColor: LINE_STRONG }}
        >
          {item.is_checked && <Check size={13} className="text-white" strokeWidth={3} />}
        </span>

        {editing ? (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              if (e.key === 'Escape') { setValue(item.name); setEditing(false) }
            }}
            className="flex-1 min-w-0 border-b border-line outline-none text-ink text-sm py-0.5 bg-transparent"
          />
        ) : (
          <p className={`flex-1 min-w-0 truncate text-sm ${item.is_checked ? 'text-ink-3 line-through' : 'text-ink font-medium'}`}>
            {item.name}
          </p>
        )}

        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {confirmDelete ? (
            <>
              <button
                onClick={() => onDelete(item.id)}
                className="text-xs font-semibold text-critical px-2.5 py-1 rounded-full hover:bg-critical-soft transition-colors"
              >
                Delete?
              </button>
              <IconButton onClick={() => setConfirmDelete(false)}><X size={14} /></IconButton>
            </>
          ) : (
            <>
              <IconButton onClick={() => setEditing(true)}><Pencil size={14} /></IconButton>
              <IconButton onClick={() => setConfirmDelete(true)} className="hover:bg-critical-soft hover:text-critical">
                <Trash2 size={14} />
              </IconButton>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

// ── AddItemRow ────────────────────────────────────────────────────────────────

function AddItemRow({ onAdd }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Enter an item name'); return }
    setSaving(true)
    setError('')
    try {
      await onAdd(trimmed)
      setName('')
    } catch (err) {
      setError(err.message || 'Failed to add item')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-0 overflow-hidden">
      <form onSubmit={submit} className="flex items-center gap-3 px-4 py-3">
        <Plus size={16} className="text-ink-3 shrink-0" />
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); if (error) setError('') }}
          placeholder="Add an item…"
          className="flex-1 min-w-0 outline-none text-sm text-ink bg-transparent placeholder:text-ink-3"
        />
        <button
          type="submit"
          disabled={saving}
          className="text-xs font-semibold text-accent-ink disabled:opacity-40 shrink-0"
        >
          {saving ? 'Adding…' : 'Add'}
        </button>
      </form>
      {error && <p className="text-xs text-critical px-4 pb-2.5 -mt-1">{error}</p>}
    </Card>
  )
}

// ── ChecklistPage ─────────────────────────────────────────────────────────────

export default function ChecklistPage() {
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const data = await apiGet('/checklist/')
      setItems(data)
    } catch (err) {
      setLoadError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useRefetchOnFocus(load)

  useEffect(() => {
    window.addEventListener('dev-refresh', load)
    return () => window.removeEventListener('dev-refresh', load)
  }, [load])

  async function handleToggle(item) {
    setActionError('')
    const next = !item.is_checked
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_checked: next } : i)))
    try {
      await apiPatch(`/checklist/${item.id}`, { is_checked: next })
    } catch (err) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_checked: item.is_checked } : i)))
      setActionError(err.message || 'Failed to update item')
    }
  }

  async function handleRename(id, name) {
    setActionError('')
    const prev = items
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, name } : i)))
    try {
      await apiPatch(`/checklist/${id}`, { name })
    } catch (err) {
      setItems(prev)
      setActionError(err.message || 'Failed to rename item')
    }
  }

  async function handleDelete(id) {
    setActionError('')
    const prev = items
    setItems((cur) => cur.filter((i) => i.id !== id))
    try {
      await apiDel(`/checklist/${id}`)
    } catch (err) {
      setItems(prev)
      setActionError(err.message || 'Failed to delete item')
    }
  }

  async function handleAdd(name) {
    setActionError('')
    const created = await apiPost('/checklist/', { name })
    setItems((cur) => [...(cur ?? []), created])
  }

  async function handleReset() {
    setResetting(true)
    setActionError('')
    try {
      await apiPost('/checklist/reset')
      setConfirmReset(false)
      await load()
    } catch (err) {
      setActionError(err.message || 'Failed to reset checklist')
      setResetting(false)
    }
  }

  if (loadError && items === null) {
    return (
      <div className="flex items-center justify-center h-64 px-4">
        <Card className="p-6 text-center max-w-sm">
          <p className="text-sm text-critical mb-4">{loadError}</p>
          <PrimaryButton onClick={load}>Retry</PrimaryButton>
        </Card>
      </div>
    )
  }

  if (loading && items === null) {
    return <div className="flex items-center justify-center h-64 text-ink-3">Loading…</div>
  }

  const doneCount = items.filter((i) => i.is_checked).length
  const total = items.length
  const pct = total > 0 ? (doneCount / total) * 100 : 0

  const sorted = [...items].sort((a, b) => {
    if (a.is_checked !== b.is_checked) return a.is_checked ? 1 : -1
    return a.id - b.id
  })

  return (
    <div className="px-4 pt-6 pb-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-3xl font-bold text-ink tracking-tight">Checklist</h1>
        {total > 0 && (
          confirmReset ? (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleReset}
                disabled={resetting}
                className="text-xs font-semibold text-ink-2 border border-line bg-card rounded-full px-3 py-1.5 disabled:opacity-40 active:scale-[0.98] transition-transform"
              >
                {resetting ? 'Resetting…' : 'Reset all?'}
              </button>
              <IconButton onClick={() => setConfirmReset(false)}><X size={14} /></IconButton>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-ink-2 border border-line bg-card rounded-full px-3.5 py-2 active:scale-[0.98] transition-transform shrink-0"
            >
              <RotateCcw size={14} />
              Reset
            </button>
          )
        )}
      </div>

      {total > 0 && (
        <div className="mb-5">
          <p className="text-sm text-ink-3 mb-2">{doneCount} of {total} done</p>
          <Bar pct={pct} color={ACCENT} />
        </div>
      )}

      {actionError && (
        <div className="mb-3 px-4 py-2.5 rounded-2xl text-xs bg-critical-soft text-critical flex items-center justify-between gap-2">
          <span>{actionError}</span>
          <button onClick={() => setActionError('')} className="shrink-0"><X size={13} /></button>
        </div>
      )}

      {total === 0 ? (
        <>
          <EmptyState title="Monthly rituals live here — rent check, meter reading, transfer day…" />
          <div className="mt-3">
            <AddItemRow onAdd={handleAdd} />
          </div>
        </>
      ) : (
        <div className="space-y-2.5">
          {sorted.map((item) => (
            <ChecklistRow
              key={item.id}
              item={item}
              onToggle={handleToggle}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          ))}
          <AddItemRow onAdd={handleAdd} />
        </div>
      )}
    </div>
  )
}
