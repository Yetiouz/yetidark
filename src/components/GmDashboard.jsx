import { useState, useEffect, useRef } from 'react'
import { Eye, Plus, Flag, Upload, RotateCcw, Dices, SkipForward } from 'lucide-react'
import MapGrid from './MapGrid.jsx'
import { supabase } from '../lib/supabaseClient.js'

// Everything here is real Supabase data, synced live: the encounter
// tracker, GM notes, turn order, the scene log, and the map panel (upload,
// grid size, party marker, reveal/re-fog).
export default function GmDashboard({ campaignId, session, campaignName = 'The sunken keep', onSwitchToPlayerView }) {
  const user = session?.user
  const [displayName, setDisplayName] = useState('GM')
  const [encounter, setEncounter] = useState([])
  const [notes, setNotes] = useState([])
  const [noteDraft, setNoteDraft] = useState('')
  const [monsterDraft, setMonsterDraft] = useState('')
  const [party, setParty] = useState([])
  const [turnOrder, setTurnOrder] = useState([])
  const [log, setLog] = useState([])
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || user.email || 'GM'))
  }, [user])

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
      .from('encounter_monsters')
      .select('id, name, ac, hp, max_hp, hidden')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setEncounter(data || []) })

    supabase
      .from('gm_notes')
      .select('id, text, revealed')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setNotes(data || []) })

    supabase
      .from('characters')
      .select('id, name')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setParty(data || []) })

    supabase
      .from('turn_order')
      .select('order_list')
      .eq('campaign_id', campaignId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setTurnOrder(data?.order_list || []) })

    supabase
      .from('campaigns')
      .select('map_url, map_cols, map_rows, party_row, party_col')
      .eq('id', campaignId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setMapInfo(data) })

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

    supabase
      .from('scene_log')
      .select('id, type, sender_name, text, roll_source, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setLog(data || []) })

    const channel = supabase
      .channel(`gm-dashboard-${campaignId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scene_log', filter: `campaign_id=eq.${campaignId}` },
        (payload) => setLog((l) => [...l, payload.new])
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'encounter_monsters', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setEncounter((list) => [...list, payload.new])
          else if (payload.eventType === 'UPDATE') setEncounter((list) => list.map((m) => (m.id === payload.new.id ? payload.new : m)))
          else if (payload.eventType === 'DELETE') setEncounter((list) => list.filter((m) => m.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gm_notes', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setNotes((list) => [...list, payload.new])
          else if (payload.eventType === 'UPDATE') setNotes((list) => list.map((n) => (n.id === payload.new.id ? payload.new : n)))
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'characters', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setParty((p) => [...p, payload.new])
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'turn_order', filter: `campaign_id=eq.${campaignId}` },
        (payload) => setTurnOrder(payload.new?.order_list || [])
      )
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

  const adjustHp = async (monster, delta) => {
    const nextHp = Math.max(0, Math.min(monster.max_hp, monster.hp + delta))
    setEncounter((list) => list.map((m) => (m.id === monster.id ? { ...m, hp: nextHp } : m)))
    await supabase.from('encounter_monsters').update({ hp: nextHp }).eq('id', monster.id)
  }

  const revealMonster = async (id) => {
    setEncounter((list) => list.map((m) => (m.id === id ? { ...m, hidden: false } : m)))
    await supabase.from('encounter_monsters').update({ hidden: false }).eq('id', id)
  }

  const addMonster = async () => {
    const name = monsterDraft.trim()
    if (!name || !campaignId) return
    const acInput = window.prompt('Armor class?', '10')
    if (acInput === null) return
    const hpInput = window.prompt('Starting / max HP?', '4')
    if (hpInput === null) return
    const ac = parseInt(acInput, 10) || 10
    const hp = Math.max(1, parseInt(hpInput, 10) || 1)
    await supabase.from('encounter_monsters').insert({ campaign_id: campaignId, name, ac, hp, max_hp: hp, hidden: false })
    setMonsterDraft('')
  }

  const revealNote = async (id) => {
    setNotes((list) => list.map((n) => (n.id === id ? { ...n, revealed: true } : n)))
    await supabase.from('gm_notes').update({ revealed: true }).eq('id', id)
  }

  const addNote = async () => {
    if (!noteDraft.trim() || !campaignId) return
    await supabase.from('gm_notes').insert({ campaign_id: campaignId, text: noteDraft.trim() })
    setNoteDraft('')
  }

  const rollInitiative = async () => {
    if (!campaignId) return
    const participants = [
      ...party.map((c) => ({ id: c.id, name: c.name })),
      ...encounter.filter((m) => !m.hidden).map((m) => ({ id: m.id, name: m.name })),
    ]
    if (participants.length === 0) return

    const rolled = participants
      .map((p) => ({ ...p, roll: Math.floor(Math.random() * 20) + 1 }))
      .sort((a, b) => b.roll - a.roll)

    await Promise.all(
      rolled.map((p) =>
        supabase.from('scene_log').insert({
          campaign_id: campaignId,
          type: 'roll',
          sender_name: p.name,
          text: `rolled a ${p.roll} (d20) for initiative`,
          roll_source: 'app',
        })
      )
    )

    const orderList = rolled.map((p, i) => ({ id: p.id, name: p.name, status: i === 0 ? 'acting' : 'waiting' }))
    setTurnOrder(orderList)
    await supabase.from('turn_order').upsert({ campaign_id: campaignId, order_list: orderList }, { onConflict: 'campaign_id' })
  }

  const advanceTurn = async () => {
    if (!campaignId || turnOrder.length === 0) return
    const rotated = [...turnOrder.slice(1), turnOrder[0]].map((t, i) => ({ ...t, status: i === 0 ? 'acting' : 'waiting' }))
    setTurnOrder(rotated)
    await supabase.from('turn_order').upsert({ campaign_id: campaignId, order_list: rotated }, { onConflict: 'campaign_id' })
  }

  const revealCell = async (row, col) => {
    if (!campaignId) return
    setCellState((s) => ({ ...s, [`${row},${col}`]: 'explored' }))
    await supabase.from('map_cells').upsert({ campaign_id: campaignId, row, col, state: 'explored' }, { onConflict: 'campaign_id,row,col' })
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
    const { error: updateError } = await supabase.from('campaigns').update({ map_url: pub.publicUrl }).eq('id', campaignId)
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

  const sendMessage = async () => {
    if (!message.trim() || !campaignId) return
    const text = message.trim()
    setMessage('')
    await supabase.from('scene_log').insert({
      campaign_id: campaignId,
      type: 'gm',
      sender_user_id: user?.id,
      sender_name: displayName,
      text,
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
                value={monsterDraft}
                onChange={(e) => setMonsterDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addMonster()}
                placeholder="Monster name"
                className="text-xs bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 w-32 text-white"
              />
              <button onClick={addMonster} className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1 text-neutral-200 hover:bg-neutral-800">
                <Plus size={13} /> Add
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            {encounter.length === 0 && <p className="text-xs text-neutral-500">No monsters yet -- add one above.</p>}
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
                  <button onClick={() => adjustHp(m, -1)} className="px-1.5 border border-neutral-700 rounded text-neutral-300">-</button>
                  <span className="min-w-[44px] text-center text-neutral-200">{m.hp} / {m.max_hp} hp</span>
                  <button onClick={() => adjustHp(m, 1)} className="px-1.5 border border-neutral-700 rounded text-neutral-300">+</button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-3 pt-2.5 border-t border-neutral-800">
            <button onClick={rollInitiative} className="flex-1 text-xs border border-neutral-700 rounded-md py-1.5 flex items-center justify-center gap-1.5 text-neutral-200 hover:bg-neutral-800">
              <Dices size={13} /> Roll initiative
            </button>
            {turnOrder.length > 0 && (
              <button onClick={advanceTurn} className="flex-1 text-xs border border-neutral-700 rounded-md py-1.5 flex items-center justify-center gap-1.5 text-neutral-200 hover:bg-neutral-800">
                <SkipForward size={13} /> Advance turn
              </button>
            )}
            {encounter.some((m) => m.hidden) && (
              <button
                onClick={() => encounter.filter((m) => m.hidden).forEach((m) => revealMonster(m.id))}
                className="flex-1 text-xs border border-neutral-700 rounded-md py-1.5 text-neutral-200 hover:bg-neutral-800"
              >
                Reveal hidden monster
              </button>
            )}
          </div>

          {turnOrder.length > 0 && (
            <div className="mt-2.5 pt-2.5 border-t border-neutral-800">
              <p className="text-[11px] text-neutral-500 mb-1.5">Turn order</p>
              <div className="flex flex-wrap gap-1.5">
                {turnOrder.map((t, i) => (
                  <span
                    key={t.id || i}
                    className={`text-[11px] px-2 py-0.5 rounded-full ${
                      t.status === 'acting' ? 'bg-blue-500/20 text-blue-300' : 'bg-neutral-800 text-neutral-400'
                    }`}
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bg-neutral-900 rounded-lg p-3">
          <p className="text-xs text-neutral-400 mb-2">GM notes (private)</p>
          <div className="flex flex-col gap-1.5">
            {notes.length === 0 && <p className="text-xs text-neutral-500">No notes yet.</p>}
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
          <div className="flex gap-1.5 mt-2">
            <input
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addNote()}
              placeholder="New note"
              className="flex-1 text-xs bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-white"
            />
            <button onClick={addNote} className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1 text-neutral-300 hover:bg-neutral-800">
              <Plus size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="bg-neutral-900 rounded-lg p-4 mb-3">
        <p className="text-xs text-neutral-400 mb-2">Scene log</p>
        <div className="h-[180px] overflow-y-auto flex flex-col gap-2 text-sm pr-1 mb-2.5">
          {log.length === 0 && <p className="text-xs text-neutral-500">No messages yet -- narrate something below.</p>}
          {log.map((entry) => {
            if (entry.type === 'narration') {
              return <p key={entry.id} className="italic text-neutral-400">{entry.text}</p>
            }
            if (entry.type === 'gm') {
              return (
                <p key={entry.id}>
                  <span className="font-medium text-blue-400">{entry.sender_name}:</span>{' '}
                  <span className="text-neutral-300">{entry.text}</span>
                </p>
              )
            }
            if (entry.type === 'roll') {
              return (
                <p key={entry.id} className="flex items-center gap-1.5 flex-wrap">
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
                </p>
              )
            }
            return (
              <p key={entry.id}>
                <span className="font-medium text-white">{entry.sender_name}:</span>{' '}
                <span className="text-neutral-300">{entry.text}</span>
              </p>
            )
          })}
        </div>
        <div className="flex gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Narrate something to the party"
            className="flex-1 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-white"
          />
          <button onClick={sendMessage} className="text-sm border border-neutral-700 rounded-md px-3 py-1.5 text-neutral-200 hover:bg-neutral-800">
            Send
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
