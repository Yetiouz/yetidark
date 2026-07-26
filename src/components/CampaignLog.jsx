import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

const THREAD_STATUSES = ['open', 'resolved', 'abandoned']
const STATUS_COLOR = {
  open: 'bg-blue-500/20 text-blue-300',
  resolved: 'bg-green-500/20 text-green-300',
  abandoned: 'bg-neutral-800 text-neutral-500',
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
  const [loading, setLoading] = useState(true)

  const [threadDraft, setThreadDraft] = useState('')
  const [clockDraft, setClockDraft] = useState('')
  const [entryDraft, setEntryDraft] = useState('')

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false

    Promise.all([
      supabase.from('campaign_threads').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: true }),
      supabase.from('campaign_clocks').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: true }),
      supabase.from('campaign_timeline_entries').select('*').eq('campaign_id', campaignId).order('created_at', { ascending: false }),
      supabase.from('campaigns').select('session_number').eq('id', campaignId).maybeSingle(),
    ]).then(([threadsRes, clocksRes, timelineRes, campaignRes]) => {
      if (cancelled) return
      setThreads(threadsRes.data || [])
      setClocks(clocksRes.data || [])
      setTimeline(timelineRes.data || [])
      setCurrentSessionNumber(campaignRes.data?.session_number || 1)
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
          if (payload.eventType === 'INSERT') setClocks((c) => [...c, payload.new])
          else if (payload.eventType === 'UPDATE') setClocks((c) => c.map((x) => (x.id === payload.new.id ? payload.new : x)))
          else if (payload.eventType === 'DELETE') setClocks((c) => c.filter((x) => x.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'campaign_timeline_entries', filter: `campaign_id=eq.${campaignId}` },
        (payload) => setTimeline((t) => [payload.new, ...t])
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
    await supabase.from('campaign_clocks').insert({ campaign_id: campaignId, name, segments_total })
    setClockDraft('')
  }

  const adjustClock = async (clock, delta) => {
    const next = Math.max(0, Math.min(clock.segments_total, clock.segments_filled + delta))
    setClocks((c) => c.map((x) => (x.id === clock.id ? { ...x, segments_filled: next } : x)))
    await supabase.from('campaign_clocks').update({ segments_filled: next }).eq('id', clock.id)
  }

  const removeClock = async (clock) => {
    setClocks((c) => c.filter((x) => x.id !== clock.id))
    await supabase.from('campaign_clocks').delete().eq('id', clock.id)
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

  if (loading) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <p className="text-xs text-neutral-500">Loading campaign log…</p>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      {onBack && (
        <button onClick={onBack} className="text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1 mb-3">
          <ArrowLeft size={13} /> Back
        </button>
      )}

      <h1 className="text-white text-lg font-medium mb-1">{campaignName}</h1>
      <p className="text-xs text-neutral-400 mb-4">Campaign log</p>

      <div className="bg-neutral-900 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-xs text-neutral-400">Threads</p>
          {isGm && (
            <div className="flex gap-1.5">
              <input
                value={threadDraft}
                onChange={(e) => setThreadDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addThread()}
                placeholder="New thread"
                className="text-xs bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 w-32 text-white"
              />
              <button onClick={addThread} className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1 text-neutral-200 hover:bg-neutral-800">
                <Plus size={13} /> Add
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {threads.length === 0 && <p className="text-xs text-neutral-500">No open threads yet.</p>}
          {threads.map((thread) => (
            <div key={thread.id} className="text-xs p-2 bg-neutral-800/60 rounded-md border border-neutral-700">
              <div className="flex items-center justify-between mb-1">
                <span className="text-white font-medium">{thread.title}</span>
                {isGm ? (
                  <select
                    value={thread.status}
                    onChange={(e) => setThreadStatus(thread, e.target.value)}
                    className={`text-[10px] rounded px-1.5 py-0.5 border-0 ${STATUS_COLOR[thread.status]}`}
                  >
                    {THREAD_STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_COLOR[thread.status]}`}>{thread.status}</span>
                )}
              </div>
              {thread.description && <p className="text-neutral-400">{thread.description}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-neutral-900 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-xs text-neutral-400">Clocks</p>
          {isGm && (
            <div className="flex gap-1.5">
              <input
                value={clockDraft}
                onChange={(e) => setClockDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addClock()}
                placeholder="New clock"
                className="text-xs bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 w-32 text-white"
              />
              <button onClick={addClock} className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1 text-neutral-200 hover:bg-neutral-800">
                <Plus size={13} /> Add
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {clocks.length === 0 && <p className="text-xs text-neutral-500">No clocks running.</p>}
          {clocks.map((clock) => (
            <div key={clock.id} className="text-xs p-2 bg-neutral-800/60 rounded-md border border-neutral-700">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-white font-medium">{clock.name}</span>
                <span className="text-neutral-500">{clock.segments_filled} / {clock.segments_total}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex gap-0.5 flex-1">
                  {Array.from({ length: clock.segments_total }).map((_, i) => (
                    <span
                      key={i}
                      className={`h-2 flex-1 rounded-sm ${i < clock.segments_filled ? 'bg-blue-400' : 'bg-neutral-700'}`}
                    />
                  ))}
                </div>
                {isGm && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => adjustClock(clock, -1)} className="px-1.5 border border-neutral-700 rounded text-neutral-300">-</button>
                    <button onClick={() => adjustClock(clock, 1)} className="px-1.5 border border-neutral-700 rounded text-neutral-300">+</button>
                    <button onClick={() => removeClock(clock)} className="text-neutral-500 hover:text-red-400">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-neutral-900 rounded-lg p-4">
        <p className="text-xs text-neutral-400 mb-2">Timeline</p>
        {isGm && (
          <div className="flex gap-1.5 mb-2.5">
            <input
              type="number"
              value={currentSessionNumber}
              onChange={(e) => setCurrentSessionNumber(parseInt(e.target.value, 10) || 1)}
              className="w-14 text-xs bg-neutral-950 border border-neutral-700 rounded-md px-1.5 py-1 text-white"
            />
            <input
              value={entryDraft}
              onChange={(e) => setEntryDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addEntry()}
              placeholder="What happened this session?"
              className="flex-1 text-xs bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-white"
            />
            <button onClick={addEntry} className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1 text-neutral-200 hover:bg-neutral-800">
              <Plus size={13} /> Add
            </button>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          {timeline.length === 0 && <p className="text-xs text-neutral-500">No sessions logged yet.</p>}
          {timeline.map((e) => (
            <div key={e.id} className="text-xs p-2 bg-neutral-800/60 rounded-md">
              <span className="text-neutral-500">Session {e.session_number ?? '?'}:</span>{' '}
              <span className="text-neutral-300">{e.entry}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
