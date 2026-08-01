import { Flame } from 'lucide-react'

// Shadowdark's own range system is three unmeasured bands -- close (melee),
// near (~30ft, where ranged weapons work normally), far (in sight, ranged
// only at a penalty or not at all) -- not a grid. This replaces the old
// hex-grid/fog rendering with an illustrated scene image plus these three
// zone rings, so positioning models the actual rule instead of imposing
// cell-by-cell precision the system never asked for. Dungeon layout
// (which room connects to which) stays a separate concern, still handled
// by the campaign's uploaded map image as a backdrop.
const ZONE_RADIUS_PCT = { close: 21, near: 41, far: 49 }

// Deterministic per-token angle so the same character always lands in the
// same spot on a given render (no layout jitter), spread evenly against
// anyone else currently sharing that zone so tokens don't stack exactly.
function angleForToken(id, indexInZone, countInZone) {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 360
  const spread = countInZone > 1 ? (360 / countInZone) * indexInZone : 0
  return ((hash + spread) * Math.PI) / 180
}

function groupByZone(tokens) {
  const groups = { close: [], near: [], far: [] }
  for (const t of tokens) {
    const zone = groups[t.zone] ? t.zone : 'near'
    groups[zone].push(t)
  }
  return groups
}

// party: [{ id, name, color, zone }], monsters: [{ id, name, zone }] --
// monsters render in neutral gray since they don't carry the per-character
// color identity players do. litCharacterId centers a soft light-radius
// glow on whichever token currently owns the lit torch, since no
// Shadowdark ancestry has darkvision and "who's lit" is gameplay-critical,
// not decorative -- it should move with the torchbearer, not sit fixed on
// the room.
export default function ZoneScene({ mapUrl, mapAccessError, sceneLabel, party = [], monsters = [], litCharacterId }) {
  const tokens = [
    ...party.map((p) => ({ id: p.id, name: p.name, color: p.color || '#3b82f6', zone: p.zone || 'near' })),
    ...monsters.map((m) => ({ id: m.id, name: m.name, color: '#737373', zone: m.zone || 'near' })),
  ]
  const grouped = groupByZone(tokens)

  const positioned = []
  for (const zone of ['close', 'near', 'far']) {
    const group = grouped[zone]
    group.forEach((t, i) => {
      const angle = angleForToken(t.id, i, group.length)
      const r = ZONE_RADIUS_PCT[zone]
      positioned.push({ ...t, x: 50 + r * Math.cos(angle), y: 50 + r * Math.sin(angle) })
    })
  }
  const litPos = litCharacterId ? positioned.find((p) => p.id === litCharacterId) : null

  return (
    <div>
      {mapAccessError && <p className="text-xs text-danger-text mb-2">{mapAccessError}</p>}
      <div className="relative w-full rounded-lg overflow-hidden bg-bg border border-line-soft" style={{ aspectRatio: '16 / 10' }}>
        {mapUrl ? (
          <img src={mapUrl} alt={sceneLabel || 'Scene'} className="absolute inset-0 w-full h-full object-cover opacity-80" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-xs text-ink-faint">No scene image yet</p>
          </div>
        )}

        {litPos && (
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              width: '90%',
              height: '90%',
              left: `${litPos.x}%`,
              top: `${litPos.y}%`,
              transform: 'translate(-50%, -50%)',
              background: 'radial-gradient(circle, rgba(245,158,11,0.16) 0%, rgba(245,158,11,0.04) 55%, transparent 75%)',
            }}
          />
        )}

        <div
          className="absolute rounded-full border border-dashed border-line pointer-events-none"
          style={{ width: `${ZONE_RADIUS_PCT.near * 2}%`, height: `${ZONE_RADIUS_PCT.near * 2}%`, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
        />
        <div
          className="absolute rounded-full border border-dashed border-line pointer-events-none"
          style={{ width: `${ZONE_RADIUS_PCT.close * 2}%`, height: `${ZONE_RADIUS_PCT.close * 2}%`, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
        />
        <span className="absolute text-[10px] text-ink-dim pointer-events-none" style={{ left: '50%', top: `${50 - ZONE_RADIUS_PCT.close}%`, transform: 'translate(-50%, -140%)' }}>Close</span>
        <span className="absolute text-[10px] text-ink-faint pointer-events-none" style={{ left: '50%', top: `${50 - ZONE_RADIUS_PCT.near}%`, transform: 'translate(-50%, -140%)' }}>Near</span>

        {positioned.map((t) => (
          <div key={t.id} className="absolute flex flex-col items-center gap-0.5" style={{ left: `${t.x}%`, top: `${t.y}%`, transform: 'translate(-50%, -50%)' }}>
            <div
              className="relative w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium"
              style={{ background: `${t.color}33`, border: `2px solid ${t.color}`, color: t.color }}
            >
              {t.name?.[0]?.toUpperCase() || '?'}
              {litCharacterId === t.id && <Flame size={9} className="absolute -top-1.5 -right-1.5" style={{ color: '#f5a524' }} />}
            </div>
            <span className="text-[9px] text-ink-dim whitespace-nowrap">{t.name}</span>
          </div>
        ))}

        {sceneLabel && (
          <div className="absolute top-2 left-2 bg-black/40 rounded px-2 py-1">
            <p className="text-[10px] text-ink">{sceneLabel}</p>
          </div>
        )}
      </div>
    </div>
  )
}
