import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, Pencil, Trash2, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { appendUniqueById } from '../app/realtimeCollections.js'
import Tabs from './ui/Tabs.jsx'
import Badge from './ui/Badge.jsx'
import Modal from './ui/Modal.jsx'
import ConfirmModal from './ui/ConfirmModal.jsx'
import Button from './ui/Button.jsx'

// Design-handoff-spec Section 4.9: "player-facing accumulated knowledge log
// (what the party has learned, not GM secrets)". People/Factions/Sessions
// below are read-only views over data that already has a real owning
// screen (CampaignTracker.jsx for NPCs/factions, CampaignLog.jsx for the
// session timeline and the campaign_events history feed) -- this screen
// doesn't duplicate their CRUD, it's the party's single reading view over
// all of it plus the three genuinely new content types (Quests/Clues/
// Notes) that had no home anywhere before journal_entries.
//
// Places (Section 4.9's own tab) has no dedicated schema -- flagged as an
// open call in delve-phase5-scope.md rather than invented. Deliberately
// built here as a derived view over campaign_npcs.location (the cheap
// option that doc names) rather than a new table: every location with at
// least one NPC placed there becomes a Place, grouping those NPCs. This
// under-covers locations nobody's attached an NPC to yet -- an honest
// limitation, not a hidden one -- rather than faking place data that
// doesn't exist.
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'people', label: 'People' },
  { key: 'factions', label: 'Factions' },
  { key: 'places', label: 'Places' },
  { key: 'quests', label: 'Quests' },
  { key: 'clues', label: 'Clues' },
  { key: 'notes', label: 'Notes' },
]

const ENTRY_LABEL = { quest: 'quest', clue: 'clue', note: 'note' }

function emptyDraft(entryType) {
  return { entry_type: entryType, title: '', body: '', status: 'fact', revealed: false }
}


