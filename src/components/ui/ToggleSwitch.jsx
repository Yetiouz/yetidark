// Shared toggle switch (design-handoff-spec Section 2.9): 36x20px pill
// track, white 16px knob, blue fill when on. For plain settings toggles
// only -- per the spec, status uses Badge/a dot instead, never this.
//
// A real <button role="switch"> rather than a styled checkbox input: per
// the HTML5 spec `button` is a labelable element, so wrapping this in a
// <label> (as CampaignSettings.jsx's Modes of play list already does)
// still forwards label clicks to it, same as the native checkbox it
// replaces -- no behavior change for existing click-the-label-text usage.
export default function ToggleSwitch({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      className={`w-9 h-5 rounded-full shrink-0 relative transition-colors ${
        checked ? 'bg-primary' : 'bg-panel2'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  )
}
