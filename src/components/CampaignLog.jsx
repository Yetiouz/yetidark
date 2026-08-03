import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, Trash2, Flame, Play, Pause, ClipboardCheck, History } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { appendUniqueById } from '../app/realtimeCollections.js'
import ProgressBar from './ui/ProgressBar.jsx'
import Modal from './ui/Modal.jsx'
import Button from './ui/Button.jsx'

const THREAD_STATUSES = ['open', 'resolved', 'abandoned']
const STATUS_COLOR = {
  open: 'bg-primary-bg text-primary-text',
  resolved: 'bg-positive-bg text-positive-text',
  abandoned: 'bg-panel2 text-ink-faint',
}

function formatMinutes(totalMin) {
  const clamped = Math.max(0, totalMin)
  const h = Math.floor(clamped / 60)
  const m = Math.floor(clamped % 60)
  const s = Math.floor((clamped * 60) % 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s}s`
}

// Live remaining time is remaining_minutes minus elapsed time since
// lit_at, but only while lit_at is set -- which only happens while the
// source is both lit AND the session is active (see toggleLit /
// toggleSession below). No server-side ticking needed: every client
// computes the same value from the same two persisted fields + wall clock.
function displayedMinutes(source, nowMs) {
  if (source.lit && source.lit_at) {
    const elapsed = (nowMs - new Date(source.lit_at).getTime()) / 60000
    return Math.max(0, source.remaining_minutes - elapsed)
  }
  return source.remaining_minutes
}

// Turns a campaign_events row into one human-readable line. Every mutating
// RPC in this app already writes a structured event here (event_type +
// entity_type/entity_id + payload) -- this is what finally surfaces that
// ledger as real history instead of leaving it write-only. Character
// attribution falls back through three tiers since payload shapes vary by
// RPC: a nested row's own character_id (gear/spell events), the event's
// own entity_id when entity_type is 'character' (resource/level/rest/
// carouse events), and finally the acting user's own character in this
// campaign (covers GM-attributed and any event with neither). An unmapped
// event_type falls back to its raw type string rather than being hidden --
// an honest "don't recognize this yet" beats silently dropping history.
function describeEvent(e, party) {
  const p = e.payload || {}
  const charName = (id) => party.find((c) => c.id === id)?.name
  const actorName = () => party.find((c) => c.owner_user_id === e.actor_user_id)?.name || 'The GM'
  const who = (id) => charName(id) || actorName()
  switch (e.event_type) {
    case 'campaign.clock_added':
      return `Clock "${p.clock?.name}" started (${p.clock?.segments_total} segments)`
    case 'campaign.clock_adjusted':
      return `Clock "${p.name}": ${p.before} → ${p.after}`
    case 'campaign.clock_removed':
      return `Clock "${p.clock?.name}" removed`
    case 'campaign.light_added':
      return `Light source "${p.light_source?.name}" added (${p.light_source?.total_minutes}m)`
    case 'campaign.light_removed':
      return `Light source "${p.light_source?.name}" removed`
    case 'campaign.light_changed':
      return `${p.name} ${p.lit ? 'lit' : `snuffed — ${Math.round(p.remaining_minutes)}m left`}`
    case 'campaign.session_activity_changed':
      return `Session ${p.after ? 'resumed' : 'paused'}`
    case 'campaign.session_ended':
      return `Session ${p.session_number} ended (${p.party_count} in the party)`
    case 'character.created':
      return `${p.character?.name} joined the party`
    case 'character.resource_adjusted': {
      const label = p.resource === 'hp' ? 'HP' : p.resource === 'xp' ? 'XP' : 'coin'
      const delta = p.applied_delta
      return `${who(e.entity_id)}: ${delta > 0 ? '+' : ''}${delta} ${label}${p.reason ? ` (${p.reason})` : ''}`
    }
    case 'character.leveled_up':
      return `${who(e.entity_id)} reached level ${p.new_level} (+${p.hp_gain} max HP)`
    case 'character.caroused':
      return `${who(e.entity_id)} caroused: ${p.outcome}`
    case 'character.full_rest_completed':
      return `${who(e.entity_id)} completed a full rest`
    case 'character.gear_added':
      return `${who(p.item?.character_id)} acquired ${p.item?.name}`
    case 'character.gear_removed':
      return `${who(p.item?.character_id)} removed ${p.item?.name}`
    case 'character.gear_equipped':
      return `${p.equipped ? 'Equipped' : 'Unequipped'} ${p.name}`
    case 'character.spell_added':
      return `${who(p.spell?.character_id)} learned ${p.spell?.name}`
    case 'character.spell_removed':
      return `${who(p.spell?.character_id)} forgot ${p.spell?.name}`
    case 'character.spell_prepared':
      return `${p.name} ${p.prepared ? 'prepared' : 'unprepared'}`
    case 'character.spell_check_recorded':
      return `${actorName()} cast ${p.name}: ${p.succeeded ? 'succeeded' : p.mishap ? 'mishap' : 'failed'}${p.locked ? ' (locked until rest)' : ''}`
    case 'treasure.xp_awarded':
      return `Awarded ${p.xp_each} XP each for ${p.item} (${p.quality}) to ${p.recipient_count} character${p.recipient_count === 1 ? '' : 's'}`
    default:
      return e.event_type
  }
}

function formatEventTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Three sections mirroring the file-based GM system's campaign-state.md /
// timeline.md: open plot threads, countdown/countup clocks, and a
// session-by-session recap log. GM can add/edit everything here directly
// (no draft-then-save step, unlike CampaignSettings) so there's no
// realtime-overwrite risk to guard against -- every write here is already
// the source of truth the instant it lands.
export default function CampaignLog({ campaignId, session, campaignName = 'The sunken keep', onBack }) {
  const user = session?.user
  const [isGm, setIsGm] = useState(false)
  const [threads, setThreads] = useState([])
  const [clocks, setClocks] = useState([])
  const [timeline, setTimeline] = useState([])
  const [currentSessionNumber, setCurrentSessionNumber] = useState(1)
  const [nextSessionPickup, setNextSessionPickup] = useState(null)
  const [showEndSession, setShowEndSession] = useState(false)
  const [recapDraft, setRecapDraft] = useState('')
  const [pickupDraft, setPickupDraft] = useState('')
  const [endingSession, setEndingSession] = useState(false)
  const [endSessionError, setEndSessionError] = useState(null)
  const [loading, setLoading] = useState(true)

  const [threadDraft, setThreadDraft] = useState('')
  const [clockDraft, setClockDraft] = useState('')
  const [entryDraft, setEntryDraft] = useState('')

  const [sessionActive, setSessionActive] = useState(false)
  const [lightSources, setLightSources] = useState([])
  const [party, setParty] = useState([])
  const [events, setEvents] = useState([])
  const [lightNameDraft, setLightNameDraft] = useState('')
  const [lightCharacterDraft, setLightCharacterDraft] = useState('')
  const [nowTick, setNowTick] = useState(() => Date.now())

  // Only needs to run while something might be burning, but a cheap
  // 1s interval the whole time this screen is open is simplest and
  // matches the always-on animation timers already used elsewhere (the
  // dice roll spinner in GameTable).
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false

    Promise.all([
      supabase.from('campaign_threads').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: true }),
      supabase.from('campaign_clocks').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: true }),
      supabase.from('campaign_timeline_entries').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: false }),
      supabase.from('campaigns').select('session_number, session_active, next_session_pickup').eq('id', campaignId).maybeSingle(),
      supabase.from('campaign_light_sources').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: true }),
      supabase.from('characters').select('id, name, owner_user_id').eq('campaign_id', campaignId).order('created_at', { ascending: true }),
      supabase.from('campaign_events').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(50),
    ]).then(([threadsRes, clocksRes, timelineRes, campaignRes, lightRes, partyRes, eventsRes]) => {
      if (cancelled) return
      setThreads(threadsRes.data || [])
      setClocks(clocksRes.data || [])
      setTimeline(timelineRes.data || [])
      setCurrentSessionNumber(campaignRes.data?.session_number || 1)
      setSessionActive(campaignRes.data?.session_active || false)
      setNextSessionPickup(campaignRes.data?.next_session_pickup || null)
      setLightSources(lightRes.data || [])
      setParty(partyRes.data || [])
      setEvents(eventsRes.data || [])
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
      .channel(`campaign-log-${campaignId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'campaign_threads', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setThreads((t) => [...t, payload.new])
          else if (payload.eventType === 'UPDATE') setThreads((t) => t.map((x) => (x.id === payload.new.id ? payload.new : x)))
          else if (payload.eventType === 'DELETE') setThreads((t) => t.filter((x) => x.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'campaign_clocks', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setClocks((c) => appendUniqueById(c, payload.new))
          else if (payload.eventType === 'UPDATE') setClocks((c) => c.map((x) => (x.id === payload.new.id ? payload.new : x)))
          else if (payload.eventType === 'DELETE') setClocks((c) => c.filter((x) => x.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'campaign_timeline_entries', filter: `campaign_id=eq.${campaignId}` },
        (payload) => setTimeline((t) => [payload.new, ...t])
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'campaign_light_sources', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setLightSources((l) => appendUniqueById(l, payload.new))
          else if (payload.eventType === 'UPDATE') setLightSources((l) => l.map((x) => (x.id === payload.new.id ? payload.new : x)))
          else if (payload.eventType === 'DELETE') setLightSources((l) => l.filter((x) => x.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${campaignId}` },
        (payload) => {
          setSessionActive(payload.new.session_active)
          setCurrentSessionNumber(payload.new.session_number)
          setNextSessionPickup(payload.new.next_session_pickup || null)
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'campaign_events', filter: `campaign_id=eq.${campaignId}` },
        (payload) => setEvents((e) => [payload.new, ...e].slice(0, 50))
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [campaignId, user])

  const addThread = async () => {
    const title = threadDraft.trim()
    if (!title || !campaignId) return
    await supabase.from('campaign_threads').insert({ campaign_id: campaignId, title })
    setThreadDraft('')
  }

  const setThreadStatus = async (thread, status) => {
    setThreads((t) => t.map((x) => (x.id === thread.id ? { ...x, status } : x)))
    await supabase.from('campaign_threads').update({ status }).eq('id', thread.id)
  }

  const addClock = async () => {
    const name = clockDraft.trim()
    if (!name || !campaignId) return
    const totalInput = window.prompt('How many segments?', '4')
    if (totalInput === null) return
    const segments_total = Math.max(1, parseInt(totalInput, 10) || 4)
    const { data, error } = await supabase.rpc('add_campaign_clock', {
      p_campaign_id: campaignId,
      p_name: name,
      p_segments_total: segments_total,
    })
    if (!error) {
      setClocks((all) => all.some((clock) => clock.id === data.id) ? all : [...all, data])
      setClockDraft('')
    }
  }

  const adjustClock = async (clock, delta) => {
    const { data, error } = await supabase.rpc('adjust_campaign_clock', {
      p_clock_id: clock.id,
      p_delta: delta,
    })
    if (!error) setClocks((all) => all.map((item) => (item.id === clock.id ? data : item)))
  }

  const removeClock = async (clock) => {
    const { error } = await supabase.rpc('remove_campaign_clock', { p_clock_id: clock.id })
    if (!error) setClocks((all) => all.filter((item) => item.id !== clock.id))
  }

  const addEntry = async () => {
    const entry = entryDraft.trim()
    if (!entry || !campaignId) return
    await supabase.from('campaign_timeline_entries').insert({
      campaign_id: campaignId,
      session_number: currentSessionNumber,
      entry,
    })
    setEntryDraft('')
  }

  const addLightSource = async () => {
    const name = lightNameDraft.trim()
    if (!name || !campaignId) return
    const minutesInput = window.prompt('Burn time in minutes?', '60')
    if (minutesInput === null) return
    const total_minutes = Math.max(1, parseInt(minutesInput, 10) || 60)
    const { data, error } = await supabase.rpc('add_campaign_light_source', {
      p_campaign_id: campaignId,
      p_character_id: lightCharacterDraft || null,
      p_name: name,
      p_total_minutes: total_minutes,
    })
    if (!error) {
      setLightSources((all) => all.some((source) => source.id === data.id) ? all : [...all, data])
      setLightNameDraft('')
      setLightCharacterDraft('')
    }
  }

  // Lighting only starts the burn clock (lit_at) if the session is
  // currently active -- lighting during a paused session just marks it
  // lit without burning, and toggleSession's resume path will start the
  // clock once play picks back up. Snuffing always freezes remaining time.
  const toggleLit = async (source) => {
    const { data, error } = await supabase.rpc('set_campaign_light_lit', {
      p_source_id: source.id,
      p_lit: !source.lit,
    })
    if (!error) setLightSources((all) => all.map((item) => (item.id === source.id ? data : item)))
  }

  const removeLightSource = async (source) => {
    const { error } = await supabase.rpc('remove_campaign_light_source', { p_source_id: source.id })
    if (!error) setLightSources((all) => all.filter((item) => item.id !== source.id))
  }

  // Pausing freezes every currently-burning source's remaining time and
  // clears lit_at (still lit, just not burning). Resuming restarts the
  // burn clock for anything that's lit but was frozen -- this is what
  // makes tracking active-play-time-only instead of real wall-clock time.
  const toggleSession = async () => {
    const nextActive = !sessionActive
    const { error } = await supabase.rpc('set_campaign_session_active', {
      p_campaign_id: campaignId,
      p_active: nextActive,
    })
    if (error) return
    const { data } = await supabase
      .from('campaign_light_sources')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
    setLightSources(data || [])
    setSessionActive(nextActive)
  }

  const openEndSession = () => {
    setRecapDraft('')
    setPickupDraft('')
    setEndSessionError(null)
    setShowEndSession(true)
  }

  const confirmEndSession = async () => {
    if (!recapDraft.trim()) {
      setEndSessionError('A session recap is required to end the session.')
      return
    }
    setEndingSession(true)
    setEndSessionError(null)
    const { data, error } = await supabase.rpc('end_campaign_session', {
      p_campaign_id: campaignId,
      p_recap: recapDraft,
      p_next_session_pickup: pickupDraft || null,
    })
    setEndingSession(false)
    if (error) {
      setEndSessionError(error.message)
      return
    }
    setCurrentSessionNumber(data.new_session_number)
    setSessionActive(false)
    setNextSessionPickup(data.next_session_pickup || null)
    setShowEndSession(false)
  }

  if (loading) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <p className="text-xs text-ink-faint">Loading campaign log…</p>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      {onBack && (
        <button onClick={onBack} className="text-xs text-ink-dim hover:text-ink flex items-center gap-1 mb-3">
          <ArrowLeft size={13} /> Back
        </button>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-ink text-lg font-medium mb-1">{campaignName}</h1>
          <p className="text-xs text-ink-dim">Campaign log</p>
        </div>
        {isGm && (
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSession}
              className={`text-xs rounded-md px-3 py-2 flex items-center gap-2 border ${
                sessionActive
                  ? 'border-positive text-positive-text bg-positive-bg hover:bg-positive-bg'
                  : 'border-line text-ink-dim hover:bg-panel2'
              }`}
            >
              {sessionActive ? <Pause size={13} /> : <Play size={13} />}
              {sessionActive ? 'Session active' : 'Session paused'}
            </button>
            <button
              onClick={openEndSession}
              className="text-xs rounded-md px-3 py-2 flex items-center gap-2 border border-line text-ink-dim hover:bg-panel2"
            >
              <ClipboardCheck size={13} />
              End session
            </button>
          </div>
        )}
        {!isGm && (
          <span className={`text-[11px] px-2 py-1 rounded ${sessionActive ? 'bg-positive-bg text-positive-text' : 'bg-panel2 text-ink-faint'}`}>
            {sessionActive ? 'Session active' : 'Session paused'}
          </span>
        )}
      </div>

      {nextSessionPickup && (
        <div className="bg-panel rounded-lg p-3 mb-4 border border-line">
          <p className="text-[10px] uppercase tracking-wide text-ink-faint mb-1">Next session</p>
          <p className="text-xs text-ink-dim whitespace-pre-wrap">{nextSessionPickup}</p>
        </div>
      )}

      <div className="bg-panel rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-ink-dim">Threads</p>
          {isGm && (
            <div className="flex gap-2">
              <input
                value={threadDraft}
                onChange={(e) => setThreadDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addThread()}
                placeholder="New thread"
                className="text-xs bg-bg border border-line rounded-md px-2 py-1 w-32 text-ink"
              />
              <button onClick={addThread} className="text-xs border border-line rounded-md px-2 py-1 flex items-center gap-1 text-ink hover:bg-panel2">
                <Plus size={13} /> Add
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {threads.length === 0 && <p className="text-xs text-ink-faint">No open threads yet.</p>}
          {threads.map((thread) => (
            <div key={thread.id} className="text-xs p-2 bg-panel2/60 rounded-md border border-line">
              <div className="flex items-center justify-between mb-1">
                <span className="text-ink font-medium">{thread.title}</span>
                {isGm ? (
                  <select
                    value={thread.status}
                    onChange={(e) => setThreadStatus(thread, e.target.value)}
                    className={`text-[10px] rounded px-2 py-1 border-0 ${STATUS_COLOR[thread.status]}`}
                  >
                    {THREAD_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`text-[10px] px-2 py-1 rounded ${STATUS_COLOR[thread.status]}`}>{thread.status}</span>
                )}
              </div>
              {thread.description && <p className="text-ink-dim">{thread.description}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-panel rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-ink-dim">Clocks</p>
          {isGm && (
            <div className="flex gap-2">
              <input
                value={clockDraft}
                onChange={(e) => setClockDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addClock()}
                placeholder="New clock"
                className="text-xs bg-bg border border-line rounded-md px-2 py-1 w-32 text-ink"
              />
              <button onClick={addClock} className="text-xs border border-line rounded-md px-2 py-1 flex items-center gap-1 text-ink hover:bg-panel2">
                <Plus size={13} /> Add
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {clocks.length === 0 && <p className="text-xs text-ink-faint">No clocks running.</p>}
          {clocks.map((clock) => (
            <div key={clock.id} className="text-xs p-2 bg-panel2/60 rounded-md border border-line">
              <div className="flex items-center justify-between mb-2">
                <span className="text-ink font-medium">{clock.name}</span>
                <span className="text-ink-faint">{clock.segments_filled} / {clock.segments_total}</span>
              </div>
              <div className="flex items-center gap-2">
                <ProgressBar
                  mode="segmented"
                  segments={clock.segments_total}
                  filled={clock.segments_filled}
                  tone="amber"
                  heightClassName="h-2"
                  className="flex-1"
                />
                {isGm && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => adjustClock(clock, -1)} className="px-2 border border-line rounded text-ink-dim">-</button>
                    <button onClick={() => adjustClock(clock, 1)} className="px-2 border border-line rounded text-ink-dim">+</button>
                    <button onClick={() => removeClock(clock)} className="text-ink-faint hover:text-danger-text">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-panel rounded-lg p-4">
        <p className="text-xs text-ink-dim mb-2">Timeline</p>
        {isGm && (
          <div className="flex gap-2 mb-3">
            <input
              type="number"
              value={currentSessionNumber}
              onChange={(e) => setCurrentSessionNumber(parseInt(e.target.value, 10) || 1)}
              className="w-14 text-xs bg-bg border border-line rounded-md px-2 py-1 text-ink"
            />
            <input
              value={entryDraft}
              onChange={(e) => setEntryDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addEntry()}
              placeholder="What happened this session?"
              className="flex-1 text-xs bg-bg border border-line rounded-md px-2 py-1 text-ink"
            />
            <button onClick={addEntry} className="text-xs border border-line rounded-md px-2 py-1 flex items-center gap-1 text-ink hover:bg-panel2">
              <Plus size={13} /> Add
            </button>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {timeline.length === 0 && <p className="text-xs text-ink-faint">No sessions logged yet.</p>}
          {timeline.map((e) => (
            <div key={e.id} className="text-xs p-2 bg-panel2/60 rounded-md">
              <span className="text-ink-faint">Session {e.session_number ?? '?'}:</span>{' '}
              <span className="text-ink-dim">{e.entry}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-panel rounded-lg p-4 mt-4">
        <div className="flex items-center gap-2 mb-3">
          <History size={13} className="text-ink-faint" />
          <p className="text-xs text-ink-dim">Campaign history</p>
        </div>
        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          {events.length === 0 && <p className="text-xs text-ink-faint">Nothing logged yet.</p>}
          {events.map((e) => (
            <div key={e.id} className="text-xs flex items-baseline gap-2">
              <span className="text-ink-faint shrink-0">{formatEventTime(e.created_at)}</span>
              <span className="text-ink-dim">{describeEvent(e, party)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-panel rounded-lg p-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-ink-dim">Light sources</p>
          {isGm && (
            <div className="flex gap-2">
              <input
                value={lightNameDraft}
                onChange={(e) => setLightNameDraft(e.target.value)}
                placeholder="Torch, lantern..."
                className="text-xs bg-bg border border-line rounded-md px-2 py-1 w-24 text-ink"
              />
              <select
                value={lightCharacterDraft}
                onChange={(e) => setLightCharacterDraft(e.target.value)}
                className="text-xs bg-bg border border-line rounded-md px-2 py-1 text-ink"
              >
                <option value="">Party (unassigned)</option>
                {party.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button onClick={addLightSource} className="text-xs border border-line rounded-md px-2 py-1 flex items-center gap-1 text-ink hover:bg-panel2">
                <Plus size={13} /> Add
              </button>
            </div>
          )}
        </div>
        {!sessionActive && (
          <p className="text-[11px] text-ink-faint mb-3">
            Session is paused -- lit sources won't burn down until it's resumed.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {lightSources.length === 0 && <p className="text-xs text-ink-faint">No light sources tracked yet.</p>}
          {lightSources.map((source) => {
            const owner = party.find((c) => c.id === source.character_id)
            const canWrite = isGm || (owner && owner.owner_user_id === user?.id)
            const remaining = displayedMinutes(source, nowTick)
            const burning = source.lit && source.lit_at
            return (
              <div key={source.id} className="flex items-center justify-between text-xs p-2 bg-panel2/60 rounded-md border border-line">
                <div className="flex items-center gap-2">
                  <Flame size={14} className={burning ? 'text-warning-text' : source.lit ? 'text-warning-text' : 'text-ink-faint'} />
                  <div>
                    <span className="text-ink font-medium">{source.name}</span>
                    <span className="text-ink-faint"> {owner ? `· ${owner.name}` : '· party'}</span>
                    <p className="text-ink-faint">{formatMinutes(remaining)} / {source.total_minutes}m remaining</p>
                  </div>
                </div>
                {canWrite && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => toggleLit(source)}
                      className={`text-[11px] px-2 py-1 rounded border ${
                        source.lit ? 'border-warning text-warning-text' : 'border-line text-ink-dim'
                      }`}
                    >
                      {source.lit ? 'Snuff' : 'Light'}
                    </button>
                    {isGm && (
                      <button onClick={() => removeLightSource(source)} className="text-ink-faint hover:text-danger-text">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <Modal open={showEndSession} onClose={() => !endingSession && setShowEndSession(false)} title="End session">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-ink-dim mb-1 block">Recap (required)</label>
            <textarea
              value={recapDraft}
              onChange={(e) => setRecapDraft(e.target.value)}
              placeholder="What happened this session?"
              rows={4}
              className="w-full text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
            />
          </div>
          <div>
            <label className="text-xs text-ink-dim mb-1 block">Next time (optional)</label>
            <textarea
              value={pickupDraft}
              onChange={(e) => setPickupDraft(e.target.value)}
              placeholder="Where should the table pick up next session?"
              rows={2}
              className="w-full text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
            />
          </div>
          {endSessionError && <p className="text-xs text-danger-text">{endSessionError}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setShowEndSession(false)}
              disabled={endingSession}
              className="text-xs rounded-md px-3 py-2 border border-line text-ink-dim hover:bg-panel2"
            >
              Cancel
            </button>
            <Button
              variant="primary"
              onClick={confirmEndSession}
              disabled={endingSession || !recapDraft.trim()}
            >
              {endingSession ? 'Ending…' : 'Finalize'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
