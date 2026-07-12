import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* `scrim` is a fixed dark veil independent of `ink` (which inverts to
          off-white in dark mode) — the backdrop must stay dark in both modes. */}
      <div className="absolute inset-0 bg-scrim backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-md bg-card border border-line rounded-t-[28px] sm:rounded-[28px] shadow-pop z-10 max-h-[90vh] flex flex-col rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 sm:hidden">
          <div className="w-9 h-1 rounded-full bg-line-strong" />
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-paper text-ink-2 hover:bg-line transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 pb-5">{children}</div>
      </div>
    </div>
  )
}
