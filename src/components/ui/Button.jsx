// Shared button (design-handoff-spec Section 2.4): three variants used
// throughout -- `outline` (neutral border/bg, the default action),
// `primary` (solid --primary, the one primary action per view), and a
// `warn`/`danger` outline variant (amber or red border+text+tinted bg)
// reserved for the handful of genuinely risky actions. Icon-only buttons
// are 32-34px squares with the same neutral border treatment as outline.
const VARIANT_CLASSES = {
  outline: 'border border-line text-ink hover:bg-panel2 disabled:opacity-50 disabled:hover:bg-transparent',
  primary: 'bg-primary hover:bg-primary/90 text-ink font-medium disabled:bg-panel2 disabled:text-ink-faint',
  warn: 'border border-warning-line bg-warning-bg text-warning-text hover:bg-warning-bg/70 disabled:opacity-50',
  danger: 'border border-danger-line bg-danger-bg text-danger-text hover:bg-danger-bg/70 disabled:opacity-50',
}

export default function Button({
  variant = 'outline',
  icon: Icon,
  iconOnly = false,
  disabled = false,
  onClick,
  type = 'button',
  title,
  // Cross-screen "disabled-primary-with-tooltip" pattern (design-handoff-spec
  // Section 5's <BlockedPrimaryButton>, seen on Campaign Lobby's Start
  // session and End Session Review's Finalize): when a blocked primary
  // action needs to explain why, pass the explanation here instead of
  // hand-rolling the group/hover/absolute-tooltip wrapper per screen.
  tooltip,
  className = '',
  children,
}) {
  const variantClasses = VARIANT_CLASSES[variant] || VARIANT_CLASSES.outline

  const button = iconOnly ? (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={tooltip ? undefined : title}
      aria-label={title}
      className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-colors ${variantClasses} ${className}`}
    >
      {Icon && <Icon size={15} />}
    </button>
  ) : (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={tooltip ? undefined : title}
      className={`text-sm rounded-md px-3.5 py-1.5 flex items-center justify-center gap-1.5 transition-colors ${variantClasses} ${className}`}
    >
      {Icon && <Icon size={14} />}
      {children}
    </button>
  )

  if (!tooltip) return button

  return (
    <div className="relative group inline-block">
      {button}
      <div className="absolute right-0 top-full mt-1.5 whitespace-nowrap text-xs bg-panel2 border border-line rounded-md px-2.5 py-1.5 text-ink-dim opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
        {tooltip}
      </div>
    </div>
  )
}
