import { useState, useEffect, useRef } from 'react'
import { Dices, Send, AlertCircle, User, Settings, ScrollText, BookOpen, Users } from 'lucide-react'
import MapGrid from './MapGrid.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { rollDiceNotation, flatDieNotation, DiceNotationError } from '../lib/dice.js'

const dice = [20, 12, 10, 8, 6, 4]
const VOTE_POLL_KEY = 'where-next'
const VOTE_OPTIONS = [
  { key: 'vault', label: 'Vault' },
  { key: 'entry', label: 'Back to entry' },
]

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
      .select('id, type, sender_name, text, roll_source, dice_roll_id, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setLog(data || []) })

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
        (payload) => setLog((l) => (l.some((e) => e.id === payload.new.id) ? l : [...l, payload.new]))
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
  const animateAndLog = (result) => {
    if (rollState?.isRolling) return
    if (rollTimerRef.current) clearInterval(rollTimerRef.current)
    setRollNonce((n) => n + 1)
    const flicker = () => Math.floor(Math.random() * Math.max(20, Math.abs(result.total) * 2 || 20)) + 1
    setRollState({ label: result.notation, value: flicker(), isRolling: true })
    let ticks = 0
    rollTimerRef.current = setInterval(() => {
      ticks += 1
      if (ticks >= 9) {
        clearInterval(rollTimerRef.current)
        rollTimerRef.current = null
        setRollState({
          label: result.notation,
          value: result.total,
          isRolling: false,
          isCrit: result.isCrit,
          isFumble: result.isFumble,
        })
        logDiceRoll(result)
      } else {
        setRollState({ label: result.notation, value: flicker(), isRolling: true })
      }
    }, 60)
  }

  const rollQuickDie = (sides) => {
    setRollError(null)
    try {
      const result = rollDiceNotation(flatDieNotation(sides), { mode: 'flat' })
      animateAndLog(result)
    } catch (e) {
      setRollError(e instanceof DiceNotationError ? e.message : 'Could not roll that.')
    }
  }

  const rollCustom = () => {
    setRollError(null)
    try {
      const result = rollDiceNotation(notationInput, { mode: rollMode, reason: reasonInput.trim() || null })
      animateAndLog(result)
    } catch (e) {
      setRollError(e instanceof DiceNotationError ? e.message : 'Could not roll that.')
    }
  }

  const logManualRoll = async () => {
    if (!manualValue) return
    const notation = `1d${manualDie}`
    setRollNonce((n) => n + 1)
    setRollState({ label: notation, value: manualValue, isRolling: false })
    await logDiceRoll({
      notation,
      mode: 'self',
      reason: null,
      total: parseInt(manualValue, 10) || 0,
      breakdown: 'self-reported',
      rawD20: null,
      isCrit: false,
      isFumble: false,
    })
    setManualValue('')
  }

  const vote = async (optionKey) => {
    if (!campaignId || !user) return
    const option = VOTE_OPTIONS.find((o) => o.key === optionKey)
    await supabase
      .from('votes')
      .upsert(
        {
          campaign_id: campaignId,
          poll_key: VOTE_POLL_KEY,
          option_key: optionKey,
          option_label: option.label,
          voter_user_id: user.id,
        },
        { onConflict: 'campaign_id,poll_key,voter_user_id' }
      )
  }

  const voteCounts = VOTE_OPTIONS.reduce((acc, o) => {
    acc[o.key] = votes.filter((v) => v.option_key === o.key).length
    return acc
  }, {})
  const myVote = votes.find((v) => v.voter_user_id === user?.id)?.option_key

  // Split so the Scene log (narration/GM lines/rolls) and Party chat
  // (player-to-player OOC chatter) can live in their own separate,
  // always-visible panels instead of one merged, tabbed feed.
  const narrationLog = log.filter((entry) => entry.type !== 'chat')
  const chatLog = log.filter((entry) => entry.type === 'chat')

  useEffect(() => {
    if (sceneLogRef.current) sceneLogRef.current.scrollTop = sceneLogRef.current.scrollHeight
  }, [narrationLog.length])

  useEffect(() => {
    if (chatLogRef.current) chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight
  }, [chatLog.length])

  // Shared by both panels so a roll or chat message renders identically
  // wherever it shows up.
  const renderLogEntry = (entry) => {
    if (entry.type === 'narration') {
      return <span key={entry.id} className="block italic text-neutral-400">{entry.text}</span>
    }
    if (entry.type === 'gm') {
      return (
        <span key={entry.id} className="block">
          <span className="font-medium text-blue-400">{entry.sender_name}:</span>{' '}
          <span className="text-neutral-300">{entry.text}</span>
        </span>
      )
    }
    if (entry.type === 'roll') {
      return (
        <span key={entry.id} className="inline-flex items-center gap-1.5 flex-wrap">
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
        </span>
      )
    }
    return (
      <span key={entry.id} className="block">
        <span className="font-medium text-white">{entry.sender_name}:</span>{' '}
        <span className="text-neutral-300">{entry.text}</span>
      </span>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <p className="text-white font-medium">{campaignName}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {onOpenLog && (
            <button
              onClick={onOpenLog}
              title="Campaign log"
              className="text-xs border border-neutral-700 rounded-md p-1.5 text-neutral-300 hover:bg-neutral-800"
            >
              <ScrollText size={14} />
            </button>
          )}
          {onOpenLibrary && (
            <button
              onClick={onOpenLibrary}
              title="Rules library"
              className="text-xs border border-neutral-700 rounded-md p-1.5 text-neutral-300 hover:bg-neutral-800"
            >
              <BookOpen size={14} />
            </button>
          )}
          {onOpenTracker && (
            <button
              onClick={onOpenTracker}
              title="NPCs, factions & treasure"
              className="text-xs border border-neutral-700 rounded-md p-1.5 text-neutral-300 hover:bg-neutral-800"
            >
              <Users size={14} />
            </button>
          )}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              title="Campaign settings"
              className="text-xs border border-neutral-700 rounded-md p-1.5 text-neutral-300 hover:bg-neutral-800"
            >
              <Settings size={14} />
            </button>
          )}
          {onOpenGmView && (
            <button onClick={onOpenGmView} className="text-xs border border-neutral-700 rounded-md px-2.5 py-1 text-neutral-300 hover:bg-neutral-800">
              GM view
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3 mb-3">
        <div className="bg-neutral-900 rounded-lg p-4">
          <p className="text-xs text-neutral-400 mb-2">Map</p>
          <MapGrid
            mapUrl={mapInfo?.map_url}
            cols={mapInfo?.map_cols || 10}
            rows={mapInfo?.map_rows || 6}
            cellState={cellState}
            partyRow={mapInfo?.party_row}
            partyCol={mapInfo?.party_col}
            mode={isGm ? 'reveal' : 'view'}
            onCellClick={isGm ? (r, c) => revealCell(r, c) : undefined}
          />
          <div className="flex items-center gap-3.5 mt-2 text-[10px] text-neutral-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-neutral-300 inline-block" /> Explored</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-neutral-700 inline-block" /> Fog, not yet seen</span>
          </div>
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-neutral-800">
            <span className="text-xs text-neutral-400">Where to next?</span>
            <div className="flex gap-1.5">
              {VOTE_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => vote(o.key)}
                  className={`text-xs border rounded-md px-2 py-1 flex items-center gap-1.5 hover:bg-neutral-800 ${
                    myVote === o.key ? 'border-blue-500 text-blue-200' : 'border-neutral-700 text-neutral-200'
                  }`}
                >
                  {o.label}{' '}
                  <span className="text-[10px] px-1.5 rounded-full bg-blue-500/20 text-blue-300">{voteCounts[o.key]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="bg-neutral-900 rounded-lg p-3">
            <p className="text-xs text-neutral-400 mb-2">Turn order</p>
            {turnOrder.length === 0 ? (
              <p className="text-xs text-neutral-500">Not set yet -- the GM rolls initiative to start.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {turnOrder.map((t, i) => (
                  <div
                    key={t.id || i}
                    className={`flex items-center justify-between text-xs px-2 py-1.5 rounded ${
                      t.status === 'acting' ? 'bg-blue-500/20 text-blue-300 font-medium' : 'text-neutral-300'
                    }`}
                  >
                    <span>{t.name}</span>
                    <span className={t.status === 'acting' ? '' : 'text-neutral-500'}>{t.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-neutral-900 rounded-lg p-3">
            <style>{`
              @keyframes dice-spin {
                0% { transform: rotate(0deg) scale(1); }
                50% { transform: rotate(180deg) scale(1.12); }
                100% { transform: rotate(360deg) scale(1); }
              }
              @keyframes dice-land {
                0% { transform: scale(1.35); }
                60% { transform: scale(0.92); }
                100% { transform: scale(1); }
              }
              .dice-rolling { animation: dice-spin 0.3s linear infinite; }
              .dice-landed { animation: dice-land 0.3s ease-out; }
            `}</style>
            <p className="text-xs text-neutral-400 mb-2">Roll a die</p>

            <div className="flex flex-col items-center justify-center mb-3">
              <div
                key={rollNonce}
                className={`w-16 h-16 rounded-xl border-2 flex items-center justify-center text-2xl font-bold ${
                  rollState
                    ? rollState.isCrit
                      ? 'border-green-500 text-white bg-green-500/10'
                      : rollState.isFumble
                        ? 'border-red-500 text-white bg-red-500/10'
                        : 'border-blue-500 text-white bg-blue-500/10'
                    : 'border-neutral-700 text-neutral-600 bg-neutral-950'
                } ${rollState?.isRolling ? 'dice-rolling' : rollState ? 'dice-landed' : ''}`}
              >
                {rollState ? rollState.value : <Dices size={22} />}
              </div>
              {rollState && (
                <p className="text-[11px] text-neutral-500 mt-1.5">
                  {rollState.label}
                  {rollState.isRolling ? ' rolling…' : rollState.isCrit ? ' — crit!' : rollState.isFumble ? ' — fumble!' : ''}
                </p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1.5 mb-2.5">
              {dice.map((sides) => (
                <button
                  key={sides}
                  onClick={() => rollQuickDie(sides)}
                  disabled={rollState?.isRolling}
                  className="text-xs py-1.5 border border-neutral-700 rounded-md text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  d{sides}
                </button>
              ))}
            </div>

            <div className="pt-2.5 border-t border-neutral-800">
              <p className="text-[11px] text-neutral-500 mb-1.5">Custom roll (notation, advantage/disadvantage, reason)</p>
              <div className="flex gap-1.5 mb-1.5">
                <input
                  value={notationInput}
                  onChange={(e) => setNotationInput(e.target.value)}
                  placeholder="1d20+3"
                  className="w-20 text-xs bg-neutral-950 border border-neutral-700 rounded-md px-1.5 py-1 text-white"
                />
                <div className="flex flex-1 gap-1">
                  {['flat', 'advantage', 'disadvantage'].map((m) => (
                    <button
                      key={m}
                      onClick={() => setRollMode(m)}
                      className={`flex-1 text-[10px] py-1 rounded-md border ${
                        rollMode === m ? 'border-blue-500 text-blue-200 bg-blue-500/10' : 'border-neutral-700 text-neutral-300'
                      }`}
                    >
                      {m === 'flat' ? 'flat' : m === 'advantage' ? 'adv' : 'disadv'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-1.5 mb-1.5">
                <input
                  value={reasonInput}
                  onChange={(e) => setReasonInput(e.target.value)}
                  placeholder="reason (optional)"
                  className="flex-1 text-xs bg-neutral-950 border border-neutral-700 rounded-md px-1.5 py-1 text-white"
                />
                <button
                  onClick={rollCustom}
                  disabled={rollState?.isRolling}
                  className="text-xs px-2.5 border border-neutral-700 rounded-md text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
                >
                  Roll
                </button>
              </div>
              {rollError && (
                <div className="flex items-center gap-1.5 text-red-400 mb-1.5">
                  <AlertCircle size={12} />
                  <p className="text-[11px]">{rollError}</p>
                </div>
              )}
            </div>

            <div className="pt-2.5 border-t border-neutral-800">
              <p className="text-[11px] text-neutral-500 mb-1.5">Rolled it yourself? Log it here.</p>
              <div className="flex gap-1.5">
                <select
                  value={manualDie}
                  onChange={(e) => setManualDie(e.target.value)}
                  className="w-14 text-xs bg-neutral-950 border border-neutral-700 rounded-md px-1 py-1 text-white"
                >
                  {dice.map((d) => (
                    <option key={d} value={d}>d{d}</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={manualValue}
                  onChange={(e) => setManualValue(e.target.value)}
                  placeholder="14"
                  className="w-14 text-xs bg-neutral-950 border border-neutral-700 rounded-md px-1.5 py-1 text-white"
                />
                <button onClick={logManualRoll} className="flex-1 text-xs border border-neutral-700 rounded-md text-neutral-200 hover:bg-neutral-800">
                  Log
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div className="bg-neutral-900 rounded-lg p-4">
          <p className="text-xs text-neutral-400 mb-2">Scene log</p>
          <div ref={sceneLogRef} className="h-[220px] overflow-y-auto flex flex-col gap-2.5 text-sm pr-1">
            {narrationLog.length === 0 && <p className="text-xs text-neutral-500">Nothing has happened yet.</p>}
            {narrationLog.map((entry) => renderLogEntry(entry))}
          </div>
        </div>

        <div className="bg-neutral-900 rounded-lg p-4">
          <p className="text-xs text-neutral-400 mb-2">Party chat</p>
          <div ref={chatLogRef} className="h-[220px] overflow-y-auto flex flex-col gap-2.5 text-sm pr-1 mb-2.5">
            {chatLog.length === 0 && <p className="text-xs text-neutral-500">No messages yet -- say something below.</p>}
            {chatLog.map((entry) => renderLogEntry(entry))}
          </div>
          <div className="flex gap-2 pt-2.5 border-t border-neutral-800">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Say or do something"
              className="flex-1 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-white"
            />
            <button onClick={sendMessage} className="text-sm border border-neutral-700 rounded-md px-3 py-1.5 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800">
              <Send size={15} /> Send
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-neutral-400 mb-2">Party</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {party.length === 0 && (
          <p className="text-xs text-neutral-500 sm:col-span-3">No characters in this campaign yet.</p>
        )}
        {party.map((p) => (
          <button
            key={p.id}
            onClick={() => onOpenCharacterSheet && onOpenCharacterSheet(p.id)}
            disabled={!onOpenCharacterSheet}
            className="text-left bg-neutral-900 border border-neutral-800 rounded-xl p-3 hover:border-neutral-600 disabled:cursor-default disabled:hover:border-neutral-800"
          >
            <div className="flex items-center gap-2 mb-1.5">
              {p.avatar_url ? (
                <img src={p.avatar_url} alt={p.name} className="w-8 h-8 rounded-full object-cover border border-neutral-700" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center shrink-0">
                  <User size={14} className="text-neutral-500" />
                </div>
              )}
              <span className="text-sm font-medium text-white">{p.name}</span>
            </div>
            <p className="text-[11px] text-neutral-400 mb-2">
              {p.class} &middot; lvl {p.level}
            </p>
            <div className="h-1.5 rounded-full bg-red-900/40 overflow-hidden">
              <div
                className={`h-full ${hpBarColor(p.hp, p.max_hp)}`}
                style={{ width: `${p.max_hp ? (p.hp / p.max_hp) * 100 : 0}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500 mt-1">
              <span>{p.hp}/{p.max_hp} hp</span>
              <span>ac {p.ac}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
