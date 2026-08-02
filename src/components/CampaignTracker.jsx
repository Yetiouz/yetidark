import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, Trash2, Pencil } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import Tabs from './ui/Tabs.jsx'
import Badge from './ui/Badge.jsx'
import Card from './ui/Card.jsx'

// NPCs / Factions / Treasure, ported from tracker.xlsx. "PC Roster" and
// "Session Index" from that workbook aren't here -- they duplicate the
// existing Character Sheet and Campaign Log > Timeline features. Private
// notes and faction goals live in separate GM-only tables so player reads
// and realtime payloads never contain them (020_gm_tracker_secrets.sql).
//
// Same instant-write pattern as CampaignLog.jsx (threads/clocks/timeline):
// every add/edit/delete writes straight through, no local draft state to
// guard against realtime overwrites -- the row list itself stays driven by
// the realtime channel below, including after an edit's UPDATE lands.
//
// Click-to-edit (bug #3) reuses this exact add-draft shape rather than a
// separate edit UI: clicking a row's pencil icon populates the same
// npcDraft/factionDraft/treasureDraft state the "Add" button uses (full
// current row + secret notes, not just the field that changed) and opens
// the same form panel; saveNpc/saveFaction/saveTreasure branch on `editId`
// to call .update() instead of .insert(). Because the draft always holds
// every public column (never a sparse single-field patch), the update
// payload can't silently null out the row's other fields.
const TABS = [
  { key: 'npcs', label: 'NPCs' },
  { key: 'factions', label: 'Factions' },
  { key: 'treasure', label: 'Treasure' },
]

