// Shared stat tile -- the small labeled metric box used in the top-of-screen
// stat row on both the player table (HP/AC/Gear/Luck/Torch) and the GM
// dashboard (Torch/Mode/Danger/Crawling Round/Next Encounter Check). Same
// visual shape in both places (`rounded-lg px-3 py-2 border`, a tiny
// tracked-out label with an optional icon, then a value area) that used to
// be hand-typed once per screen and had started to drift. `highlight` is the
// one bit of conditional styling both screens share -- the amber "lit torch"
// border/background swap -- so it's a prop instead of being reimplemented
// per call site.
export default function StatTile({ label, icon: Icon, highlight = false, title, children }) {
  return (
    <div
      className={`rounded-lg px-3 py-2 border ${highlight ? 'border-warning/60 bg-warning/5' : 'bg-panel border-line-soft'}`}
      title={title}
    >
      <p className="text-[10px] tracking-wide text-ink-dim mb-1 flex items-center gap-1">
        {Icon && <Icon size={10} />} {label}
      </p>
      {children}
    </div>
  )
}
