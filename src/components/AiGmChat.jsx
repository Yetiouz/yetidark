import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Send, Bot, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

// A dedicated, chat-shaped surface for AI-GM campaigns -- everything since
// the AI's last turn (party chat, rolls, and its own narration) in one
// scrolling thread instead of split across the table's separate Scene log
// and Party chat panels. The table itself (map, dice roller, party cards)
// is unchanged and still reachable for reference; this is just where the
// actual back-and-forth with the GM happens.
//
// Messages post immediately, same as the table's Party chat -- everyone
// sees them the instant they're sent. Continue is the one deliberate,
// party-leader-agnostic action: it tells the AI "reply now" to whatever's
// accumulated since its last turn (see ai-gm-turn Edge Function).
export default function AiGmChat({ campaignId, session, campaignName = 'The sunken keep', onBack }) {
  const user = session?.user
  const [displayName, setDisplayName] = useState('')
  const [log, setLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [aiTurnPending, setAiTurnPending] = useState(false)
  const [aiTurnError, setAiTurnError] = useState(null)
  const logRef = useRef(null)

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || user.email || 'You'))
  }, [user])

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false

    supabase
      .from('scene_log')
      .select('id, type, sender_user_id, sender_name, text, roll_source, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!cancelled) {
          setLog(data || [])
          setLoading(false)
        }
      })

    const channel = supabase
      .channel(`ai-gm-chat-${campaignId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scene_log', filter: `campaign_id=eq.${campaignId}` },
        (payload) => setLog((l) => (l.some((e) => e.id === payload.new.id) ? l : [...l, payload.new]))
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [campaignId])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log.length])

  const sendMessage = async () => {
    const text = message.trim()
    if (!text || !campaignId) return
    setMessage('')
    const { data, error } = await supabase
      .from('scene_log')
      .insert({ campaign_id: campaignId, type: 'chat', sender_user_id: user?.id, sender_name: displayName || 'You', text })
      .select()
      .single()
    if (!error && data) {
      setLog((l) => (l.some((e) => e.id === data.id) ? l : [...l, data]))
    }
  }

  // Compiles everything since the AI's last turn and asks it to respond.
  // The Edge Function does all the real work (context assembly, the Claude
  // call, real dice via its own roll_dice tool, writing the result back
  // into scene_log as a new 'ai_gm' entry); this just invokes it and
  // surfaces a loading/error state while it's in flight.
  const askAiGm = async () => {
    if (!campaignId || aiTurnPending) return
    setAiTurnPending(true)
    setAiTurnError(null)
    const { data, error } = await supabase.functions.invoke('ai-gm-turn', { body: { campaignId } })
    setAiTurnPending(false)
    if (error || data?.error) {
      setAiTurnError(data?.error || error?.message || 'The AI GM call failed.')
    }
  }

  const renderEntry = (entry) => {
    if (entry.type === 'ai_gm') {
      return (
        <div key={entry.id} className="flex justify-start">
          <div className="max-w-[85%] bg-purple-500/10 border border-purple-500/20 rounded-xl px-3.5 py-2.5">
            <p className="font-medium text-purple-300 flex items-center gap-1.5 mb-1 text-xs">
              <Bot size={12} /> AI GM
            </p>
            <p className="text-sm text-neutral-100 whitespace-pre-wrap">{entry.text}</p>
          </div>
        </div>
      )
    }
    if (entry.type === 'roll') {
      return (
        <div key={entry.id} className="flex justify-center">
          <p className="text-[11px] text-neutral-500 italic px-2 py-1">
            {entry.sender_name} {entry.text}
          </p>
        </div>
      )
    }
    if (entry.type === 'narration' || entry.type === 'gm') {
      return (
        <div key={entry.id} className="flex justify-center">
          <p className="text-xs text-neutral-400 italic px-2 py-1 text-center">{entry.text}</p>
        </div>
      )
    }
    // chat -- align the viewer's own messages right, everyone else's left
    const isMine = entry.sender_user_id === user?.id
    return (
      <div key={entry.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[75%] rounded-xl px-3.5 py-2 ${isMine ? 'bg-blue-500/20' : 'bg-neutral-800'}`}>
          {!isMine && <p className="text-[11px] font-medium text-neutral-400 mb-0.5">{entry.sender_name}</p>}
          <p className="text-sm text-neutral-100 whitespace-pre-wrap">{entry.text}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-6 pt-6 pb-20 h-screen flex flex-col">
      {onBack && (
        <button onClick={onBack} className="text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1 mb-3 shrink-0">
          <ArrowLeft size={13} /> Back
        </button>
      )}

      <div className="mb-3 shrink-0">
        <h1 className="text-white text-lg font-medium mb-0.5">{campaignName}</h1>
        <p className="text-xs text-neutral-400">AI GM</p>
      </div>

      <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 bg-neutral-900 rounded-lg p-4 mb-3">
        {loading && <p className="text-xs text-neutral-500">Loading…</p>}
        {!loading && log.length === 0 && (
          <p className="text-xs text-neutral-500 text-center">
            Nothing has happened yet. Say or do something below, then hit Continue when the party's ready.
          </p>
        )}
        {log.map((entry) => renderEntry(entry))}
      </div>

      {aiTurnError && (
        <div className="mb-3 flex items-start gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 shrink-0">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <p>{aiTurnError}</p>
        </div>
      )}

      <div className="flex gap-2 shrink-0">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Say or do something"
          className="flex-1 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white"
        />
        <button
          onClick={sendMessage}
          className="text-sm border border-neutral-700 rounded-md px-3 py-2 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800"
        >
          <Send size={15} />
        </button>
        <button
          onClick={askAiGm}
          disabled={aiTurnPending}
          className="text-sm border border-purple-500/40 bg-purple-500/10 rounded-md px-3.5 py-2 flex items-center gap-1.5 text-purple-200 hover:bg-purple-500/20 disabled:opacity-60 whitespace-nowrap"
        >
          {aiTurnPending ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />}
          {aiTurnPending ? 'Thinking…' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
