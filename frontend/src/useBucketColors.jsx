import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { BUCKET_VARS, DEFAULT_BUCKET_PRESET, presetByKey } from './bucketColorPresets'

const STORAGE_KEY = 'bucketColors' // { bills, funds, savings } -> preset key; unset = default

// Mirrors useTheme.js's read-stored-preference shape, one level deeper (an
// object of 3 choices instead of a single string).
function readStoredSelection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_BUCKET_PRESET }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_BUCKET_PRESET, ...parsed }
  } catch {
    return { ...DEFAULT_BUCKET_PRESET }
  }
}

function isDarkNow() {
  return document.documentElement.classList.contains('dark')
}

// Sets the actual CSS custom properties for all 3 buckets, picking each
// preset's light or dark variant based on the CURRENT `.dark` class state.
// An inline style set via `.style.setProperty` always outranks the
// `:root`/`.dark` rules in index.css regardless of which is active, so this
// must be re-run any time the resolved theme flips — see the MutationObserver
// in the hook below — or a chosen preset would freeze on whichever mode was
// active when it was first applied.
function applySelection(selection) {
  const dark = isDarkNow()
  for (const [bucket, vars] of Object.entries(BUCKET_VARS)) {
    const preset = presetByKey(selection[bucket]) || presetByKey(DEFAULT_BUCKET_PRESET[bucket])
    const values = dark ? preset.dark : preset.light
    const [baseVar, inkVar, softVar] = vars
    document.documentElement.style.setProperty(baseVar, values.base)
    document.documentElement.style.setProperty(inkVar, values.ink)
    document.documentElement.style.setProperty(softVar, values.soft)
  }
}

// Single source of truth for the 3 bucket-color choices, applied globally —
// see BucketColorProvider below. Not exported directly: multiple independent
// instances would each hold stale state and fight each other's dark/light
// re-apply, so every consumer (the global sync + the Settings picker) shares
// one instance via context.
function useBucketColorsState() {
  const [selection, setSelection] = useState(readStoredSelection)

  // Apply on mount and whenever the selection changes.
  useEffect(() => {
    applySelection(selection)
  }, [selection])

  // Re-apply whenever light/dark mode toggles (the `.dark` class on <html>
  // flips) — see applySelection's doc comment for why this is required.
  useEffect(() => {
    const observer = new MutationObserver(() => applySelection(selection))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [selection])

  const setBucketPreset = useCallback((bucket, presetKey) => {
    setSelection((prev) => {
      const next = { ...prev, [bucket]: presetKey }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const resetBucketPreset = useCallback((bucket) => {
    setBucketPreset(bucket, DEFAULT_BUCKET_PRESET[bucket])
  }, [setBucketPreset])

  return useMemo(
    () => [selection, setBucketPreset, resetBucketPreset],
    [selection, setBucketPreset, resetBucketPreset]
  )
}

const BucketColorContext = createContext(null)

// Mount once near the app root (see App.jsx) so bucket-color preferences
// apply everywhere, on every page, without needing Settings mounted.
export function BucketColorProvider({ children }) {
  const value = useBucketColorsState()
  return <BucketColorContext.Provider value={value}>{children}</BucketColorContext.Provider>
}

// Consumed by the Settings page's swatch pickers. Returns
// [selection, setBucketPreset, resetBucketPreset] — same tuple shape as
// useTheme()'s [pref, setTheme].
export function useBucketColors() {
  const ctx = useContext(BucketColorContext)
  if (!ctx) throw new Error('useBucketColors must be used within a BucketColorProvider')
  return ctx
}
