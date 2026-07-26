import { MapPin, ImageOff } from 'lucide-react'

// Replaces the old hex-tile map: the GM uploads one real map image, and a
// simple row/col grid sits on top of it as a click layer. A cell is either
// 'fog' (an opaque tile hides the artwork underneath) or 'explored' (the
// tile is transparent, so the real map shows through). Once explored a cell
// stays that way for the rest of the campaign -- the GM's "re-fog" control
// is the manual override for a story reason like amnesia.
//
// mode='reveal': only fogged cells are clickable, and clicking reveals them.
// mode='move': every cell is clickable, used by the GM to drop the party
// marker without changing any fog.
export default function MapGrid({
  mapUrl,
  cols = 10,
  rows = 6,
  cellState = {},
  partyRow,
  partyCol,
  onCellClick,
  mode = 'reveal',
}) {
  if (!mapUrl) {
    return (
      <div
        className="w-full rounded-lg border border-dashed border-neutral-700 bg-neutral-950 flex flex-col items-center justify-center gap-1.5 text-neutral-500"
        style={{ aspectRatio: `${cols} / ${rows}` }}
      >
        <ImageOff size={22} />
        <p className="text-xs">No map uploaded yet</p>
      </div>
    )
  }

  const cells = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push({ r, c })
  }

  return (
    <div
      className="relative w-full rounded-lg overflow-hidden border border-neutral-800 select-none"
      style={{ aspectRatio: `${cols} / ${rows}` }}
    >
      <img src={mapUrl} alt="Campaign map" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
      <div
        className="absolute inset-0 grid"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
      >
        {cells.map(({ r, c }) => {
          const state = cellState[`${r},${c}`] || 'fog'
          const isFog = state === 'fog'
          const isParty = r === partyRow && c === partyCol
          const clickable = mode === 'move' ? true : isFog
          return (
            <button
              key={`${r}-${c}`}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onCellClick && onCellClick(r, c, state)}
              className={[
                'relative border border-black/10',
                isFog ? 'bg-neutral-950/90' : 'bg-transparent',
                clickable ? 'cursor-pointer hover:brightness-125' : 'cursor-default',
              ].join(' ')}
              style={
                isFog
                  ? {
                      backgroundImage:
                        'repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 6px, transparent 6px, transparent 12px)',
                    }
                  : undefined
              }
              aria-label={isFog ? 'Unexplored area' : `Explored area${isParty ? ', party is here' : ''}`}
            >
              {isParty && !isFog && (
                <MapPin size={16} className="text-amber-300 absolute inset-0 m-auto drop-shadow" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
