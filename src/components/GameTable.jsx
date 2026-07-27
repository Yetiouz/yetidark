import { useState, useEffect, useRef } from 'react'
import { Dices, Send, AlertCircle, User, Settings, ScrollText, BookOpen, Users, Bot, Loader2 } from 'lucide-react'
import MapGrid from './MapGrid.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { rollDiceNotation, flatDieNotation, DiceNotationError } from '../lib/dice.js'

const dice = [20, 12, 10, 8, 6, 4]
const VOTE_POLL_KEY = 'where-next'
const VOTE_OPTIONS = [
  { key: 'vault', label: 'Vault' },
  { key: 'entry', label: 'Back to entry' },
]

// Auto-respond debounce: after any non-AI message lands in an AI-GM
// campaign's scene log, wait this long with no further messages before
// automatically asking the AI to take its turn. Batches near-simultaneous
// messages from multiple players into a single turn instead of the AI
// jumping in after the first one. Manual "Continue" still fires instantly.
const AUTO_TURN_DEBOUNCE_MS = 8000

function hpBarColor(hp, maxHp) {
  const pct = maxHp ? hp / maxHp : 0
  if (pct > 0.6) return 'bg-green-500'
  if (pct > 0.3) return 'bg-amber-500'
  return 'bg-red-500'
}

