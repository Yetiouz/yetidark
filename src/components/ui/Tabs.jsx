// Shared horizontal tab row (design-handoff-spec Section 2.6): the active
// tab gets primary-colored text plus a 2px bottom border, inactive tabs
// stay dim with no border. This is the first piece of the spec's "Shared
// Components" library (Section 2) actually built as a reusable component
// rather than hand-rolled per screen -- meant to be reused anywhere a
// screen splits into switchable sections without navigating away
// (character sheet, journal, rules library, and so on).
export default function Tabs({ tabs, activeKey, onChange }) {
  return (
    <div role="tablist" className="flex items-center gap-5 border-b border-line mb-4">
      {tabs.map((tab) => {
        const active = tab.key === activeKey
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={`text-xs font-medium pb-2.5 -mb-px border-b-2 transition-colors ${
              active
                ? 'text-primary-text border-primary'
                : 'text-ink-dim border-transparent hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
