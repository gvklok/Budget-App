import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'theme' // 'light' | 'dark' | 'system' (unset = 'system')

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolve(pref) {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref
}

function applyClass(pref) {
  document.documentElement.classList.toggle('dark', resolve(pref) === 'dark')
}

// Mirrors the inline pre-paint script in index.html (which only needs to know
// dark-or-not to avoid a flash) — this hook additionally tracks the 3-way
// preference itself so Settings can render the Segmented control.
function readStoredPref() {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

// App-wide dark mode preference: 'system' (default, follows the OS/browser
// media query live) or a manual 'light'/'dark' override persisted to
// localStorage. Single source of truth for the Settings toggle; the actual
// `.dark` class swap is applied here AND pre-paint in index.html.
export function useTheme() {
  const [pref, setPref] = useState(readStoredPref)

  useEffect(() => {
    applyClass(pref)
  }, [pref])

  // Live-follow the OS preference while in 'system' mode.
  useEffect(() => {
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyClass('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const setTheme = useCallback((next) => {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, next)
    setPref(next)
  }, [])

  return [pref, setTheme]
}