// Alive/Dead/Missing/Unknown maps onto the Section 1.1 semantic colors
// (green = positive/alive, red = danger, amber = needs-attention) instead
// of the flat neutral pill this screen used before -- the color system's
// own rule ("green's job is positive/alive/complete"), just not applied
// here yet.
const NPC_STATUS_TONE = { Alive: 'green', Dead: 'red', Missing: 'amber', Unknown: 'neutral' }

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
  const [editId, setEditId] = useState(null)
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
    setEditId(null)
  }

  // Shared close/reset for both the add and edit forms -- also what the
  // "Add X" toggle calls when a form is already open, so it always fully
  // discards whatever draft was in progress rather than leaving stale
  // values behind for the next open.
  const cancelForm = () => {
    setShowAdd(false)
    setEditId(null)
    setNpcDraft(emptyNpc)
    setFactionDraft(emptyFaction)
    setTreasureDraft(emptyTreasure)
  }

  const toggleAdd = () => {
    if (showAdd) {
      cancelForm()
      return
    }
    setEditId(null)
    setNpcDraft(emptyNpc)
    setFactionDraft(emptyFaction)
    setTreasureDraft(emptyTreasure)
    setShowAdd(true)
  }

  const startEditNpc = (n) => {
    setEditId(n.id)
    setNpcDraft({
      name: n.name || '',
      ancestry: n.ancestry || '',
      role: n.role || '',
      location: n.location || '',
      alignment: n.alignment || '',
      attitude: n.attitude || '',
      status: n.status || 'Alive',
      notes: npcSecrets[n.id]?.notes || '',
    })
    setShowAdd(true)
  }

  const startEditFaction = (f) => {
    setEditId(f.id)
    setFactionDraft({
      name: f.name || '',
      type: f.type || '',
      leader: f.leader || '',
      territory: f.territory || '',
      goal: factionSecrets[f.id]?.goal || '',
      disposition: f.disposition || '',
      status_clock: f.status_clock || '',
      notes: factionSecrets[f.id]?.notes || '',
    })
    setShowAdd(true)
  }

  const startEditTreasure = (t) => {
    setEditId(t.id)
    setTreasureDraft({
      session_number: t.session_number != null ? String(t.session_number) : '',
      item: t.item || '',
      type: t.type || '',
      qty_value: t.qty_value || '',
      found_at: t.found_at || '',
      held_by: t.held_by || '',
      identified: t.identified === true ? 'yes' : t.identified === false ? 'no' : '',
      notes: treasureSecrets[t.id]?.notes || '',
    })
    setShowAdd(true)
  }

  // Upserts (or clears) a GM-only secrets row for an edited parent row.
  // Used only on the edit path -- add still does its original insert-only
  // secret write below, unchanged.
  const syncSecret = async (table, idColumn, id, fields, currentSecret, setSecrets) => {
    const hasContent = Object.values(fields).some((v) => (v || '').trim())
    if (hasContent) {
      const trimmed = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.trim() || null]))
      const { error } = await supabase.from(table).upsert({ [idColumn]: id, ...trimmed }, { onConflict: idColumn })
      if (!error) setSecrets((current) => ({ ...current, [id]: { [idColumn]: id, ...trimmed } }))
    } else if (currentSecret) {
      const { error } = await supabase.from(table).delete().eq(idColumn, id)
      if (!error) setSecrets((current) => { const next = { ...current }; delete next[id]; return next })
    }
  }

  const saveNpc = async () => {
    if (!npcDraft.name.trim() || !campaignId) return
    setSaving(true)
    const { notes, ...publicNpc } = npcDraft
    const trimmedName = npcDraft.name.trim()

    if (editId) {
      const { error } = await supabase.from('campaign_npcs').update({ ...publicNpc, name: trimmedName }).eq('id', editId)
      if (!error) await syncSecret('campaign_npc_secrets', 'npc_id', editId, { notes }, npcSecrets[editId], setNpcSecrets)
    } else {
      const { data: npc, error } = await supabase
        .from('campaign_npcs')
        .insert({ campaign_id: campaignId, ...publicNpc, name: trimmedName })
        .select('id')
        .single()
      if (!error && npc && notes.trim()) {
        const { error: secretError } = await supabase.from('campaign_npc_secrets').insert({ npc_id: npc.id, notes: notes.trim() })
        if (secretError) await supabase.from('campaign_npcs').delete().eq('id', npc.id)
        else setNpcSecrets((current) => ({ ...current, [npc.id]: { npc_id: npc.id, notes: notes.trim() } }))
      }
    }
    setSaving(false)
    cancelForm()
  }

  const saveFaction = async () => {
    if (!factionDraft.name.trim() || !campaignId) return
    setSaving(true)
    const { goal, notes, ...publicFaction } = factionDraft
    const trimmedName = factionDraft.name.trim()

    if (editId) {
      const { error } = await supabase.from('campaign_factions').update({ ...publicFaction, name: trimmedName }).eq('id', editId)
      if (!error) await syncSecret('campaign_faction_secrets', 'faction_id', editId, { goal, notes }, factionSecrets[editId], setFactionSecrets)
    } else {
      const { data: faction, error } = await supabase
        .from('campaign_factions')
        .insert({ campaign_id: campaignId, ...publicFaction, name: trimmedName })
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
    }
    setSaving(false)
    cancelForm()
  }

  const saveTreasure = async () => {
    if (!treasureDraft.item.trim() || !campaignId) return
    setSaving(true)
    const { notes, ...publicTreasure } = treasureDraft
    const trimmedItem = treasureDraft.item.trim()
    const parsedFields = {
      ...publicTreasure,
      item: trimmedItem,
      session_number: treasureDraft.session_number ? parseInt(treasureDraft.session_number, 10) : null,
      identified: treasureDraft.identified === '' ? null : treasureDraft.identified === 'yes',
    }

    if (editId) {
      const { error } = await supabase.from('campaign_treasure').update(parsedFields).eq('id', editId)
      if (!error) await syncSecret('campaign_treasure_secrets', 'treasure_id', editId, { notes }, treasureSecrets[editId], setTreasureSecrets)
    } else {
      const { data: item, error } = await supabase.from('campaign_treasure').insert({ campaign_id: campaignId, ...parsedFields }).select('id').single()
      if (!error && item && notes.trim()) {
        const { error: secretError } = await supabase.from('campaign_treasure_secrets').insert({ treasure_id: item.id, notes: notes.trim() })
        if (secretError) await supabase.from('campaign_treasure').delete().eq('id', item.id)
        else setTreasureSecrets((current) => ({ ...current, [item.id]: { treasure_id: item.id, notes: notes.trim() } }))
      }
    }
    setSaving(false)
    cancelForm()
  }

  const deleteRow = async (table, id) => {
    if (!window.confirm('Remove this entry?')) return
    await supabase.from(table).delete().eq('id', id)
  }

  const inputCls = 'text-xs bg-bg border border-line rounded-md px-3 py-2 text-ink'

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-xs text-ink-faint">Loading tracker…</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      {onBack && (
        <button onClick={onBack} className="text-xs text-ink-dim hover:text-ink flex items-center gap-1 mb-3">
          <ArrowLeft size={13} /> Back
        </button>
      )}

      <h1 className="text-ink text-lg font-medium mb-1">{campaignName}</h1>
      <p className="text-xs text-ink-dim mb-4">NPCs, factions, and treasure the party has encountered</p>

      <Tabs tabs={TABS} activeKey={tab} onChange={switchTab} />

      {isGm && (
        <div className="mb-3">
          <button
            onClick={toggleAdd}
            className="text-xs border border-line rounded-md px-3 py-2 flex items-center gap-2 text-ink hover:bg-panel2"
          >
            <Plus size={13} /> Add {TABS.find((t) => t.key === tab)?.label.replace(/s$/, '')}
          </button>
        </div>
      )}

      {isGm && showAdd && tab === 'npcs' && (
        <Card className="mb-4" bodyClassName="grid grid-cols-2 gap-2">
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
          <div className="col-span-2 flex items-center gap-2">
            <button onClick={saveNpc} disabled={saving || !npcDraft.name.trim()} className="flex-1 text-xs border border-line rounded-md py-2 text-ink hover:bg-panel2 disabled:opacity-50">
              {saving ? 'Saving...' : editId ? 'Save changes' : 'Save NPC'}
            </button>
            {editId && (
              <button onClick={cancelForm} className="text-xs text-ink-dim hover:text-ink px-2 py-2">Cancel</button>
            )}
          </div>
        </Card>
      )}

      {isGm && showAdd && tab === 'factions' && (
        <Card className="mb-4" bodyClassName="grid grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Faction name" value={factionDraft.name} onChange={(e) => setFactionDraft({ ...factionDraft, name: e.target.value })} />
          <input className={inputCls} placeholder="Type" value={factionDraft.type} onChange={(e) => setFactionDraft({ ...factionDraft, type: e.target.value })} />
          <input className={inputCls} placeholder="Leader" value={factionDraft.leader} onChange={(e) => setFactionDraft({ ...factionDraft, leader: e.target.value })} />
          <input className={inputCls} placeholder="Base/territory" value={factionDraft.territory} onChange={(e) => setFactionDraft({ ...factionDraft, territory: e.target.value })} />
          <input className={inputCls} placeholder="Goal" value={factionDraft.goal} onChange={(e) => setFactionDraft({ ...factionDraft, goal: e.target.value })} />
          <input className={inputCls} placeholder="Disposition to party" value={factionDraft.disposition} onChange={(e) => setFactionDraft({ ...factionDraft, disposition: e.target.value })} />
          <input className={inputCls} placeholder="Current status / clock" value={factionDraft.status_clock} onChange={(e) => setFactionDraft({ ...factionDraft, status_clock: e.target.value })} />
          <input className={inputCls} placeholder="Notes" value={factionDraft.notes} onChange={(e) => setFactionDraft({ ...factionDraft, notes: e.target.value })} />
          <div className="col-span-2 flex items-center gap-2">
            <button onClick={saveFaction} disabled={saving || !factionDraft.name.trim()} className="flex-1 text-xs border border-line rounded-md py-2 text-ink hover:bg-panel2 disabled:opacity-50">
              {saving ? 'Saving...' : editId ? 'Save changes' : 'Save faction'}
            </button>
            {editId && (
              <button onClick={cancelForm} className="text-xs text-ink-dim hover:text-ink px-2 py-2">Cancel</button>
            )}
          </div>
        </Card>
      )}

      {isGm && showAdd && tab === 'treasure' && (
        <Card className="mb-4" bodyClassName="grid grid-cols-2 gap-2">
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
          <div className="col-span-2 flex items-center gap-2">
            <button onClick={saveTreasure} disabled={saving || !treasureDraft.item.trim()} className="flex-1 text-xs border border-line rounded-md py-2 text-ink hover:bg-panel2 disabled:opacity-50">
              {saving ? 'Saving...' : editId ? 'Save changes' : 'Save item'}
            </button>
            {editId && (
              <button onClick={cancelForm} className="text-xs text-ink-dim hover:text-ink px-2 py-2">Cancel</button>
            )}
          </div>
        </Card>
      )}

      {tab === 'npcs' && (
        <div className="flex flex-col gap-2">
          {npcs.length === 0 && <p className="text-xs text-ink-faint">No NPCs logged yet.</p>}
          {npcs.map((n) => (
            <Card key={n.id}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-ink font-medium">
                  {n.name}
                  {n.ancestry && <span className="text-ink-faint font-normal"> &middot; {n.ancestry}</span>}
                </p>
                <div className="flex items-center gap-2">
                  <Badge tone={NPC_STATUS_TONE[n.status] || 'neutral'}>{n.status}</Badge>
                  {isGm && (
                    <button onClick={() => startEditNpc(n)} className="text-ink-faint hover:text-ink p-1">
                      <Pencil size={12} />
                    </button>
                  )}
                  {isGm && (
                    <button onClick={() => deleteRow('campaign_npcs', n.id)} className="text-ink-faint hover:text-danger-text p-1">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-ink-dim">
                {[n.role, n.location, n.alignment].filter(Boolean).join(' · ')}
              </p>
              {n.attitude && <p className="text-xs text-ink-faint mt-1">Attitude: {n.attitude}</p>}
              {isGm && npcSecrets[n.id]?.notes && <p className="text-xs text-ink-faint mt-1">{npcSecrets[n.id].notes}</p>}
            </Card>
          ))}
        </div>
      )}

      {tab === 'factions' && (
        <div className="flex flex-col gap-2">
          {factions.length === 0 && <p className="text-xs text-ink-faint">No factions logged yet.</p>}
          {factions.map((f) => (
            <Card key={f.id}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-ink font-medium">
                  {f.name}
                  {f.type && <span className="text-ink-faint font-normal"> &middot; {f.type}</span>}
                </p>
                <div className="flex items-center gap-2">
                  {f.disposition && <Badge tone="neutral">{f.disposition}</Badge>}
                  {isGm && (
                    <button onClick={() => startEditFaction(f)} className="text-ink-faint hover:text-ink p-1">
                      <Pencil size={12} />
                    </button>
                  )}
                  {isGm && (
                    <button onClick={() => deleteRow('campaign_factions', f.id)} className="text-ink-faint hover:text-danger-text p-1">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-ink-dim">
                {[f.leader && `Led by ${f.leader}`, f.territory].filter(Boolean).join(' · ')}
              </p>
              {isGm && factionSecrets[f.id]?.goal && <p className="text-xs text-ink-faint mt-1">Goal: {factionSecrets[f.id].goal}</p>}
              {f.status_clock && <p className="text-xs text-ink-faint mt-1">Status: {f.status_clock}</p>}
              {isGm && factionSecrets[f.id]?.notes && <p className="text-xs text-ink-faint mt-1">{factionSecrets[f.id].notes}</p>}
            </Card>
          ))}
        </div>
      )}

      {tab === 'treasure' && (
        <div className="flex flex-col gap-2">
          {treasure.length === 0 && <p className="text-xs text-ink-faint">No treasure logged yet.</p>}
          {treasure.map((t) => (
            <Card key={t.id}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-ink font-medium">
                  {t.item}
                  {t.qty_value && <span className="text-ink-faint font-normal"> &middot; {t.qty_value}</span>}
                </p>
                <div className="flex items-center gap-2">
                  {t.session_number != null && <Badge tone="neutral">Session {t.session_number}</Badge>}
                  {t.identified === true && <Badge tone="green">Identified</Badge>}
                  {t.identified === false && <Badge tone="neutral">Unidentified</Badge>}
                  {isGm && (
                    <button onClick={() => startEditTreasure(t)} className="text-ink-faint hover:text-ink p-1">
                      <Pencil size={12} />
                    </button>
                  )}
                  {isGm && (
                    <button onClick={() => deleteRow('campaign_treasure', t.id)} className="text-ink-faint hover:text-danger-text p-1">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-ink-dim">
                {[t.type, t.found_at && `Found at ${t.found_at}`, t.held_by && `Held by ${t.held_by}`].filter(Boolean).join(' · ')}
              </p>
              {isGm && treasureSecrets[t.id]?.notes && <p className="text-xs text-ink-faint mt-1">{treasureSecrets[t.id].notes}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
