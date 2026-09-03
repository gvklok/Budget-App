import { useEffect } from 'react'
import { X } from 'lucide-react'

// `size="md"` (default) is the standard form-dialog footprint used
// everywhere else in the app. `size="lg"` is for content that needs real
// room to breathe — charts, not forms: near-fullscreen height on mobile (this
// app is mobile-first) and a much wider, taller sheet on larger screens.
const SIZE_CLASSES = {
  md: 'sm:max-w-md max-h-[90vh]',
  lg: 'sm:max-w-3xl max-h-[95vh] sm:h-[85vh]',
}

export default function Modal({ title, onClose, children, size = 'md' }) {
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
        className={`relative w-full ${SIZE_CLASSES[size]} bg-card border border-line rounded-t-[28px] sm:rounded-[28px] shadow-pop z-10 flex flex-col rise-in`}
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
