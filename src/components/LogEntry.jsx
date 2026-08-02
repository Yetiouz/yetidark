import { Bot } from 'lucide-react'

// Shared by GameTable.jsx's Scene log panel and GmDashboard.jsx's Scene
// log panel -- same four entry types (narration/gm/ai_gm/roll/chat-default),
// same text extraction either place. The two screens differ only in
// wrapper tag: GameTable renders these inline among flex/inline-flex
// siblings so it needs <span> (with an explicit `block` class to get
// block-level behavior back per-entry); GmDashboard renders them as
// direct children of a plain scroll container so a block-level <p> works
// without that extra class. `as="p"` reproduces GmDashboard's exact
// classNames; the default (`as="span"`, i.e. omitted) reproduces
// GameTable's. `ai_gm` was GameTable-only before this extraction --
// GmDashboard's own renderLogEntry had no ai_gm branch at all, so AI GM
// narration fell through to the plain default styling there. Folding
// both screens onto this one component fixes that for GmDashboard too.
export default function LogEntry({ entry, as = 'span', color }) {
  const Tag = as
  const blockClass = as === 'span' ? 'block' : undefined
  const rollFlexClass = as === 'span' ? 'inline-flex' : 'flex'

  if (entry.type === 'narration') {
    return <Tag className={`${blockClass ? blockClass + ' ' : ''}italic text-ink-dim`}>{entry.text}</Tag>
  }

  if (entry.type === 'gm') {
    return (
      <Tag className={blockClass}>
        <span className="font-medium text-primary-text" style={color ? { color } : undefined}>{entry.sender_name}:</span>{' '}
        <span className="text-ink">{entry.text}</span>
      </Tag>
    )
  }

  if (entry.type === 'ai_gm') {
    return (
      <Tag className={`${blockClass ? blockClass + ' ' : ''}bg-ai/10 border border-ai/20 rounded-md px-3 py-2 -mx-1`}>
        <span className="font-medium text-ai-text flex items-center gap-2 mb-1">
          <Bot size={12} /> AI GM
        </span>
        <span className="text-ink whitespace-pre-wrap">{entry.text}</span>
      </Tag>
    )
  }

  if (entry.type === 'roll') {
    return (
      <Tag className={`${rollFlexClass} items-center gap-2 flex-wrap`}>
        <span className="font-medium text-white">{entry.sender_name}:</span>
        <span className="text-ink">{entry.text}</span>
        <span
          className={`text-[10px] px-2 py-1 rounded ${
            entry.roll_source === 'app'
              ? 'bg-primary/20 text-primary-text'
              : 'bg-panel2 border border-line text-ink-dim'
          }`}
        >
          {entry.roll_source === 'app' ? 'app roll' : 'self-reported'}
        </span>
      </Tag>
    )
  }

  return (
    <Tag className={blockClass}>
      <span className="font-medium text-white" style={color ? { color } : undefined}>{entry.sender_name}:</span>{' '}
      <span className="text-ink">{entry.text}</span>
    </Tag>
  )
}
