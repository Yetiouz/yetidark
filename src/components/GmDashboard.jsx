import { useState, useEffect, useRef } from 'react'
import { Eye, Plus, Flag, Upload, RotateCcw } from 'lucide-react'
import MapGrid from './MapGrid.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { encounter as initialEncounter, gmNotes as initialNotes } from '../mockData.js'

// Encounter tracker and GM notes are still mock data (next slice of Phase
// 4). The map panel is real: upload an image, set the grid size, drop the
// party marker, and reveal or re-fog cells -- all synced live via Supabase.
export default function GmDashboard({ campaignId, campaignName = 'The sunken keep', onSwitchToPlayerView }) {
  const [encounter, setEncounter] = useState(initialEncounter)
  const [notes, setNotes] = useState(initialNotes)
  const [search, setSearch] = useState('')

  const [mapInfo, setMapInfo] = useState(null)
  const [cellState, setCellState] = useState({})
  const [mapMode, setMapMode] = useState('reveal') // 'reveal' | 'move'
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false

    supabase
      .from('campaigns')
      .select('map_url, map_cols, map_rows, party_row, party_col')
      .eq('id', campaignId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setMapInfo(data)
      })

    supabase
      .from('map_cells')
      .select('row, col, state')
      .eq('campaign_id', campaignId)
      .then(({ data }) => {
        if (cancelled) return
        const next = {}
        for (const cell of data || []) next[`${cell.row},${cell.col}`] = cell.state
        setCellState(next)
      })

    const channel = supabase
      .channel(`gm-dashboard-${campaignId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'map_cells', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          const row = payload.new
          if (!row) return
          setCellState((s) => ({ ...s, [`${row.row},${row.col}`]: row.state }))
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${campaignId}` },
        (payload) => setMapInfo(payload.new)
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [campaignId])

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

  const revealCell = async (row, col) => {
    if (!campaignId) return
    setCellState((s) => ({ ...s, [`${row},${col}`]: 'explored' }))
    await supabase
      .from('map_cells')
      .upsert({ campaign_id: campaignId, row, col, state: 'explored' }, { onConflict: 'campaign_id,row,col' })
  }

  const movePartyTo = async (row, col) => {
    if (!campaignId) return
    setMapInfo((m) => ({ ...(m || {}), party_row: row, party_col: col }))
    await supabase.from('campaigns').update({ party_row: row, party_col: col }).eq('id', campaignId)
  }

  const handleMapClick = (row, col) => {
    if (mapMode === 'move') movePartyTo(row, col)
    else revealCell(row, col)
  }

  const uploadMap = async (file) => {
    if (!file || !campaignId) return
    setUploading(true)
    setUploadError(null)
    const path = `${campaignId}/${Date.now()}-${file.name}`
    const { error: storageError } = await supabase.storage.from('maps').upload(path, file, { upsert: true })
    if (storageError) {
      setUploadError(storageError.message)
      setUploading(false)
      return
    }
    const { data: pub } = supabase.storage.from('maps').getPublicUrl(path)
    const { error: updateError } = await supabase
      .from('campaigns')
      .update({ map_url: pub.publicUrl })
      .eq('id', campaignId)
    setUploading(false)
    if (updateError) {
      setUploadError(updateError.message)
      return
    }
    setMapInfo((m) => ({ ...(m || {}), map_url: pub.publicUrl }))
  }

  const updateGridSize = async (field, value) => {
    const n = Math.max(2, Math.min(30, parseInt(value, 10) || 1))
    setMapInfo((m) => ({ ...(m || {}), [field]: n }))
    await supabase.from('campaigns').update({ [field]: n }).eq('id', campaignId)
  }

  const refogMap = async () => {
    if (!campaignId) return
    if (!window.confirm("Clear all explored fog for this map? This can't be undone.")) return
    await supabase.from('map_cells').delete().eq('campaign_id', campaignId)
    setCellState({})
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
        <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
          <p className="text-xs text-neutral-400">Map controls</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => uploadMap(e.target.files?.[0])}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
            >
              <Upload size={13} /> {uploading ? 'Uploading...' : mapInfo?.map_url ? 'Replace map image' : 'Upload map image'}
            </button>
            <div className="flex items-center gap-1 text-xs text-neutral-400">
              <span>cols</span>
              <input
                type="number"
                value={mapInfo?.map_cols ?? 10}
                onChange={(e) => updateGridSize('map_cols', e.target.value)}
                className="w-12 bg-neutral-950 border border-neutral-700 rounded px-1 py-0.5 text-white"
              />
              <span>rows</span>
              <input
                type="number"
                value={mapInfo?.map_rows ?? 6}
                onChange={(e) => updateGridSize('map_rows', e.target.value)}
                className="w-12 bg-neutral-950 border border-neutral-700 rounded px-1 py-0.5 text-white"
              />
            </div>
            <button
              onClick={() => setMapMode((m) => (m === 'move' ? 'reveal' : 'move'))}
              className={`text-xs border rounded-md px-2 py-1 flex items-center gap-1.5 hover:bg-neutral-800 ${
                mapMode === 'move' ? 'border-blue-500 text-blue-300 bg-blue-500/10' : 'border-neutral-700 text-neutral-200'
              }`}
            >
              <Flag size={13} /> {mapMode === 'move' ? 'Click map to drop party' : 'Move party marker'}
            </button>
            <button
              onClick={refogMap}
              className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800"
            >
              <RotateCcw size={13} /> Re-fog map
            </button>
          </div>
        </div>
        {uploadError && <p className="text-xs text-red-400 mb-2">{uploadError}</p>}
        <MapGrid
          mapUrl={mapInfo?.map_url}
          cols={mapInfo?.map_cols || 10}
          rows={mapInfo?.map_rows || 6}
          cellState={cellState}
          partyRow={mapInfo?.party_row}
          partyCol={mapInfo?.party_col}
          mode={mapMode}
          onCellClick={handleMapClick}
        />
        <p className="text-[11px] text-neutral-500 mt-2">
          {mapMode === 'move'
            ? 'Click anywhere on the map to move the party marker.'
            : "Fog clears permanently as cells are explored. Use re-fog for story reasons like amnesia."}
        </p>
      </div>
    </div>
  )
}
