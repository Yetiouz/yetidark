import { Check } from 'lucide-react'

// Shared multi-step wizard header (design-handoff-spec Section 2.7): a
// horizontal row of circular step badges connected by thin lines. This is a
// verbatim extraction -- CampaignBuilder.jsx and CharacterBuilder.jsx had
// byte-identical stepper markup, differing only in their STEPS label list.
//
// `onStepClick` isn't in the spec's own prop table (the spec describes the
// stepper as display-only unless product wants completed-step jumping), but
// both existing wizards already let you click any step badge to jump
// straight to it -- that's a pre-existing behavior, not something this
// extraction should regress, so it's preserved as an optional prop.
const CIRCLE_CLASSES = {
  done: 'bg-positive-bg border-positive text-positive-text',
  active: 'bg-primary border-primary text-ink',
  upcoming: 'border-line text-ink-faint',
}

export default function Stepper({ steps, onStepClick }) {
  return (
    <div className="hidden md:flex items-center gap-2 overflow-x-auto">
      {steps.map(({ label, state }, i) => (
        <div key={label} className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onStepClick && onStepClick(i)}
            className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] border shrink-0 ${
              CIRCLE_CLASSES[state] || CIRCLE_CLASSES.upcoming
            }`}
          >
            {state === 'done' ? <Check size={12} /> : i + 1}
          </button>
          <span className={`text-xs whitespace-nowrap ${state === 'active' ? 'text-ink' : 'text-ink-faint'}`}>{label}</span>
          {i < steps.length - 1 && <span className="w-5 h-px bg-panel2 shrink-0" />}
        </div>
      ))}
    </div>
  )
}
