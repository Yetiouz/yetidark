import { useState } from 'react'
import { MapPin, ImageOff } from 'lucide-react'

// A hex fog-of-war overlay on top of one uploaded map image. Hexes are
// flat-top (flat edges top/bottom, points left/right) in "offset column"
// layout -- the layout that actually tessellates cleanly for this shape:
// each column of hexes sits directly below the last, and alternating
// columns are shifted down by half a hex to interlock with their neighbors.
//
// The container is sized to the image's own natural aspect ratio (read via
// the <img>'s onLoad), not a fixed cols/rows ratio, so the full map is
// always visible -- nothing gets cropped regardless of what shape image
// the GM uploads.
//
// A cell is either 'fog' (fully opaque -- the map underneath is completely
// hidden, no bleed-through) or 'explored' (fully transparent, so the real
// map shows through). Once explored a cell stays that way for the rest of
// the campaign -- the GM's "re-fog" control is the manual override for a
// story reason like amnesia.
//
// mode='reveal': only fogged cells are clickable, and clicking reveals them.
// mode='move': every cell is clickable, used by the GM to drop the party
// marker without changing any fog.
const HEX_CLIP_PATH = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)'
const HEX_ASPECT = 0.866 // height:width ratio of a regular flat-top hexagon (sqrt(3)/2)
const OVERLAP = 1.03 // slightly oversize every hex so shared edges never leave a seam

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
  const [imgAspect, setImgAspect] = useState(16 / 10)

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

  // Solve for hex width/height (as % of the container) that fit `cols`
  // columns and `rows` rows of regular hexagons without ever overflowing
  // either dimension -- whichever axis is tighter wins, same idea as
  // object-fit: contain, so the grid never spills past the image.
  const widthUnits = 0.75 * cols + 0.25
  const heightUnits = rows + 0.5
  let hexWpct = 100 / widthUnits
  let hexHpct = hexWpct * HEX_ASPECT * imgAspect
  if (heightUnits * hexHpct > 100) {
    hexHpct = 100 / heightUnits
    hexWpct = hexHpct / (HEX_ASPECT * imgAspect)
  }
  const drawW = hexWpct * OVERLAP
  const drawH = hexHpct * OVERLAP

  const cells = []
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) cells.push({ r, c })
  }

  return (
    <div
      className="relative w-full rounded-lg overflow-hidden border border-neutral-800 select-none bg-neutral-950"
      style={{ aspectRatio: imgAspect }}
    >
      <img
        src={mapUrl}
        alt="Campaign map"
        className="absolute inset-0 w-full h-full object-contain"
        draggable={false}
        onLoad={(e) => {
          const { naturalWidth, naturalHeight } = e.target
          if (naturalWidth && naturalHeight) setImgAspect(naturalWidth / naturalHeight)
        }}
      />
      <div className="absolute inset-0">
        {cells.map(({ r, c }) => {
          const state = cellState[`${r},${c}`] || 'fog'
          const isFog = state === 'fog'
          const isParty = r === partyRow && c === partyCol
          const clickable = mode === 'move' ? true : isFog
          const left = c * 0.75 * hexWpct - (drawW - hexWpct) / 2
          const top = r * hexHpct + (c % 2 === 1 ? hexHpct / 2 : 0) - (drawH - hexHpct) / 2
          return (
            <button
              key={`${r}-${c}`}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onCellClick && onCellClick(r, c, state)}
              className={[
                'absolute',
                isFog ? 'bg-neutral-950' : 'bg-transparent',
                clickable ? 'cursor-pointer hover:brightness-125' : 'cursor-default',
              ].join(' ')}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: `${drawW}%`,
                height: `${drawH}%`,
                clipPath: HEX_CLIP_PATH,
                backgroundImage: isFog
                  ? 'repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 6px, rgba(0,0,0,0) 6px, rgba(0,0,0,0) 12px)'
                  : undefined,
              }}
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
