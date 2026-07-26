import { useState } from 'react'
import { Eye, Plus, Brush, Flag } from 'lucide-react'
import HexMap from './HexMap.jsx'
import { encounter as initialEncounter, gmNotes as initialNotes, initialHexGrid } from '../mockData.js'

export default function GmDashboard({ campaignName = 'The sunken keep', onSwitchToPlayerView }) {
  const [encounter, setEncounter] = useState(initialEncounter)
  const [notes, setNotes] = useState(initialNotes)
  const [grid, setGrid] = useState(initialHexGrid)
  const [search, setSearch] = useState('')

  const adjustHp = (id, delta) => {
    setEncounter((list) =>
      list.map((m) => (m.id === id ? { ...m, hp: Math.max(0, Math.min(m.maxHp, m.hp + delta)) } : m))
    )
  }

  const revealMonster = (id) => {
    setEncounter((list) => list.map((m) => (m.id === id ? { ...m, hidden: false } : m)))
  }

  const revealNote = (id) => {
    setNotes((list) => list.map((n) => (n.id === id ? { ...n, revealed: true } : n)))
  }

  const revealHex = (row, col) => {
    setGrid((g) => {
      const next = g.map((r) => r.slice())
      next[row][col] = { ...next[row][col], state: 'explored' }
      return next
    })
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <p className="text-white font-medium">{campaignName}</p>
          <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">GM view</span>
        </div>
        {onSwitchToPlayerView && (
          <button
            onClick={onSwitchToPlayerView}
            className="text-xs border border-neutral-700 rounded-md px-2.5 py-1 flex items-center gap-1.5 text-neutral-300 hover:bg-neutral-800"
          >
            <Eye size={14} /> Switch to player view
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-3 mb-3">
        <div className="bg-neutral-900 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-xs text-neutral-400">Active encounter</p>
            <div className="flex gap-1.5">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search bestiary"
                className="text-xs bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 w-32 text-white"
              />
              <button className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1 text-neutral-200 hover:bg-neutral-800">
                <Plus size={13} /> Add
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            {encounter.map((m) => (
              <div
                key={m.id}
                className={`flex items-center justify-between text-xs p-2 bg-neutral-800/60 rounded-md border ${
                  m.hidden ? 'border-red-800/60' : 'border-neutral-700'
                }`}
              >
                <div>
                  <span className="font-medium text-white">{m.name}</span>
                  <span className="text-neutral-500"> &middot; ac {m.ac}{m.hidden ? ' · hidden' : ''}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => adjustHp(m.id, -1)} className="px-1.5 border border-neutral-700 rounded text-neutral-300">-</button>
                  <span className="min-w-[44px] text-center text-neutral-200">{m.hp} / {m.maxHp} hp</span>
                  <button onClick={() => adjustHp(m.id, 1)} className="px-1.5 border border-neutral-700 rounded text-neutral-300">+</button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-3 pt-2.5 border-t border-neutral-800">
            <button className="flex-1 text-xs border border-neutral-700 rounded-md py-1.5 text-neutral-200 hover:bg-neutral-800">
              Roll monster initiative
            </button>
            {encounter.some((m) => m.hidden) && (
              <button
                onClick={() => encounter.filter((m) => m.hidden).forEach((m) => revealMonster(m.id))}
                className="flex-1 text-xs border border-neutral-700 rounded-md py-1.5 text-neutral-200 hover:bg-neutral-800"
              >
                Reveal hidden monster
              </button>
            )}
          </div>
        </div>

        <div className="bg-neutral-900 rounded-lg p-3">
          <p className="text-xs text-neutral-400 mb-2">GM notes (private)</p>
          <div className="flex flex-col gap-1.5">
            {notes.map((n) => (
              <div key={n.id} className="text-xs p-2 bg-neutral-800/60 rounded-md">
                <p className={`mb-1.5 ${n.revealed ? 'text-neutral-500 line-through' : 'text-neutral-200'}`}>{n.text}</p>
                {!n.revealed && (
                  <button
                    onClick={() => revealNote(n.id)}
                    className="text-[11px] px-2 py-0.5 border border-neutral-700 rounded text-neutral-300 hover:bg-neutral-700"
                  >
                    Reveal to party
                  </button>
                )}
              </div>
            ))}
          </div>
          <button className="w-full text-xs mt-2 border border-neutral-700 rounded-md py-1.5 flex items-center justify-center gap-1.5 text-neutral-300 hover:bg-neutral-800">
            <Plus size={13} /> Add note
          </button>
        </div>
      </div>

      <div className="bg-neutral-900 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-xs text-neutral-400">Map controls</p>
          <div className="flex gap-1.5">
            <button className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800">
              <Brush size={13} /> Manually reveal hex
            </button>
            <button className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800">
              <Flag size={13} /> Drop "head here" marker
            </button>
          </div>
        </div>
        <HexMap grid={grid} onRevealHex={revealHex} allowManualReveal={true} />
        <p className="text-[11px] text-neutral-500 mt-2">
          Fog clears automatically as the party moves, or reveal a hex early if a note calls for it. Click a foggy hex above to try it.
        </p>
      </div>
    </div>
  )
}
