// Shared progress / segmented bar (design-handoff-spec Section 2.10): thin
// (5-6px), rounded, dim `panel2` track with a colored fill. Two modes --
// `continuous` (plain fill, e.g. HP/XP/a completion checklist) and
// `segmented` (discrete rounded blocks, e.g. a 4-stage threat clock).
// `tone` follows the same neutral/blue/green/amber/red/purple vocabulary
// as Badge, mapped to a solid (not alpha-tinted) fill class since this is
// a filled bar, not a pill. Pass `barClassName` instead of `tone` for
// cases with dynamic per-value coloring (e.g. an HP bar that goes
// green/amber/red by threshold) that a fixed tone can't express.
const TONE_FILL = {
  neutral: 'bg-ink-faint',
  blue: 'bg-primary',
  green: 'bg-positive',
  amber: 'bg-warning',
  red: 'bg-danger',
  purple: 'bg-ai',
}

export default function ProgressBar({
  mode = 'continuous',
  value = 0,
  max = 1,
  segments = 0,
  filled = 0,
  tone = 'blue',
  barClassName,
  // Track background, e.g. GameTable's HP bar uses a red-tinted `bg-danger/40`
  // dim track instead of the default neutral `panel2` so a nearly-empty bar
  // still reads as "danger" at a glance.
  trackBg = 'bg-panel2',
  heightClassName = 'h-1.5',
  className = '',
}) {
  const fillClass = barClassName || TONE_FILL[tone] || TONE_FILL.blue

  if (mode === 'segmented') {
    return (
      <div className={`flex gap-1 ${className}`}>
        {Array.from({ length: segments }).map((_, i) => (
          <span key={i} className={`${heightClassName} flex-1 rounded-sm ${i < filled ? fillClass : trackBg}`} />
        ))}
      </div>
    )
  }

  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className={`${heightClassName} ${trackBg} rounded-full overflow-hidden ${className}`}>
      <div className={`h-full ${fillClass} rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}
