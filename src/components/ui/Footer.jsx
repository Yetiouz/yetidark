// Shared footer / status bar shell (design-handoff-spec Section 2.8): a
// thin bar pinned to the bottom of a screen, `border-top: 1px line-soft`.
// This wraps the exact `shrink-0 border-t border-line-soft` shell already
// repeated verbatim across the two wizard footers (Back / step counter /
// Continue) and the two message-composer bars -- the structural chrome is
// identical everywhere, only the inner content differs, so this just names
// the shell and leaves the content to children.
//
// The spec's other footer content -- a colored dot + status text
// ("saved/synced") on the left -- isn't demonstrated by any real screen
// yet (no screen has a live save-status indicator today), so it isn't
// built here. Add it if/when a screen actually needs it, same as Button's
// unused `danger` variant.
export default function Footer({ children, className = '' }) {
  return <div className={`shrink-0 border-t border-line-soft ${className}`}>{children}</div>
}
