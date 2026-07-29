import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Trash2, Users, Flag, Gem } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

// NPCs / Factions / Treasure, ported from tracker.xlsx. "PC Roster" and
// "Session Index" from that workbook aren't here -- they duplicate the
// existing Character Sheet and Campaign Log > Timeline features. Private
// notes and faction goals live in separate GM-only tables so player reads
// and realtime payloads never contain them (020_gm_tracker_secrets.sql).
//
// Same instant-write pattern as CampaignLog.jsx (threads/clocks/timeline):
// every add/edit/delete writes straight through, no local draft state to
// guard against realtime overwrites.
const TABS = [
  { key: 'npcs', label: 'NPCs', icon: Users },
  { key: 'factions', label: 'Factions', icon: Flag },
  { key: 'treasure', label: 'Treasure', icon: Gem },
]

const emptyNpc = { name: '', ancestry: '', role: '', location: '', alignment: '', attitude: '', status: 'Alive', notes: '' }
const emptyFaction = { name: '', type: '', leader: '', territory: '', goal: '', disposition: '', status_clock: '', notes: '' }
const emptyTreasure = { session_number: '', item: '', type: '', qty_value: '', found_at: '', held_by: '', identified: '', notes: '' }

export default function CampaignTracker({ campaignId, session, campaignName = 'The sunken keep', onBack }) {
  const user = session?.user
  const [isGm, setIsGm] = useState(false)
  const [tab, setTab] = useState('npcs')
  const [loading, setLoading] = useState(true)

  const [npcs, setNpcs] = useState([])
  const [factions, setFactions] = useState([])
  const [treasure, setTreasure] = useState([])
  const [npcSecrets, setNpcSecrets] = useState({})
  const [factionSecrets, setFactionSecrets] = useState({})
  const [treasureSecrets, setTreasureSecrets] = useState({})

  const [showAdd, setShowAdd] = useState(false)
  const [npcDraft, setNpcDraft] = useState(emptyNpc)
  const [factionDraft, setFactionDraft] = useState(emptyFaction)
  const [treasureDraft, setTreasureDraft] = useState(emptyTreasure)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!campaignId || !user) return
    let cancelled = false

    supabase
      .from('campaign_members')
      .select('role')
      .eq('campaign_id', campaignId)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setIsGm(data?.role === 'gm')
      })

    Promise.all([
      supabase.from('campaign_npcs').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: true }),
      supabase.from('campaign_factions').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: true }),
      supabase.from('campaign_treasure').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: true }),
      supabase.from('campaign_npc_secrets').select('npc_id, notes'),
      supabase.from('campaign_faction_secrets').select('faction_id, goal, notes'),
      supabase.from('campaign_treasure_secrets').select('treasure_id, notes'),
    ]).then(([n, f, t, ns, fs, ts]) => {
      if (cancelled) return
      setNpcs(n.data || [])
      setFactions(f.data || [])
      setTreasure(t.data || [])
      setNpcSecrets(Object.fromEntries((ns.data || []).map((row) => [row.npc_id, row])))
      setFactionSecrets(Object.fromEntries((fs.data || []).map((row) => [row.faction_id, row])))
      setTreasureSecrets(Object.fromEntries((ts.data || []).map((row) => [row.treasure_id, row])))
      setLoading(false)
    })

    const channel = supabase
      .channel(`campaign-tracker-${campaignId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_npcs', filter: `campaign_id=eq.${campaignId}` }, (payload) => {
        if (payload.eventType === 'INSERT') setNpcs((l) => [...l, payload.new])
        else if (payload.eventType === 'UPDATE') setNpcs((l) => l.map((r) => (r.id === payload.new.id ? payload.new : r)))
        else if (payload.eventType === 'DELETE') setNpcs((l) => l.filter((r) => r.id !== payload.old.id))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_factions', filter: `campaign_id=eq.${campaignId}` }, (payload) => {
        if (payload.eventType === 'INSERT') setFactions((l) => [...l, payload.new])
        else if (payload.eventType === 'UPDATE') setFactions((l) => l.map((r) => (r.id === payload.new.id ? payload.new : r)))
        else if (payload.eventType === 'DELETE') setFactions((l) => l.filter((r) => r.id !== payload.old.id))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_treasure', filter: `campaign_id=eq.${campaignId}` }, (payload) => {
        if (payload.eventType === 'INSERT') setTreasure((l) => [...l, payload.new])
        else if (payload.eventType === 'UPDATE') setTreasure((l) => l.map((r) => (r.id === payload.new.id ? payload.new : r)))
        else if (payload.eventType === 'DELETE') setTreasure((l) => l.filter((r) => r.id !== payload.old.id))
      })
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [campaignId, user])

  const switchTab = (key) => {
    setTab(key)
    setShowAdd(false)
  }

  const addNpc = async () => {
    if (!npcDraft.name.trim() || !campaignId) return
    setSaving(true)
    const { notes, ...publicNpc } = npcDraft
    const { data: npc, error } = await supabase
      .from('campaign_npcs')
      .insert({ campaign_id: campaignId, ...publicNpc, name: npcDraft.name.trim() })
      .select('id')
      .single()
    if (!error && npc && notes.trim()) {
      const { error: secretError } = await supabase.from('campaign_npc_secrets').insert({ npc_id: npc.id, notes: notes.trim() })
      if (secretError) await supabase.from('campaign_npcs').delete().eq('id', npc.id)
      else setNpcSecrets((current) => ({ ...current, [npc.id]: { npc_id: npc.id, notes: notes.trim() } }))
    }
    setSaving(false)
    setNpcDraft(emptyNpc)
    setShowAdd(false)
  }

  const addFaction = async () => {
    if (!factionDraft.name.trim() || !campaignId) return
    setSaving(true)
    const { goal, notes, ...publicFaction } = factionDraft
    const { data: faction, error } = await supabase
      .from('campaign_factions')
      .insert({ campaign_id: campaignId, ...publicFaction, name: factionDraft.name.trim() })
      .select('id')
      .single()
    if (!error && faction && (goal.trim() || notes.trim())) {
      const { error: secretError } = await supabase.from('campaign_faction_secrets').insert({
        faction_id: faction.id,
        goal: goal.trim() || null,
        notes: notes.trim() || null,
      })
      if (secretError) await supabase.from('campaign_factions').delete().eq('id', faction.id)
      else setFactionSecrets((current) => ({ ...current, [faction.id]: { faction_id: faction.id, goal: goal.trim(), notes: notes.trim() } }))
    }
    setSaving(false)
    setFactionDraft(emptyFaction)
    setShowAdd(false)
  }

  const addTreasure = async () => {
    if (!treasureDraft.item.trim() || !campaignId) return
    setSaving(true)
    const { notes, ...publicTreasure } = treasureDraft
    const { data: item, error } = await supabase.from('campaign_treasure').insert({
      campaign_id: campaignId,
      ...publicTreasure,
      item: treasureDraft.item.trim(),
      session_number: treasureDraft.session_number ? parseInt(treasureDraft.session_number, 10) : null,
      identified: treasureDraft.identified === '' ? null : treasureDraft.identified === 'yes',
    }).select('id').single()
    if (!error && item && notes.trim()) {
      const { error: secretError } = await supabase.from('campaign_treasure_secrets').insert({ treasure_id: item.id, notes: notes.trim() })
      if (secretError) await supabase.from('campaign_treasure').delete().eq('id', item.id)
      else setTreasureSecrets((current) => ({ ...current, [item.id]: { treasure_id: item.id, notes: notes.trim() } }))
    }
    setSaving(false)
    setTreasureDraft(emptyTreasure)
    setShowAdd(false)
  }

  const deleteRow = async (table, id) => {
    if (!window.confirm('Remove this entry?')) return
    await supabase.from(table).delete().eq('id', id)
  }

  const inputCls = 'text-xs bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1.5 text-white'

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-xs text-neutral-500">Loading tracker…</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      {onBack && (
        <button onClick={onBack} className="text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1 mb-3">
          <ArrowLeft size={13} /> Back
        </button>
      )}

      <h1 className="text-white text-lg font-medium mb-1">{campaignName}</h1>
      <p className="text-xs text-neutral-400 mb-4">NPCs, factions, and treasure the party has encountered</p>

      <div className="flex gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            className={`flex-1 text-xs py-1.5 rounded-md border flex items-center justify-center gap-1.5 ${
              tab === t.key ? 'bg-neutral-800 border-blue-500 text-white' : 'border-neutral-700 text-neutral-300'
            }`}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {isGm && (
        <div className="mb-3">
          <button
            onClick={() => setShowAdd((s) => !s)}
            className="text-xs border border-neutral-700 rounded-md px-2.5 py-1.5 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800"
          >
            <Plus size={13} /> Add {TABS.find((t) => t.key === tab)?.label.replace(/s$/, '')}
          </button>
        </div>
      )}

      {isGm && showAdd && tab === 'npcs' && (
        <div className="mb-4 bg-neutral-900 border border-neutral-800 rounded-xl p-3 grid grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Name" value={npcDraft.name} onChange={(e) => setNpcDraft({ ...npcDraft, name: e.target.value })} />
          <input className={inputCls} placeholder="Ancestry" value={npcDraft.ancestry} onChange={(e) => setNpcDraft({ ...npcDraft, ancestry: e.target.value })} />
          <input className={inputCls} placeholder="Role/Occupation" value={npcDraft.role} onChange={(e) => setNpcDraft({ ...npcDraft, role: e.target.value })} />
          <input className={inputCls} placeholder="Location" value={npcDraft.location} onChange={(e) => setNpcDraft({ ...npcDraft, location: e.target.value })} />
          <input className={inputCls} placeholder="Alignment" value={npcDraft.alignment} onChange={(e) => setNpcDraft({ ...npcDraft, alignment: e.target.value })} />
          <input className={inputCls} placeholder="Attitude to party" value={npcDraft.attitude} onChange={(e) => setNpcDraft({ ...npcDraft, attitude: e.target.value })} />
          <select className={inputCls} value={npcDraft.status} onChange={(e) => setNpcDraft({ ...npcDraft, status: e.target.value })}>
            {['Alive', 'Dead', 'Missing', 'Unknown'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className={inputCls} placeholder="Notes" value={npcDraft.notes} onChange={(e) => setNpcDraft({ ...npcDraft, notes: e.target.value })} />
          <button onClick={addNpc} disabled={saving || !npcDraft.name.trim()} className="col-span-2 text-xs border border-neutral-700 rounded-md py-1.5 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save NPC'}
          </button>
        </div>
      )}

      {isGm && showAdd && tab === 'factions' && (
        <div className="mb-4 bg-neutral-900 border border-neutral-800 rounded-xl p-3 grid grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Faction name" value={factionDraft.name} onChange={(e) => setFactionDraft({ ...factionDraft, name: e.target.value })} />
          <input className={inputCls} placeholder="Type" value={factionDraft.type} onChange={(e) => setFactionDraft({ ...factionDraft, type: e.target.value })} />
          <input className={inputCls} placeholder="Leader" value={factionDraft.leader} onChange={(e) => setFactionDraft({ ...factionDraft, leader: e.target.value })} />
          <input className={inputCls} placeholder="Base/territory" value={factionDraft.territory} onChange={(e) => setFactionDraft({ ...factionDraft, territory: e.target.value })} />
          <input className={inputCls} placeholder="Goal" value={factionDraft.goal} onChange={(e) => setFactionDraft({ ...factionDraft, goal: e.target.value })} />
          <input className={inputCls} placeholder="Disposition to party" value={factionDraft.disposition} onChange={(e) => setFactionDraft({ ...factionDraft, disposition: e.target.value })} />
          <input className={inputCls} placeholder="Current status / clock" value={factionDraft.status_clock} onChange={(e) => setFactionDraft({ ...factionDraft, status_clock: e.target.value })} />
          <input className={inputCls} placeholder="Notes" value={factionDraft.notes} onChange={(e) => setFactionDraft({ ...factionDraft, notes: e.target.value })} />
          <button onClick={addFaction} disabled={saving || !factionDraft.name.trim()} className="col-span-2 text-xs border border-neutral-700 rounded-md py-1.5 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save faction'}
          </button>
        </div>
      )}

      {isGm && showAdd && tab === 'treasure' && (
        <div className="mb-4 bg-neutral-900 border border-neutral-800 rounded-xl p-3 grid grid-cols-2 gap-2">
          <input className={inputCls} type="number" placeholder="Session #" value={treasureDraft.session_number} onChange={(e) => setTreasureDraft({ ...treasureDraft, session_number: e.target.value })} />
          <input className={inputCls} placeholder="Item / coin" value={treasureDraft.item} onChange={(e) => setTreasureDraft({ ...treasureDraft, item: e.target.value })} />
          <input className={inputCls} placeholder="Type" value={treasureDraft.type} onChange={(e) => setTreasureDraft({ ...treasureDraft, type: e.target.value })} />
          <input className={inputCls} placeholder="Qty / value" value={treasureDraft.qty_value} onChange={(e) => setTreasureDraft({ ...treasureDraft, qty_value: e.target.value })} />
          <input className={inputCls} placeholder="Found at" value={treasureDraft.found_at} onChange={(e) => setTreasureDraft({ ...treasureDraft, found_at: e.target.value })} />
          <input className={inputCls} placeholder="Held by" value={treasureDraft.held_by} onChange={(e) => setTreasureDraft({ ...treasureDraft, held_by: e.target.value })} />
          <select className={inputCls} value={treasureDraft.identified} onChange={(e) => setTreasureDraft({ ...treasureDraft, identified: e.target.value })}>
            <option value="">Identified?</option>
            <option value="yes">Identified</option>
            <option value="no">Not identified</option>
          </select>
          <input className={inputCls} placeholder="Notes" value={treasureDraft.notes} onChange={(e) => setTreasureDraft({ ...treasureDraft, notes: e.target.value })} />
          <button onClick={addTreasure} disabled={saving || !treasureDraft.item.trim()} className="col-span-2 text-xs border border-neutral-700 rounded-md py-1.5 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save item'}
          </button>
        </div>
      )}

      {tab === 'npcs' && (
        <div className="flex flex-col gap-1.5">
          {npcs.length === 0 && <p className="text-xs text-neutral-500">No NPCs logged yet.</p>}
          {npcs.map((n) => (
            <div key={n.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-white font-medium">
                  {n.name}
                  {n.ancestry && <span className="text-neutral-500 font-normal"> &middot; {n.ancestry}</span>}
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">{n.status}</span>
                  {isGm && (
                    <button onClick={() => deleteRow('campaign_npcs', n.id)} className="text-neutral-500 hover:text-red-400 p-0.5">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-neutral-400">
                {[n.role, n.location, n.alignment].filter(Boolean).join(' · ')}
              </p>
              {n.attitude && <p className="text-xs text-neutral-500 mt-0.5">Attitude: {n.attitude}</p>}
              {isGm && npcSecrets[n.id]?.notes && <p className="text-xs text-neutral-500 mt-1">{npcSecrets[n.id].notes}</p>}
            </div>
          ))}
        </div>
      )}

      {tab === 'factions' && (
        <div className="flex flex-col gap-1.5">
          {factions.length === 0 && <p className="text-xs text-neutral-500">No factions logged yet.</p>}
          {factions.map((f) => (
            <div key={f.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-white font-medium">
                  {f.name}
                  {f.type && <span className="text-neutral-500 font-normal"> &middot; {f.type}</span>}
                </p>
                <div className="flex items-center gap-1.5">
                  {f.disposition && <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">{f.disposition}</span>}
                  {isGm && (
                    <button onClick={() => deleteRow('campaign_factions', f.id)} className="text-neutral-500 hover:text-red-400 p-0.5">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-neutral-400">
                {[f.leader && `Led by ${f.leader}`, f.territory].filter(Boolean).join(' · ')}
              </p>
              {isGm && factionSecrets[f.id]?.goal && <p className="text-xs text-neutral-500 mt-0.5">Goal: {factionSecrets[f.id].goal}</p>}
              {f.status_clock && <p className="text-xs text-neutral-500 mt-0.5">Status: {f.status_clock}</p>}
              {isGm && factionSecrets[f.id]?.notes && <p className="text-xs text-neutral-500 mt-1">{factionSecrets[f.id].notes}</p>}
            </div>
          ))}
        </div>
      )}

      {tab === 'treasure' && (
        <div className="flex flex-col gap-1.5">
          {treasure.length === 0 && <p className="text-xs text-neutral-500">No treasure logged yet.</p>}
          {treasure.map((t) => (
            <div key={t.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-white font-medium">
                  {t.item}
                  {t.qty_value && <span className="text-neutral-500 font-normal"> &middot; {t.qty_value}</span>}
                </p>
                <div className="flex items-center gap-1.5">
                  {t.session_number != null && <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">Session {t.session_number}</span>}
                  {t.identified === true && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">Identified</span>}
                  {t.identified === false && <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">Unidentified</span>}
                  {isGm && (
                    <button onClick={() => deleteRow('campaign_treasure', t.id)} className="text-neutral-500 hover:text-red-400 p-0.5">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-neutral-400">
                {[t.type, t.found_at && `Found at ${t.found_at}`, t.held_by && `Held by ${t.held_by}`].filter(Boolean).join(' · ')}
              </p>
              {isGm && treasureSecrets[t.id]?.notes && <p className="text-xs text-neutral-500 mt-1">{treasureSecrets[t.id].notes}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
