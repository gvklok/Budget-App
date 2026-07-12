import { useEffect } from 'react'

// Re-runs a page's load() whenever the tab/window regains focus or the
// document becomes visible again — e.g. unlocking a phone that was pointed
// at this page, or tabbing back after the other phone changed something.
// Two phones editing the same data must never sit on stale numbers after a
// screen unlock. `load` should already be a stable (useCallback'd) reference;
// this hook just re-invokes it, same as the existing 'dev-refresh' listeners.
export function useRefetchOnFocus(load) {
  useEffect(() => {
    function onFocus() { load() }
    function onVisibility() {
      if (document.visibilityState === 'visible') load()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])
}
