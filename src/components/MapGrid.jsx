import { useState, useRef } from 'react'
import { MapPin, ImageOff, Plus, Minus, RotateCcw } from 'lucide-react'

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
// mode='reveal': only fogged cells are clickable, and clicking reveals them
// (GM only -- see GameTable.jsx). mode='move': every cell is clickable,
// used by the GM to drop the party marker without changing any fog.
// mode='view': nothing is clickable -- this is what players see.
const HEX_CLIP_PATH = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)'
const HEX_ASPECT = 0.866 // height:width ratio of a regular flat-top hexagon (sqrt(3)/2)
const OVERLAP = 1.03 // slightly oversize every hex so shared edges never leave a seam

const MIN_ZOOM = 1
const MAX_ZOOM = 3
const DRAG_CLICK_THRESHOLD = 6 // px of pointer movement before a drag counts as a pan, not a click

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

  // Zoom/pan so a GM can lean into a busy battle map without the hex grid
  // going illegible. Only active once zoom > 1 -- at the default 1x the
  // grid behaves exactly as before (no drag capture, no transform).
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null) // { startX, startY, panX, panY, moved }

  const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

  const zoomIn = () => setZoom((z) => clampZoom(z + 0.5))
  const zoomOut = () =>
    setZoom((z) => {
      const next = clampZoom(z - 0.5)
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 })
      return next
    })
  const resetView = () => {
    setZoom(MIN_ZOOM)
    setPan({ x: 0, y: 0 })
  }

  const onWheel = (e) => {
    if (Math.abs(e.deltaY) < 1) return
    e.preventDefault()
    setZoom((z) => {
      const next = clampZoom(z - e.deltaY * 0.0015)
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 })
      return next
    })
  }

  const onPointerDown = (e) => {
    if (zoom <= MIN_ZOOM) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, moved: false }
  }
  const onPointerMove = (e) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    if (!dragRef.current.moved && Math.hypot(dx, dy) > DRAG_CLICK_THRESHOLD) dragRef.current.moved = true
    if (dragRef.current.moved) setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy })
  }
  const onPointerUp = () => {
    dragRef.current = null
  }
  // A hex's onClick fires right after pointerup at the same coordinates --
  // if the pointerup capped off a real drag (not just a settled click),
  // this swallows that one click so panning never also moves the party
  // marker or reveals a cell you only meant to scroll past.
  const wasDragRef = useRef(false)
  const onPointerUpCapture = () => {
    wasDragRef.current = dragRef.current?.moved || false
  }
  const guardedCellClick = (fn) => (...args) => {
    if (wasDragRef.current) {
      wasDragRef.current = false
      return
    }
    fn(...args)
  }

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
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerUpCapture={onPointerUpCapture}
      onPointerLeave={onPointerUp}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          cursor: zoom > MIN_ZOOM ? (dragRef.current?.moved ? 'grabbing' : 'grab') : 'default',
          transition: dragRef.current ? 'none' : 'transform 0.12s ease-out',
        }}
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
            const clickable = mode === 'move' ? true : mode === 'reveal' ? isFog : false
            const left = c * 0.75 * hexWpct - (drawW - hexWpct) / 2
            const top = r * hexHpct + (c % 2 === 1 ? hexHpct / 2 : 0) - (drawH - hexHpct) / 2
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                disabled={!clickable}
                onClick={guardedCellClick(() => clickable && onCellClick && onCellClick(r, c, state))}
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

      <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-neutral-900/85 backdrop-blur rounded-md border border-neutral-700 p-1 z-10">
        <button
          type="button"
          onClick={zoomOut}
          disabled={zoom <= MIN_ZOOM}
          className="p-1 rounded text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent"
          aria-label="Zoom out"
        >
          <Minus size={13} />
        </button>
        <span className="text-[10px] text-neutral-400 w-9 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={zoomIn}
          disabled={zoom >= MAX_ZOOM}
          className="p-1 rounded text-neutral-300 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent"
          aria-label="Zoom in"
        >
          <Plus size={13} />
        </button>
        {zoom > MIN_ZOOM && (
          <button
            type="button"
            onClick={resetView}
            className="p-1 rounded text-neutral-300 hover:bg-neutral-800 ml-0.5 border-l border-neutral-700 pl-1.5"
            aria-label="Reset zoom"
            title="Reset zoom"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