// Everything here is real Supabase data now, synced live for the whole
// table: the scene log, dice rolls (app-rolled and self-reported, tagged
// per the honor-system design), the map, turn order, the "where to next?"
// vote, and the party's HP/AC cards.
//
// Dice rolling goes through src/lib/dice.js, a client-side port of the
// file-based GM system's dice.py -- real notation (1d8+3), advantage/
// disadvantage on a lone d20 check, and automatic crit/fumble flagging.
// Every roll (app-rolled or self-reported) is persisted to the `dice_rolls`
// audit table, not just summarized in the scene log.
export default function GameTable({ campaignId, session, campaignName = 'The sunken keep', onOpenGmView, onOpenCharacterSheet, onOpenSettings, onOpenLog, onOpenLibrary, onOpenTracker }) {
  const user = session?.user
  const [displayName, setDisplayName] = useState('')
  const [isGm, setIsGm] = useState(false)

  const [log, setLog] = useState([])
  const [message, setMessage] = useState('')
  const [manualDie, setManualDie] = useState(20)
  const [manualValue, setManualValue] = useState('')
  const [rollState, setRollState] = useState(null) // { label, value, isRolling, isCrit, isFumble } -- drives the animated die
  const [rollNonce, setRollNonce] = useState(0) // bumped every roll so the CSS animation replays even on repeat values
  const rollTimerRef = useRef(null)
  const sceneLogRef = useRef(null)
  const chatLogRef = useRef(null)
  const autoTurnTimerRef = useRef(null) // pending debounce timer for the auto-respond trigger
  const gmTypeRef = useRef(null) // mirrors gmType state, read inside the realtime handler below
  const askAiGmRef = useRef(null) // mirrors askAiGm below, kept current so the realtime handler never calls a stale closure

  // Advanced roll controls: notation + advantage/disadvantage + an optional
  // reason, mirroring `python3 dice.py <notation> [--adv|--disadv] --reason`.
  const [notationInput, setNotationInput] = useState('1d20')
  const [rollMode, setRollMode] = useState('flat') // 'flat' | 'advantage' | 'disadvantage'
  const [reasonInput, setReasonInput] = useState('')
  const [rollError, setRollError] = useState(null)

  useEffect(() => {
    return () => {
      if (rollTimerRef.current) clearInterval(rollTimerRef.current)
    }
  }, [])

  const [mapInfo, setMapInfo] = useState(null)
  const [cellState, setCellState] = useState({})
  const [turnOrder, setTurnOrder] = useState([])
  const [votes, setVotes] = useState([])
  const [party, setParty] = useState([])
  const [gmType, setGmType] = useState(null) // 'human' | 'ai'
  const [aiTurnPending, setAiTurnPending] = useState(false)
  const [aiTurnError, setAiTurnError] = useState(null)

  useEffect(() => {
    gmTypeRef.current = gmType
  }, [gmType])

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || user.email || 'You'))
  }, [user])

  // Only the GM can unfog the map -- everyone else sees a read-only view.
  useEffect(() => {
    if (!user || !campaignId) return
    supabase
      .from('campaign_members')
      .select('role')
      .eq('campaign_id', campaignId)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setIsGm(data?.role === 'gm'))
  }, [user, campaignId])

  const reloadVotes = (campaignIdArg) => {
    supabase
      .from('votes')
      .select('option_key, voter_user_id')
      .eq('campaign_id', campaignIdArg)
      .eq('poll_key', VOTE_POLL_KEY)
      .then(({ data }) => setVotes(data || []))
  }

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false

    supabase
      .from('scene_log')
      .select('id, type, sender_user_id, sender_name, text, roll_source, dice_roll_id, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setLog(data || []) })

    supabase
      .from('campaigns')
      .select('map_url, map_cols, map_rows, party_row, party_col, gm_type')
      .eq('id', campaignId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setMapInfo(data)
        setGmType(data?.gm_type || null)
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

    supabase
      .from('turn_order')
      .select('order_list')
      .eq('campaign_id', campaignId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setTurnOrder(data?.order_list || []) })

    reloadVotes(campaignId)

    supabase
      .from('characters')
      .select('id, name, class, level, hp, max_hp, ac, avatar_url')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setParty(data || []) })

    const channel = supabase
      .channel(`game-table-${campaignId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scene_log', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          setLog((l) => (l.some((e) => e.id === payload.new.id) ? l : [...l, payload.new]))

          // Auto-respond debounce: only relevant for AI-GM campaigns. Any
          // fresh, non-AI entry (chat, roll, whatever) resets the clock;
          // once nothing new has come in for AUTO_TURN_DEBOUNCE_MS, ask
          // the AI to take its turn. If the AI itself just answered
          // (e.g. someone else's timer fired first, or a human hit
          // Continue), cancel any timer still waiting -- there's nothing
          // left for it to respond to.
          if (gmTypeRef.current === 'ai') {
            if (autoTurnTimerRef.current) {
              clearTimeout(autoTurnTimerRef.current)
              autoTurnTimerRef.current = null
            }
            if (payload.new.type !== 'ai_gm') {
              autoTurnTimerRef.current = setTimeout(() => {
                autoTurnTimerRef.current = null
                askAiGmRef.current?.()
              }, AUTO_TURN_DEBOUNCE_MS)
            }
          }
        }
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
        (payload) => {
          setMapInfo(payload.new)
          setGmType(payload.new?.gm_type || null)
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'turn_order', filter: `campaign_id=eq.${campaignId}` },
        (payload) => setTurnOrder(payload.new?.order_list || [])
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'votes', filter: `campaign_id=eq.${campaignId}` },
        () => reloadVotes(campaignId)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'characters', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setParty((p) => [...p, payload.new])
          } else if (payload.eventType === 'UPDATE') {
            setParty((p) => p.map((c) => (c.id === payload.new.id ? payload.new : c)))
          }
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      if (autoTurnTimerRef.current) {
        clearTimeout(autoTurnTimerRef.current)
        autoTurnTimerRef.current = null
      }
    }
  }, [campaignId])

  const revealCell = async (row, col) => {
    if (!campaignId) return
    setCellState((s) => ({ ...s, [`${row},${col}`]: 'explored' }))
    await supabase
      .from('map_cells')
      .upsert({ campaign_id: campaignId, row, col, state: 'explored' }, { onConflict: 'campaign_id,row,col' })
  }

  // Inserts and reads the row straight back (instead of waiting on the
  // realtime round-trip) so your own rolls and messages show up
  // immediately; the INSERT handler above dedupes by id so this doesn't
  // create a second copy once the realtime event for the same row arrives.
  const postToLog = async (entry) => {
    if (!campaignId) return
    const { data, error } = await supabase
      .from('scene_log')
      .insert({ campaign_id: campaignId, sender_user_id: user?.id, sender_name: displayName || 'You', ...entry })
      .select()
      .single()
    if (!error && data) {
      setLog((l) => (l.some((e) => e.id === data.id) ? l : [...l, data]))
    }
  }

  const sendMessage = () => {
    if (!message.trim()) return
    postToLog({ type: 'chat', text: message.trim() })
    setMessage('')
  }

  const rollSummaryText = (result) => {
    const modeLabel = result.mode === 'advantage' ? ' (advantage)' : result.mode === 'disadvantage' ? ' (disadvantage)' : ''
    const flag = result.isCrit ? ' — CRITICAL!' : result.isFumble ? ' — fumble!' : ''
    const reasonSuffix = result.reason ? ` — ${result.reason}` : ''
    return `rolled ${result.notation}${modeLabel}: ${result.total}${flag}${reasonSuffix}`
  }

  // Persists a completed roll to the dice_rolls audit table, then posts the
  // human-readable summary to the scene log linked back to it -- so the
  // log stays readable but the full breakdown/reason/crit flag is never
  // lost, matching dice.py's terminal-output-plus-permanent-log behavior.
  const logDiceRoll = async (result) => {
    if (!campaignId) return null
    const { data, error } = await supabase
      .from('dice_rolls')
      .insert({
        campaign_id: campaignId,
        roller_user_id: user?.id,
        roller_name: displayName || 'You',
        notation: result.notation,
        mode: result.mode,
        reason: result.reason,
        breakdown: result.breakdown,
        total: result.total,
        raw_d20: result.rawD20,
        is_crit: result.isCrit,
        is_fumble: result.isFumble,
      })
      .select()
      .single()
    if (error) return null
    await postToLog({ type: 'roll', text: rollSummaryText(result), roll_source: 'app', dice_roll_id: data.id })
    return data
  }

  // Spins the number in the die box a handful of times before landing on
  // the real result, then logs it -- purely cosmetic, the actual roll
  // (`result`, computed up front via rollDiceNotation) never changes.
  const animateAndLog = (result)