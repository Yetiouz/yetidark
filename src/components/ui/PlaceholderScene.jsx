// Shared placeholder for wherever real map/scene/portrait art would
// eventually go (design-handoff-spec Section 2.11): a repeating diagonal-
// stripe dark pattern with a centered caption explaining what's missing.
//
// Per the spec, this is intentional, not a stand-in for missing design
// work -- the real map/art pipeline was explicitly deferred elsewhere in
// this project and should stay a styled placeholder in the first
// implementation pass too. Renders as an absolute inset-0 fill, meant to
// sit inside an already-positioned, already-bordered/rounded container
// (see ZoneScene.jsx) rather than carrying its own border/radius.
export default function PlaceholderScene({ caption, className = '' }) {
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center ${className}`}
      style={{ backgroundImage: 'repeating-linear-gradient(135deg, #111 0 14px, #0d0d0d 14px 28px)' }}
    >
      <p className="text-xs text-ink-faint text-center px-4">{caption}</p>
    </div>
  )
}
