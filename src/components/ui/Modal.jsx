import { useEffect } from 'react'
import { X } from 'lucide-react'

// Lightweight on-demand overlay -- Section 2's shared components didn't
// include one because nothing needed it yet. First real use: pulling the
// dice roller / Attack / Stabilize cards on GameTable.jsx out of the
// permanently-stacked layout (see that file's comment for why) so they
// only take up screen space while actually in use, matching how the
// mockup treats dice rolling as a small on-demand action rather than a
// full-height card that's always there.
//
// Deliberately minimal: centered panel, backdrop click or Escape closes
// it, no focus trap or animation -- add those if a second real use case
// needs them rather than guessing requirements up front.
export default function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-panel border border-line-soft rounded-xl p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-white">{title}</p>
          <button
            onClick={onClose}
            className="text-ink-dim hover:text-white p-1 rounded hover:bg-panel2"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
