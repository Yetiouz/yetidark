// Shared pill badge (design-handoff-spec Section 2.3): 11px text, pill
// radius, a `tone` prop mapped 1:1 to the Section 1.1 semantic colors and
// nothing else -- resist adding more tones here, that's the whole point
// of the constraint (one color, one job, everywhere it's used).
const TONE_CLASSES = {
  neutral: 'bg-panel2 text-ink-dim',
  blue: 'bg-primary-bg text-primary-text',
  green: 'bg-positive-bg text-positive-text',
  amber: 'bg-warning-bg text-warning-text',
  red: 'bg-danger-bg text-danger-text',
  purple: 'bg-ai-bg text-ai-text',
}

export default function Badge({ tone = 'neutral', children }) {
  return (
    <span
      className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
        TONE_CLASSES[tone] || TONE_CLASSES.neutral
      }`}
    >
      {children}
    </span>
  )
}