// Hoisted to module scope (react-hooks/static-components): components defined
// inside the parent's render are recreated every render and reset their state.
const EntryRow = ({ entry, isGm, onEdit, onDelete }) => (
  <div className="text-xs border border-line rounded-md p-3 flex flex-col gap-1">
    <div className="flex items-center justify-between gap-2">
      <p className="text-ink font-medium">{entry.title}</p>
      <div className="flex items-center gap-1.5 shrink-0">
        {entry.entry_type === 'clue' && (
          <Badge tone={entry.status === 'fact' ? 'green' : 'purple'}>
            {entry.status === 'fact' ? 'Fact' : 'Suspicion'}
          </Badge>
        )}
        <Badge tone={entry.revealed ? 'green' : 'neutral'}>{entry.revealed ? 'Revealed' : 'Hidden'}</Badge>
        {isGm && (
          <>
            <button onClick={() => onEdit(entry)} className="text-ink-faint hover:text-ink p-1">
              <Pencil size={12} />
            </button>
            <button onClick={() => onDelete(entry)} className="text-ink-faint hover:text-danger-text p-1">
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
    {entry.body && <p className="text-ink-dim whitespace-pre-wrap">{entry.body}</p>}
  </div>
)

const EntryTab = ({ entryType, list, emptyLabel, isGm, onAdd, onEdit, onDelete }) => (
  <div className="flex flex-col gap-2">
    {isGm && (
      <button
        onClick={() => onAdd(entryType)}
        className="self-start text-xs border border-line rounded-md px-3 py-2 flex items-center gap-2 text-ink hover:bg-panel2"
      >
        <Plus size={13} /> Add {ENTRY_LABEL[entryType]}
      </button>
    )}
    {list.length === 0 && <p className="text-xs text-ink-faint">{emptyLabel}</p>}
    {list.map((entry) => (
      <EntryRow key={entry.id} entry={entry} isGm={isGm} onEdit={onEdit} onDelete={onDelete} />
    ))}
  </div>
)

export default function CampaignJournal({ campaignId, session, campaignName = 'The sunken keep', onBack }) {
  const user = session?.user
  const [isGm, setIsGm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  const [npcs, setNpcs] = useState([])
  const [factions, setFactions] = useState([])
  const [timeline, setTimeline] = useState([])
  const [threads, setThreads] = useState([])
  const [entries, setEntries] = useState([])

  const [showEntryModal, setShowEntryModal] = useState(false)
  const [editingEntryId, setEditingEntryId] = useState(null)
  const [entryDraft, setEntryDraft] = useState(emptyDraft('note'))
  const [savingEntry, setSavingEntry] = useState(false)
  const [entryError, setEntryError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false

    Promise.all([
      supabase.from('campaign_npcs').select('id, name, ancestry, role, location, attitude, status').eq('campaign_id', campaignId).order('created_at', { ascending: true }),
      supabase.from('campaign_factions').select('id, name, type, leader, territory, disposition').eq('campaign_id', campaignId).order('created_at', { ascending: true }),
      supabase.from('campaign_timeline_entries').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: false }),
      supabase.from('campaign_threads').select('id, title, status').eq('campaign_id', campaignId).order('created_at', { ascending: true }),
      supabase.from('journal_entries').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: false }),
    ]).then(([npcsRes, factionsRes, timelineRes, threadsRes, entriesRes]) => {
      if (cancelled) return
      setNpcs(npcsRes.data || [])
      setFactions(factionsRes.data || [])
      setTimeline(timelineRes.data || [])
      setThreads(threadsRes.data || [])
      setEntries(entriesRes.data || [])
      setLoading(false)
    })

    if (user) {
      supabase
        .from('campaign_members')
        .select('role')
        .eq('campaign_id', campaignId)
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => { if (!cancelled) setIsGm(data?.role === 'gm') })
    }

    const channel = supabase
      .channel(`campaign-journal-${campaignId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'campaign_npcs', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setNpcs((n) => appendUniqueById(n, payload.new))
          else if (payload.eventType === 'UPDATE') setNpcs((n) => n.map((x) => (x.id === payload.new.id ? payload.new : x)))
          else if (payload.eventType === 'DELETE') setNpcs((n) => n.filter((x) => x.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'campaign_factions', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setFactions((f) => appendUniqueById(f, payload.new))
          else if (payload.eventType === 'UPDATE') setFactions((f) => f.map((x) => (x.id === payload.new.id ? payload.new : x)))
          else if (payload.eventType === 'DELETE') setFactions((f) => f.filter((x) => x.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'campaign_timeline_entries', filter: `campaign_id=eq.${campaignId}` },
        (payload) => setTimeline((t) => [payload.new, ...t])
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'campaign_threads', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setThreads((t) => appendUniqueById(t, payload.new))
          else if (payload.eventType === 'UPDATE') setThreads((t) => t.map((x) => (x.id === payload.new.id ? payload.new : x)))
          else if (payload.eventType === 'DELETE') setThreads((t) => t.filter((x) => x.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'journal_entries', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          // A player's own realtime feed only ever receives INSERT/UPDATE
          // rows the RLS policy already allows through (revealed = true or
          // GM) -- a row transitioning to hidden arrives as a DELETE-shaped
          // absence, not an UPDATE, so no separate "was revealed, now
          // isn't" case to handle here.
          if (payload.eventType === 'INSERT') setEntries((e) => appendUniqueById(e, payload.new))
          else if (payload.eventType === 'UPDATE') setEntries((e) => e.map((x) => (x.id === payload.new.id ? payload.new : x)))
          else if (payload.eventType === 'DELETE') setEntries((e) => e.filter((x) => x.id !== payload.old.id))
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [campaignId, user])

  const openAddEntry = (entryType) => {
    setEditingEntryId(null)
    setEntryDraft(emptyDraft(entryType))
    setEntryError(null)
    setShowEntryModal(true)
  }

  const openEditEntry = (entry) => {
    setEditingEntryId(entry.id)
    setEntryDraft({
      entry_type: entry.entry_type,
      title: entry.title,
      body: entry.body || '',
      status: entry.status || 'fact',
      revealed: entry.revealed,
    })
    setEntryError(null)
    setShowEntryModal(true)
  }

  const saveEntry = async () => {
    const title = entryDraft.title.trim()
    if (!title) {
      setEntryError('A title is required.')
      return
    }
    setSavingEntry(true)
    setEntryError(null)
    const payload = {
      entry_type: entryDraft.entry_type,
      title,
      body: entryDraft.body.trim(),
      status: entryDraft.entry_type === 'clue' ? entryDraft.status : null,
      revealed: entryDraft.revealed,
    }
    const { error } = editingEntryId
      ? await supabase.from('journal_entries').update(payload).eq('id', editingEntryId)
      : await supabase.from('journal_entries').insert({ campaign_id: campaignId, ...payload })
    setSavingEntry(false)
    if (error) {
      setEntryError(error.message)
      return
    }
    setShowEntryModal(false)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    await supabase.from('journal_entries').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-xs text-ink-faint">Loading campaign journal…</p>
      </div>
    )
  }

  const questEntries = entries.filter((e) => e.entry_type === 'quest')
  const clueEntries = entries.filter((e) => e.entry_type === 'clue')
  const noteEntries = entries.filter((e) => e.entry_type === 'note')
  const openThreads = threads.filter((t) => t.status === 'open')
  const recentlyDiscovered = entries.filter((e) => e.revealed).slice(0, 5)

  const placesMap = new Map()
  npcs.forEach((n) => {
    const loc = (n.location || '').trim()
    if (!loc) return
    if (!placesMap.has(loc)) placesMap.set(loc, [])
    placesMap.get(loc).push(n)
  })
  const places = Array.from(placesMap.entries()).sort(([a], [b]) => a.localeCompare(b))

    return (
    <div className="max-w-2xl mx-auto p-6">
      {onBack && (
        <button onClick={onBack} className="text-xs text-ink-dim hover:text-ink flex items-center gap-1 mb-3">
          <ArrowLeft size={13} /> Back
        </button>
      )}

      <h1 className="text-ink text-lg font-medium mb-1">{campaignName}</h1>
      <p className="text-xs text-ink-dim mb-4">
        Campaign journal &middot; what the party has learned{isGm ? ' &middot; GM: entries stay hidden until revealed' : ''}
      </p>

      <Tabs tabs={TABS} activeKey={activeTab} onChange={setActiveTab} />

      {activeTab === 'overview' && (
        <div className="flex flex-col gap-4">
          <div className="bg-panel rounded-lg p-4">
            <p className="text-xs text-ink-dim mb-2">Latest session</p>
            {timeline[0] ? (
              <p className="text-xs text-ink-dim">
                <span className="text-ink-faint">Session {timeline[0].session_number ?? '?'}:</span> {timeline[0].entry}
              </p>
            ) : (
              <p className="text-xs text-ink-faint">No sessions logged yet.</p>
            )}
          </div>
          <div className="bg-panel rounded-lg p-4">
            <p className="text-xs text-ink-dim mb-2">Open threads ({openThreads.length})</p>
            {openThreads.length === 0 && <p className="text-xs text-ink-faint">Nothing open right now.</p>}
            {openThreads.map((t) => (
              <p key={t.id} className="text-xs text-ink-dim">&bull; {t.title}</p>
            ))}
          </div>
          <div className="bg-panel rounded-lg p-4">
            <p className="text-xs text-ink-dim mb-2">Recently discovered</p>
            {recentlyDiscovered.length === 0 && <p className="text-xs text-ink-faint">Nothing revealed yet.</p>}
            <div className="flex flex-col gap-2">
              {recentlyDiscovered.map((entry) => <EntryRow key={entry.id} entry={entry} isGm={isGm} onEdit={openEditEntry} onDelete={setDeleteTarget} />)}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sessions' && (
        <div className="flex flex-col gap-2">
          {timeline.length === 0 && <p className="text-xs text-ink-faint">No sessions logged yet.</p>}
          {timeline.map((e) => (
            <div key={e.id} className="text-xs p-2 bg-panel2/60 rounded-md">
              <span className="text-ink-faint">Session {e.session_number ?? '?'}:</span>{' '}
              <span className="text-ink-dim">{e.entry}</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'people' && (
        <div className="flex flex-col gap-2">
          {npcs.length === 0 && <p className="text-xs text-ink-faint">No NPCs recorded yet.</p>}
          {npcs.map((n) => (
            <div key={n.id} className="text-xs border border-line rounded-md p-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-ink font-medium">{n.name}</p>
                <p className="text-ink-faint">
                  {[n.ancestry, n.role].filter(Boolean).join(' &middot; ')}
                  {n.location ? ` &middot; ${n.location}` : ''}
                </p>
              </div>
              {n.attitude && <Badge tone="neutral">{n.attitude}</Badge>}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'factions' && (
        <div className="flex flex-col gap-2">
          {factions.length === 0 && <p className="text-xs text-ink-faint">No factions recorded yet.</p>}
          {factions.map((f) => (
            <div key={f.id} className="text-xs border border-line rounded-md p-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-ink font-medium">{f.name}</p>
                <p className="text-ink-faint">
                  {[f.type, f.leader && `led by ${f.leader}`, f.territory].filter(Boolean).join(' &middot; ')}
                </p>
              </div>
              {f.disposition && <Badge tone="neutral">{f.disposition}</Badge>}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'places' && (
        <div className="flex flex-col gap-2">
          {places.length === 0 && (
            <p className="text-xs text-ink-faint">
              No places yet &mdash; a Place appears here once an NPC's location is filled in on the People &amp; Factions screen.
            </p>
          )}
          {places.map(([location, people]) => (
            <div key={location} className="text-xs border border-line rounded-md p-3">
              <div className="flex items-center gap-2 mb-1">
                <MapPin size={12} className="text-ink-faint" />
                <p className="text-ink font-medium">{location}</p>
              </div>
              <p className="text-ink-faint">{people.map((p) => p.name).join(', ')}</p>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'quests' && (
        <EntryTab entryType="quest" list={questEntries} emptyLabel="No quests logged yet." isGm={isGm} onAdd={openAddEntry} onEdit={openEditEntry} onDelete={setDeleteTarget} />
      )}
      {activeTab === 'clues' && (
        <EntryTab entryType="clue" list={clueEntries} emptyLabel="No clues logged yet." isGm={isGm} onAdd={openAddEntry} onEdit={openEditEntry} onDelete={setDeleteTarget} />
      )}
      {activeTab === 'notes' && (
        <EntryTab entryType="note" list={noteEntries} emptyLabel="No notes logged yet." isGm={isGm} onAdd={openAddEntry} onEdit={openEditEntry} onDelete={setDeleteTarget} />
      )}

      <Modal
        open={showEntryModal}
        onClose={() => !savingEntry && setShowEntryModal(false)}
        title={`${editingEntryId ? 'Edit' : 'Add'} ${ENTRY_LABEL[entryDraft.entry_type]}`}
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs text-ink-dim mb-1 block">Title</label>
            <input
              value={entryDraft.title}
              onChange={(e) => setEntryDraft((d) => ({ ...d, title: e.target.value }))}
              className="w-full text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
            />
          </div>
          <div>
            <label className="text-xs text-ink-dim mb-1 block">Details</label>
            <textarea
              value={entryDraft.body}
              onChange={(e) => setEntryDraft((d) => ({ ...d, body: e.target.value }))}
              rows={4}
              className="w-full text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
            />
          </div>
          {entryDraft.entry_type === 'clue' && (
            <div>
              <label className="text-xs text-ink-dim mb-1 block">Status</label>
              <div className="flex gap-2">
                {['fact', 'suspicion'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setEntryDraft((d) => ({ ...d, status: s }))}
                    className={`text-xs rounded-md px-3 py-2 border ${
                      entryDraft.status === s ? 'border-primary text-primary-text bg-primary-bg' : 'border-line text-ink-dim'
                    }`}
                  >
                    {s === 'fact' ? 'Confirmed fact' : 'Suspicion'}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <button
              onClick={() => setEntryDraft((d) => ({ ...d, revealed: !d.revealed }))}
              className={`text-xs rounded-md px-3 py-2 border ${
                entryDraft.revealed ? 'border-positive text-positive-text bg-positive-bg' : 'border-line text-ink-dim'
              }`}
            >
              {entryDraft.revealed ? 'Revealed to party' : 'Hidden (GM only)'}
            </button>
          </div>
          {entryError && <p className="text-xs text-danger-text">{entryError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setShowEntryModal(false)}
              disabled={savingEntry}
              className="text-xs rounded-md px-3 py-2 border border-line text-ink-dim hover:bg-panel2"
            >
              Cancel
            </button>
            <Button variant="primary" onClick={saveEntry} disabled={savingEntry}>
              {savingEntry ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete entry?"
        message={deleteTarget ? `Remove "${deleteTarget.title}" from the journal? This can't be undone.` : ''}
        confirmLabel="Delete"
        confirming={deleting}
      />
    </div>
  )
}
