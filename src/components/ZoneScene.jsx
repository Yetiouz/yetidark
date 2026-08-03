import { useState } from 'react'
import { Flame } from 'lucide-react'
import PlaceholderScene from './ui/PlaceholderScene.jsx'

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

// party: [{ id, name, color, zone }], monsters: [{ id, name, zone }],
// secrets: [{ id, name, zone, state }] -- monsters render in neutral gray
// since they don't carry the per-character color identity players do;
// secrets render amber with a dashed "?" ring while tell_visible, solid
// once revealed (hidden ones never reach this component for a player --
// RLS blocks the row entirely -- so secretState is only ever the other
// two on the player page). litCharacterId centers a soft light-radius
// glow on whichever token currently owns the lit torch, since no
// Shadowdark ancestry has darkvision and "who's lit" is gameplay-critical,
// not decorative -- it should move with the torchbearer, not sit fixed on
// the room.
//
// onSelectToken(id, type, name), if passed, makes every token clickable --
// this is the map-selection half of the GM notes "contextual inspector"
// design decision (see GmDashboard.jsx's selectedEntity). Omit it (the
// player table does) and tokens render exactly as before, not clickable.
//
// onSetZone(type, id, zone), if passed, right-click on a token instead
// pops a small Close/Near/Far menu right on the map -- GM-only by default
// (GameTable.jsx passes this for player self-movement too, but scoped
// down via moveRestriction below), replacing the old always-visible
// per-character/monster zone button list GmDashboard.jsx used to render
// below the map.
//
// moveRestriction ({ tokenId, allowedZones }), if passed alongside
// onSetZone, narrows it to player self-movement: only tokenId's own
// right-click menu opens (not party members' or monsters'), and the menu
// only lists allowedZones (the caller pre-computes which zones are
// adjacent to that token's current one -- Shadowdark's "Near movement" is
// a bounded step, not a teleport). Omit it and onSetZone behaves exactly
// as before: any token, all three zones -- the GM's own unrestricted
// control.
export default function ZoneScene({ mapUrl, mapAccessError, sceneLabel, party = [], monsters = [], secrets = [], litCharacterId, onSelectToken, selectedTokenId, onSetZone, moveRestriction }) {
  const [zoneMenu, setZoneMenu] = useState(null) // { id, type, name, x, y } while a right-click menu is open

  const tokens = [
    ...party.map((p) => ({ id: p.id, name: p.name, color: p.color || '#3b82f6', zone: p.zone || 'near', type: 'character' })),
    ...monsters.map((m) => ({ id: m.id, name: m.name, color: '#737373', zone: m.zone || 'near', type: 'monster', hp: m.hp, maxHp: m.max_hp, hpVisible: m.hp_visible })),
    // Secrets (traps, hidden doors): hidden ones never reach this component
    // at all for a player (RLS blocks the row before it's fetched), so
    // secretState is only ever 'tell_visible'/'revealed' on the player
    // page -- the GM sees all three via its own full-access fetch.
    // amber for the same "needs attention" reason the design system
    // reserves amber for torch/warnings; a dashed ring for tell_visible
    // marks it as a hint, not a confirmed reveal.
    ...secrets.map((s) => ({ id: s.id, name: s.name, color: '#f5a524', zone: s.zone || 'near', type: 'secret', secretState: s.state })),
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
    // h-full on this root and the scene box below: percentage heights fall
    // back to auto against an auto-sized ancestor (mobile, stacked layout),
    // so the inline aspectRatio still governs there exactly as before; at
    // md+ the caller's flex layout gives this a definite height to fill
    // (see GameTable.jsx's map/log 2:1 split), and h-full picks that up.
    <div className="h-full">
      {mapAccessError && <p className="text-xs text-danger-text mb-2">{mapAccessError}</p>}
      <div className="relative w-full h-full rounded-lg overflow-hidden bg-bg border border-line-soft" style={{ aspectRatio: '16 / 7' }}>
        {mapUrl ? (
          <img src={mapUrl} alt={sceneLabel || 'Scene'} className="absolute inset-0 w-full h-full object-cover opacity-80" />
        ) : (
          <PlaceholderScene caption="scene art placeholder -- map/zone view comes later" />
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

        {positioned.map((t) => {
          const selected = selectedTokenId === t.id
          const clickable = Boolean(onSelectToken)
          return (
            <button
              key={t.id}
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelectToken(t.id, t.type, t.name)}
              onContextMenu={(e) => {
                if (!onSetZone) return
                if (moveRestriction && t.id !== moveRestriction.tokenId) return
                e.preventDefault()
                setZoneMenu({ id: t.id, type: t.type, name: t.name, x: t.x, y: t.y })
              }}
              className={`absolute flex flex-col items-center gap-1 bg-transparent border-0 p-0 ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
              style={{ left: `${t.x}%`, top: `${t.y}%`, transform: 'translate(-50%, -50%)' }}
            >
              <div
                className="relative w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium"
                style={{
                  background: `${t.color}33`,
                  border: selected ? '2px solid #3b82f6' : `2px ${t.type === 'secret' && t.secretState === 'tell_visible' ? 'dashed' : 'solid'} ${t.color}`,
                  boxShadow: selected ? '0 0 0 2px rgba(59,130,246,0.5)' : 'none',
                  color: t.color,
                }}
              >
                {t.type === 'secret' && t.secretState === 'tell_visible' ? '?' : t.name?.[0]?.toUpperCase() || '?'}
                {litCharacterId === t.id && <Flame size={9} className="absolute -top-1.5 -right-1.5" style={{ color: '#f5a524' }} />}
              </div>
              <span className={`text-[9px] whitespace-nowrap ${selected ? 'text-primary-text font-medium' : 'text-ink-dim'}`}>{t.name}</span>
              {t.type === 'monster' && t.hpVisible && t.hp != null && (
                <span className="text-[8px] text-ink-faint whitespace-nowrap">{t.hp}/{t.maxHp} HP</span>
              )}
            </button>
          )
        })}

        {sceneLabel && (
          <div className="absolute top-2 left-2 bg-black/40 rounded px-2 py-1">
            <p className="text-[10px] text-ink">{sceneLabel}</p>
          </div>
        )}

        {zoneMenu && (
          <>
            {/* Full-cover backdrop closes the menu on an outside click or a
                second right-click, without needing a document-level listener. */}
            <div
              className="absolute inset-0 z-10"
              onClick={() => setZoneMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setZoneMenu(null) }}
            />
            <div
              className="absolute z-20 bg-panel border border-line-soft rounded-lg shadow-lg py-1 flex flex-col min-w-[96px]"
              style={{ left: `${zoneMenu.x}%`, top: `${zoneMenu.y}%`, transform: 'translate(-50%, 10px)' }}
            >
              <p className="text-[10px] text-ink-dim px-3 pt-1 pb-2 mb-1 border-b border-line-soft truncate">{zoneMenu.name}</p>
              {(moveRestriction && moveRestriction.tokenId === zoneMenu.id ? moveRestriction.allowedZones : ['close', 'near', 'far']).map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => { onSetZone(zoneMenu.type, zoneMenu.id, z); setZoneMenu(null) }}
                  className="text-xs text-left px-3 py-1 capitalize text-ink hover:bg-panel2"
                >
                  {z}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
