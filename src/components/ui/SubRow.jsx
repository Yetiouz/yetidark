// Shared "sub-row" (design-handoff-spec has no explicit spec for this --
// flagged by delve-consistency-audit.md as a third, undocumented pattern
// distinct from both Card and Row): a lightweight bordered list-item
// wrapper for multi-line rich content (checkboxes, buttons, several lines
// of text) that doesn't fit Row's fixed single-line icon+label+value
// shape. No default padding -- existing call sites use different values
// (p-2 vs p-3) and forcing one in here would silently resize them; pass
// padding via className.
export default function SubRow({ children, className = '' }) {
  return <div className={`bg-panel2/60 rounded-md border border-line ${className}`}>{children}</div>
}
