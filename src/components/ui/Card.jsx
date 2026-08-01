// Shared card (design-handoff-spec Section 2.2): 1px `line-soft` border,
// 12px radius, `panel` background, 16px padding, a bold ~14px title with
// an optional small badge next to it. Matches the `bg-panel border
// border-line-soft rounded-xl p-4` shape already used consistently across
// Campaign Lobby, Lobby, and Character Picker -- this just makes it a
// named, reusable piece instead of the same four classes retyped per card.
export default function Card({ title, titleRight, children, className = '', bodyClassName = '' }) {
  return (
    <div className={`bg-panel border border-line-soft rounded-xl p-4 ${className}`}>
      {title && (
        <div className={`flex items-center justify-between gap-2 ${children ? 'mb-3' : ''}`}>
          <p className="text-sm font-medium text-ink">{title}</p>
          {titleRight}
        </div>
      )}
      {children && <div className={bodyClassName}>{children}</div>}
    </div>
  )
}
