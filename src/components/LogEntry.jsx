import { Bot } from 'lucide-react'

// Shared by GameTable.jsx's Scene log panel and GmDashboard.jsx's Scene
// log panel -- same four entry types (narration/gm/roll/chat-default),
// same text extraction either place. The two screens differ only in
// wrapper tag: GameTable renders these inline among flex/inline-flex
// siblings so it needs <span> (with an explicit `block` class to get
// block-level behavior back per-entry); GmDashboard renders them as
// direct children of a plain scroll container so a block-level <p> works
// without that extra class. `as="p"` reproduces GmDashboard's exact
// classNames; the default (`as="span"`, i.e. omitted) reproduces
// GameTable's. `ai_gm` is GameTable-only (GmDashboard never has AI-GM
// entries to render) but costs nothing to leave in here too.
export default function LogEntry({ entry, as = 'span' }) {
  const Tag = as
  const blockClass = as === 'span' ? 'block' : undefined
  const rollFlexClass = as === 'span' ? 'inline-flex' : 'flex'

  if (entry.type === 'narration') {
    return <Tag className={`${blockClass ? blockClass + ' ' : ''}italic text-neutral-400`}>{entry.text}</Tag>
  }

  if (entry.type === 'gm') {
    return (
      <Tag className={blockClass}>
        <span className="font-medium text-blue-400">{entry.sender_name}:</span>{' '}
        <span className="text-neutral-300">{entry.text}</span>
      </Tag>
    )
  }

  if (entry.type === 'ai_gm') {
    return (
      <Tag className={`${blockClass ? blockClass + ' ' : ''}bg-purple-500/10 border border-purple-500/20 rounded-md px-2.5 py-2 -mx-0.5`}>
        <span className="font-medium text-purple-300 flex items-center gap-1.5 mb-1">
          <Bot size={12} /> AI GM
        </span>
        <span className="text-neutral-200 whitespace-pre-wrap">{entry.text}</span>
      </Tag>
    )
  }

  if (entry.type === 'roll') {
    return (
      <Tag className={`${rollFlexClass} items-center gap-1.5 flex-wrap`}>
        <span className="font-medium text-white">{entry.sender_name}:</span>
        <span className="text-neutral-300">{entry.text}</span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded ${
            entry.roll_source === 'app'
              ? 'bg-blue-500/20 text-blue-300'
              : 'bg-neutral-800 border border-neutral-700 text-neutral-400'
          }`}
        >
          {entry.roll_source === 'app' ? 'app roll' : 'self-reported'}
        </span>
      </Tag>
    )
  }

  return (
    <Tag className={blockClass}>
      <span className="font-medium text-white">{entry.sender_name}:</span>{' '}
      <span className="text-neutral-300">{entry.text}</span>
    </Tag>
  )
}
