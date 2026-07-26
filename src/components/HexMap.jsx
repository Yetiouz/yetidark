import { MapPin } from 'lucide-react'

const terrainStyles = {
  forest: 'bg-green-800/50 border-green-700',
  water: 'bg-blue-800/50 border-blue-700',
  rock: 'bg-stone-700/50 border-stone-600',
  plain: 'bg-amber-800/40 border-amber-700',
  fog: '',
}

// A hex is { terrain, state } where state is 'fog' | 'explored' | 'party'.
// Clicking a fogged hex reveals it permanently for the rest of the campaign
// (per the honor-system fog-of-war design) unless a GM later re-fogs it for
// a story reason like amnesia.
export default function HexMap({ grid, onRevealHex, allowManualReveal }) {
  return (
    <div className="flex flex-col items-start">
      {grid.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="flex"
          style={{
            marginTop: rowIndex === 0 ? 0 : -12,
            marginLeft: rowIndex % 2 === 1 ? 28 : 0,
          }}
        >
          {row.map((cell, colIndex) => {
            const isFog = cell.state === 'fog'
            const isParty = cell.state === 'party'
            const clickable = isFog && allowManualReveal
            return (
              <button
                key={colIndex}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onRevealHex(rowIndex, colIndex)}
                className={[
                  'relative flex items-center justify-center border',
                  'w-14 h-12 mr-0.5',
                  isFog ? 'bg-neutral-800 border-neutral-700' : terrainStyles[cell.terrain],
                  isParty ? 'ring-2 ring-blue-400 ring-inset' : '',
                  clickable ? 'cursor-pointer hover:brightness-125' : 'cursor-default',
                ].join(' ')}
                style={{
                  clipPath:
                    'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
                  backgroundImage: isFog
                    ? 'repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 6px, transparent 6px, transparent 12px)'
                    : undefined,
                }}
                aria-label={
                  isFog ? 'Unexplored hex' : `${cell.terrain} hex${isParty ? ', party is here' : ''}`
                }
              >
                {isParty && <MapPin size={16} className="text-amber-200" />}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
