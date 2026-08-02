// Shared row item (design-handoff-spec Section 2.5) -- "the single
// most-reused pattern in the whole system": a bordered row with a small
// icon-wrap chip on the left, a label, and optional right-aligned content
// (a value, badge, or status dot). Used for quick-action lists, scene
// controls, party lists, inventory items, checklists.
//
// Renders as a <button> when onClick is passed, a plain <div> otherwise --
// covers both the clickable-action and inert-data-row uses the spec calls
// out. `selected` swaps the border to the primary semantic tint per 2.5's
// selected-state rule ("swap the border to the relevant semantic -line
// token + a matching -bg tint on the whole row").
export default function Row({ icon: Icon, label, right, selected = false, disabled = false, onClick, title, className = '' }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      title={title}
      className={`w-full flex items-center gap-2 rounded-lg border px-2 py-2 text-left transition-colors ${
        selected
          ? 'border-primary bg-primary-bg'
          : disabled
          ? 'border-line-soft cursor-not-allowed'
          : onClick
          ? 'border-line hover:bg-panel2'
          : 'border-line'
      } ${className}`}
    >
      {Icon && (
        <span className={`w-[26px] h-[26px] rounded-md flex items-center justify-center shrink-0 ${disabled ? 'bg-panel2/60' : 'bg-panel2'}`}>
          <Icon size={13} className={disabled ? 'text-ink-faint' : 'text-ink-dim'} />
        </span>
      )}
      <span className={`flex-1 min-w-0 text-xs truncate ${disabled ? 'text-ink-faint' : 'text-ink'}`}>{label}</span>
      {right && <span className="shrink-0">{right}</span>}
    </Comp>
  )
}
