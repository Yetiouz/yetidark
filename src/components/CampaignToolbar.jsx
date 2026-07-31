import { Settings, ScrollText, BookOpen, Users } from 'lucide-react'

// The four icon buttons (Campaign log / Rules library / NPCs, factions &
// treasure / Campaign settings) shared by the player table and GM
// dashboard headers. Each screen appends its own trailing control -- a
// "GM view" link on the player table, or "Switch to player view" plus the
// GM-view badge on the dashboard -- via `after`, since those aren't the
// same control on both screens.
export default function CampaignToolbar({ onOpenLog, onOpenLibrary, onOpenTracker, onOpenSettings, after }) {
  return (
    <div className="flex items-center gap-1.5">
      {onOpenLog && (
        <button
          onClick={onOpenLog}
          title="Campaign log"
          className="text-xs border border-neutral-700 rounded-md p-1.5 text-neutral-300 hover:bg-neutral-800"
        >
          <ScrollText size={14} />
        </button>
      )}
      {onOpenLibrary && (
        <button
          onClick={onOpenLibrary}
          title="Rules library"
          className="text-xs border border-neutral-700 rounded-md p-1.5 text-neutral-300 hover:bg-neutral-800"
        >
          <BookOpen size={14} />
        </button>
      )}
      {onOpenTracker && (
        <button
          onClick={onOpenTracker}
          title="NPCs, factions & treasure"
          className="text-xs border border-neutral-700 rounded-md p-1.5 text-neutral-300 hover:bg-neutral-800"
        >
          <Users size={14} />
        </button>
      )}
      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          title="Campaign settings"
          className="text-xs border border-neutral-700 rounded-md p-1.5 text-neutral-300 hover:bg-neutral-800"
        >
          <Settings size={14} />
        </button>
      )}
      {after}
    </div>
  )
}
