import { useState, useEffect, useRef } from 'react'
import { Dices, Send, AlertCircle, User, Bot, Loader2, Flame, HelpCircle, Swords, Backpack, Sparkles, Package, Mic, ZoomIn, ZoomOut, Sun, ShieldCheck } from 'lucide-react'
import ZoneScene from './ZoneScene.jsx'
import Row from './ui/Row.jsx'
import ProgressBar from './ui/ProgressBar.jsx'
import Footer from './ui/Footer.jsx'
import LogEntry from './LogEntry.jsx'
import CampaignToolbar from './CampaignToolbar.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { flatDieNotation } from '../lib/dice.js'
import { useCampaignMapUrl } from '../lib/useCampaignMapUrl.js'
import { appendUniqueById } from '../app/realtimeCollections.js'
import { useCampaignSession, useProfileDisplayName } from '../lib/useCampaignSession.js'
import { gearSlotCapacity, occupiedGearSlots } from '../game/rules/character.js'

const dice = [20, 12, 10, 8, 6, 4]
const VOTE_POLL_KEY = 'where-next'
const VOTE_OPTIONS = [
{ key: 'vault', label: 'Vault' },
{ key: 'entry', label: 'Back to entry' },
]
const SCENE_TABS = [
{ key: 'scene', label: 'Scene' },
{ key: 'map', label: 'Map' },
{ key: 'split', label: 'Split' },
]

// Auto-respond debounce: after any non-AI message lands in an AI-GM
// campaign's scene log, wait this long with no further messages before
// automatically asking the AI to take its turn. Batches near-simultaneous
// messages from multiple players into a single turn instead of the AI
// jumping in after the first one. Manual "Continue" still fires instantly.
const AUTO_TURN_DEBOUNCE_MS = 8000

function hpBarColor(hp, maxHp) {
const pct = maxHp ? hp / maxHp : 0
if (pct > 0.6) return 'bg-positive'
if (pct > 0.3) return 'bg-warning'
return 'bg-danger'
}

// Mirrors CampaignLog.jsx's minute formatting -- kept local here rather
// than shared since the player table only ever reads this, never writes.
function formatMinutes(totalMin) {
const clamped = Math.max(0, totalMin)
const h = Math.floor(clamped / 60)
const m = Math.floor(clamped % 60)
const s = Math.floor((clamped * 60) % 60)
if (h > 0) return `${h}h ${m}m`
return `${m}m ${s}s`
}

// Same live-remaining-time formula as CampaignLog.jsx: remaining_minutes
// minus elapsed time since lit_at, but only while actually burning.
function displayedMinutes(source, nowMs) {
if (source.lit && source.lit_at) {
const elapsed = (nowMs - new Date(source.lit_at).getTime()) / 60000
return Math.max(0, source.remaining_minutes - elapsed)
}
return source.remaining_minutes
}

// Everything here is real Supabase data now, synced live for the whole
// table: the scene log, dice rolls (app-rolled and self-reported, tagged
// per the honor-system design), the map, turn order, the "where to next?"
// vote, and the party's HP/AC cards.
//
// App dice rolling goes through the authoritative roll_campaign_dice
// database command -- real notation (1d8+3), advantage/disadvantage on a
// lone d20 check, and automatic crit/fumble flagging.
// Every roll (app-rolled or self-reported) is persisted to the `dice_rolls`
// audit table, not just summarized in the scene log.
//
// Layout: three-column shell (character rail / scene+log / situation
// rail) matching the delve-ui-reference player-session mockup, inside the
// same fixed-viewport header/scroll/composer frame as before.
//
// A handful of mockup elements have no real data behind them yet -- Luck,
// weapon-specific attack/damage dice, tracked conditions/active effects,
// and the AI GM's per-message "pending adjudication" check card. Per
// explicit direction, those are kept as visible placeholder UI (clearly
// inert/disabled, honest empty states, no fabricated numbers) so the
// layout reads the way the mockup does, rather than being omitted --
// they're slots waiting on real schema/mechanics, not real features yet.
// The "Talents" panel uses real character_talents rows.
export default function GameTable({ campaignId, session, campaignName = 'The sunken keep', onOpenGmView, onOpenCharacterSheet, onOpenSettings, onOpenLog, onOpenLibrary, onOpenTracker }) {
const user = session?.user
const displayName = useProfileDisplayName(user, 'You')
const [isGm, setIsGm] = useState(false)

const [message, setMessage] = useState('')
const [manualDie, setManualDie] = useState(20)
const [manualValue, setManualValue] = useState('')
const [rollState, setRollState] = useState(null) // { label, value, isRolling, isCrit, isFumble } -- drives the animated die
const [rollNonce, setRollNonce] = useState(0) // bumped every roll so the CSS animation replays even on repeat values
const rollTimerRef = useRef(null)
const rollRequestPendingRef = useRef(false)
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
const [attackTargetId, setAttackTargetId] = useState('')
const [attackNotation, setAttackNotation] = useState('1d20')
const [damageNotation, setDamageNotation] = useState('1d6')
const [attacking, setAttacking] = useState(false)
const [attackError, setAttackError] = useState(null)
const [stabilizeTargetId, setStabilizeTargetId] = useState('')
const [stabilizeNotation, setStabilizeNotation] = useState('1d20')
const [stabilizing, setStabilizing] = useState(false)
const [stabilizeError, setStabilizeError] = useState(null)
const [deathCheckPendingId, setDeathCheckPendingId] = useState(null)
const [rollError, setRollError] = useState(null)
const [sceneTab, setSceneTab] = useState('split') // 'scene' | 'map' | 'split' -- purely a view toggle, no new data

useEffect(() => {
return () => {
if (rollTimerRef.current) clearInterval(rollTimerRef.current)
if (autoTurnTimerRef.current) clearTimeout(autoTurnTimerRef.current)
}
}, [])

// Auto-respond debounce trigger for AI-GM campaigns -- passed to
// useCampaignSession below so its scene_log INSERT handler can call it
// directly, same trigger point as before this was pulled into a hook.
const handleSceneLogInsert = (newEntry) => {
if (gmTypeRef.current === 'ai') {
if (autoTurnTimerRef.current) {
clearTimeout(autoTurnTimerRef.current)
autoTurnTimerRef.current = null
}
if (newEntry.type !== 'ai_gm') {
autoTurnTimerRef.current = setTimeout(() => {
autoTurnTimerRef.current = null
askAiGmRef.current?.()
}, AUTO_TURN_DEBOUNCE_MS)
}
}
}

// Shared with GmDashboard.jsx -- see useCampaignSession.js for exactly
// which tables this covers and why (votes, campaign_threads,
// encounter_monsters, and gm_notes stay local below instead, since
// GameTable and GmDashboard read/write those very differently from each
// other).
const {
log, setLog,
mapInfo, setMapInfo,
turnOrder, setTurnOrder,
party, setParty,
clocks, setClocks,
lightSources, setLightSources,
} = useCampaignSession(campaignId, { channelKey: 'game-table', onSceneLogInsert: handleSceneLogInsert })
const [votes, setVotes] = useState([])
const gmType = mapInfo?.gm_type || null // 'human' | 'ai'
const [aiTurnPending, setAiTurnPending] = useState(false)
const [aiTurnError, setAiTurnError] = useState(null)
const { url: mapUrl, error: mapAccessError } = useCampaignMapUrl(mapInfo)

// Status rail: the open thread standing in as "current objective", plus
// clocks and light sources -- all three already existed (and were already
// member-readable) but only surfaced in Campaign Log, behind an icon-only
// toolbar button. This is the minimal, read-only glance version of that
// same data on the table itself; editing still happens in Campaign Log.
// (clocks/lightSources now come from useCampaignSession above; threads
// and monsters below are GameTable-only, not part of that shared hook.)
const [threads, setThreads] = useState([])
const [monsters, setMonsters] = useState([])
const [nowTick, setNowTick] = useState(() => Date.now())

// My character's gear and talents -- powers the left-rail "Quick actions"
// and "Talents" panels. Fetched separately from `party` (which only
// carries the compact HP/AC/zone fields every card needs) since only my
// own character's full gear list matters here. Not realtime-subscribed:
// gear/talents don't change mid-session often enough to justify a second
// channel, so this just refetches whenever which character is "mine"
// changes.
const [myGear, setMyGear] = useState([])
const [myTalents, setMyTalents] = useState([])

// Revealed GM notes -- these already had a player-readable RLS policy
// (is_campaign_member + revealed = true) but nothing on this screen ever
// rendered them. This is the "Known details" panel from the mockup.
const [gmNotes, setGmNotes] = useState([])

// Only matters while a light source is actually burning, but a cheap 1s
// interval the whole time this screen is open is simplest and matches
// the always-on dice roll spinner timer above.
useEffect(() => {
const t = setInterval(() => setNowTick(Date.now()), 1000)
return () => clearInterval(t)
}, [])

useEffect(() => {
gmTypeRef.current = gmType
}, [gmType])

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

// Everything useCampaignSession doesn't cover: votes, the open-thread
// objective, the read-only monster overlay, and revealed GM notes. Its
// own realtime channel, separate from the shared one above -- two
// channels per screen instead of one, but each one's subscription list
// matches exactly what this screen needs.
useEffect(() => {
if (!campaignId) return
let cancelled = false

reloadVotes(campaignId)

supabase
.from('campaign_threads')
.select('id, title, status, created_at')
.eq('campaign_id', campaignId)
.eq('status', 'open')
.order('created_at', { ascending: true })
.then(({ data }) => { if (!cancelled) setThreads(data || []) })

supabase
.from('encounter_monsters')
.select('id, name, zone, hidden')
.eq('campaign_id', campaignId)
.then(({ data }) => { if (!cancelled) setMonsters(data || []) })

supabase
.from('gm_notes')
.select('id, text, revealed')
.eq('campaign_id', campaignId)
.eq('revealed', true)
.order('created_at', { ascending: true })
.then(({ data }) => { if (!cancelled) setGmNotes(data || []) })

const channel = supabase
.channel(`game-table-extra-${campaignId}`)
.on(
'postgres_changes',
{ event: '*', schema: 'public', table: 'votes', filter: `campaign_id=eq.${campaignId}` },
() => reloadVotes(campaignId)
)
.on(
'postgres_changes',
{ event: '*', schema: 'public', table: 'campaign_threads', filter: `campaign_id=eq.${campaignId}` },
(payload) => {
if (payload.eventType === 'DELETE') {
setThreads((t) => t.filter((x) => x.id !== payload.old.id))
return
}
const row = payload.new
if (row.status !== 'open') {
setThreads((t) => t.filter((x) => x.id !== row.id))
} else if (payload.eventType === 'INSERT') {
setThreads((t) => appendUniqueById(t, row))
} else {
setThreads((t) => t.map((x) => (x.id === row.id ? row : x)))
}
}
)
.on(
'postgres_changes',
{ event: '*', schema: 'public', table: 'encounter_monsters', filter: `campaign_id=eq.${campaignId}` },
(payload) => {
if (payload.eventType === 'INSERT') setMonsters((m) => appendUniqueById(m, payload.new))
else if (payload.eventType === 'UPDATE') setMonsters((m) => m.map((x) => (x.id === payload.new.id ? payload.new : x)))
else if (payload.eventType === 'DELETE') setMonsters((m) => m.filter((x) => x.id !== payload.old.id))
}
)
.on(
'postgres_changes',
{ event: '*', schema: 'public', table: 'gm_notes', filter: `campaign_id=eq.${campaignId}` },
(payload) => {
if (payload.eventType === 'DELETE') {
setGmNotes((n) => n.filter((x) => x.id !== payload.old.id))
return
}
const row = payload.new
if (!row.revealed) {
setGmNotes((n) => n.filter((x) => x.id !== row.id))
return
}
setGmNotes((n) => (n.some((x) => x.id === row.id) ? n.map((x) => (x.id === row.id ? row : x)) : [...n, row]))
}
)
.subscribe()

return () => {
cancelled = true
supabase.removeChannel(channel)
}
}, [campaignId])

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
const logManualDiceRoll = async (result) => {
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
await postToLog({ type: 'roll', text: rollSummaryText(result), roll_source: 'self', dice_roll_id: data.id })
return data
}

// Spins the number in the die box after the server has generated and
// permanently recorded the real result. The animation is cosmetic.
const animateRoll = (result) => {
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
} else {
setRollState({ label: result.notation, value: flicker(), isRolling: true })
}
}, 60)
}

const requestAppRoll = async (notation, mode = 'flat', reason = null) => {
if (rollRequestPendingRef.current || rollState?.isRolling) return
rollRequestPendingRef.current = true
setRollError(null)
const { data, error } = await supabase.rpc('roll_campaign_dice', {
p_campaign_id: campaignId,
p_notation: notation,
p_mode: mode,
p_reason: reason,
p_roller_name: null,
})
rollRequestPendingRef.current = false
if (error) {
setRollError(error.message || 'Could not roll that.')
return
}
const row = data.roll
const result = {
notation: row.notation,
mode: row.mode,
reason: row.reason,
total: row.total,
breakdown: row.breakdown,
rawD20: row.raw_d20,
isCrit: row.is_crit,
isFumble: row.is_fumble,
}
if (data.scene_entry) {
setLog((all) => all.some((entry) => entry.id === data.scene_entry.id)
? all
: [...all, data.scene_entry])
}
animateRoll(result)
}

const rollQuickDie = (sides) => {
requestAppRoll(flatDieNotation(sides))
}

const rollCustom = () => {
requestAppRoll(notationInput, rollMode, reasonInput.trim() || null)
}

const logManualRoll = async () => {
if (!manualValue) return
const notation = `1d${manualDie}`
setRollNonce((n) => n + 1)
setRollState({ label: notation, value: manualValue, isRolling: false })
await logManualDiceRoll({
notation,
mode: 'self',
reason: null,
total: parseInt(manualValue, 10) || 0,
breakdown: 'self-reported',
rawD20: manualDie === 20 ? (parseInt(manualValue, 10) || 0) : null,
isCrit: manualDie === 20 && parseInt(manualValue, 10) === 20,
isFumble: manualDie === 20 && parseInt(manualValue, 10) === 1,
})
setManualValue('')
}

// Compiles everything the party has done since the AI's last turn and
// asks it to respond -- the "anyone hits continue" pattern, so the AI
// replies once per turn instead of after every individual message.
// The Edge Function does all the real work (context assembly, the
// Gemini call, real dice via its own roll_dice tool, and writing the
// result back into scene_log as a new 'ai_gm' entry); this just invokes
// it and surfaces a loading/error state while it's in flight.
const askAiGm = async () => {
if (!campaignId || aiTurnPending) return
setAiTurnPending(true)
setAiTurnError(null)
const { data, error } = await supabase.functions.invoke('ai-gm-turn', { body: { campaignId } })
setAiTurnPending(false)
if (error || data?.error) {
// supabase-js collapses any non-2xx edge function response into a
// generic "Edge Function returned a non-2xx status code" on `error`,
// discarding the actual JSON body the function sent back. The real
// message (e.g. "too many tool calls, try again") lives on
// error.context, which is the still-unread Response object -- read
// it directly so the real reason shows up instead of the generic one.
let message = data?.error || error?.message || 'The AI GM call failed.'
if (error?.context && typeof error.context.json === 'function') {
try {
const body = await error.context.json()
if (body?.error) message = body.error
} catch {
// context wasn't JSON (or already consumed) -- fall back silently
}
}
setAiTurnError(message)
}
}

// Kept current every render so the realtime handler set up once in the
// effect above (closed over campaignId only) always calls the latest
// askAiGm -- otherwise it'd keep calling a stale closure whose
// aiTurnPending guard never reflects reality.
useEffect(() => {
askAiGmRef.current = askAiGm
})

// Single action for the AI-GM chat's input and its one button: post
// whatever's typed (if anything), then immediately ask the AI to take
// its turn instead of waiting out the debounce window. Cancels any
// pending debounce timer since we're triggering right now -- otherwise
// it could still fire a few seconds later and double up on ambiguous
// "should the AI go now" logic.
const sendAndAskAiGm = async () => {
if (autoTurnTimerRef.current) {
clearTimeout(autoTurnTimerRef.current)
autoTurnTimerRef.current = null
}
const text = message.trim()
if (text) {
setMessage('')
await postToLog({ type: 'chat', text })
}
askAiGm()
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

// Status rail derived state. Objective stands in for the oldest open
// thread until there's a real "current objective" concept in the schema.
// Clocks only show once something's actually moved (an idle 0/4 clock
// isn't worth a player's attention yet) and sort most-complete-first
// since that's the most urgent to know about. Light only shows sources
// that are actually lit right now, soonest-to-expire first, capped so
// the rail can't grow without bound -- the full set still lives in
// Campaign Log via the header button. Clocks and light sources show
// even when idle/unlit (dimmed) so the party knows they exist, not
// just that something is already in motion.
const objective = threads[0] || null
const activeClocks = clocks
.slice()
.sort((a, b) => (b.segments_filled / b.segments_total) - (a.segments_filled / a.segments_total))
.slice(0, 4)
const litSources = lightSources
.map((s) => ({ ...s, remaining: displayedMinutes(s, nowTick) }))
.sort((a, b) => {
if (a.lit !== b.lit) return a.lit ? -1 : 1
return a.remaining - b.remaining
})
.slice(0, 3)
const litCharacterId = lightSources.find((s) => s.lit)?.character_id || null
const myCharacter = party.find((p) => p.owner_user_id === user?.id) || null

// My gear/talents -- refetched (not realtime-subscribed) whenever which
// character is "mine" changes. See the myGear/myTalents state comment
// above for why this doesn't need its own channel.
useEffect(() => {
if (!myCharacter?.id) {
setMyGear([])
setMyTalents([])
return
}
let cancelled = false
supabase
.from('character_gear')
.select('id, name, slots, equipped, quantity')
.eq('character_id', myCharacter.id)
.then(({ data }) => { if (!cancelled) setMyGear(data || []) })
supabase
.from('character_talents')
.select('id, source, description')
.eq('character_id', myCharacter.id)
.then(({ data }) => { if (!cancelled) setMyTalents(data || []) })
return () => { cancelled = true }
}, [myCharacter?.id])

// Gear slot usage for the stat bar -- reuses the same rules helpers the
// character sheet and builder already use, so this number always agrees
// with what's shown there.
const gearCapacity = myCharacter
? gearSlotCapacity({
strengthScore: Number(myCharacter.stats?.str) || 10,
constitutionScore: Number(myCharacter.stats?.con) || 10,
features: myTalents.map((t) => t.description),
})
: 0
const gearUsed = occupiedGearSlots(myGear)

// "Combat" vs "Exploration" is derived, not stored -- there's no
// explicit mode field in the schema, and a non-empty turn order is a
// reasonable, honest stand-in rather than inventing a new column.
const sceneMode = turnOrder.length > 0 ? 'Combat' : 'Exploration'

// The scene tab is a pure view toggle over content we already have: no
// separate "scene image" vs "tactical map" data exists, so Scene hides
// the map and shows the log full-width, Map hides the log, and Split
// (the default, matching the old always-both layout) shows both.
const showMapPane = sceneTab !== 'scene'
const showLogPane = sceneTab !== 'map'

// Attack resolution goes through the same authoritative server command
// pattern as roll_campaign_dice: rolls to hit, compares to the target's
// AC, rolls damage on a hit, and applies it -- one audited round trip.
const resolveAttack = async () => {
  if (!attackTargetId || attacking) return
  setAttacking(true)
  setAttackError(null)
  const attackerName = myCharacter?.name || displayName || 'Attacker'
  const { data, error } = await supabase.rpc('resolve_attack_roll', {
    p_campaign_id: campaignId,
    p_attacker_name: attackerName,
    p_attack_notation: attackNotation,
    p_damage_notation: damageNotation,
    p_target_type: 'monster',
    p_target_id: attackTargetId,
  })
  setAttacking(false)
  if (error) {
    setAttackError(error.message || 'Could not resolve that attack.')
    return
  }
  if (data.scene_entry) {
    setLog((all) => (all.some((entry) => entry.id === data.scene_entry.id) ? all : [...all, data.scene_entry]))
  }
}

// Stabilize: DC 15 INT check against a dying party member at Close
// range, same authoritative-command pattern as attacks/dice.
const resolveStabilize = async () => {
  if (!stabilizeTargetId || stabilizing) return
  setStabilizing(true)
  setStabilizeError(null)
  const healerName = myCharacter?.name || displayName || 'Someone'
  const { data, error } = await supabase.rpc('resolve_stabilize_check', {
    p_campaign_id: campaignId,
    p_healer_name: healerName,
    p_target_character_id: stabilizeTargetId,
    p_int_notation: stabilizeNotation,
  })
  setStabilizing(false)
  if (error) {
    setStabilizeError(error.message || 'Could not attempt that.')
    return
  }
  if (data.scene_entry) {
    setLog((all) => (all.some((entry) => entry.id === data.scene_entry.id) ? all : [...all, data.scene_entry]))
  }
}

// Death check: rolled on a dying character's subsequent turn. Natural
// 20 recovers with 1 HP, otherwise the death timer ticks down.
const rollDeathCheck = async (characterId) => {
  if (deathCheckPendingId) return
  setDeathCheckPendingId(characterId)
  const { data, error } = await supabase.rpc('resolve_dying_turn', {
    p_campaign_id: campaignId,
    p_character_id: characterId,
  })
  setDeathCheckPendingId(null)
  if (!error && data?.scene_entry) {
    setLog((all) => (all.some((entry) => entry.id === data.scene_entry.id) ? all : [...all, data.scene_entry]))
  }
}

// "Ready" a piece of equipped gear -- there's no per-item damage die or
// attack bonus in the schema (character_gear is just name/slots/equipped/
// quantity), so this can't roll anything on its own. What it can
// honestly do is narrate the action into the shared log, which is a real,
// useful quick action rather than a non-functional button.
const readyGear = (item) => {
if (!item) return
postToLog({ type: 'narration', text: `${myCharacter?.name || displayName || 'Someone'} readies ${item.name}.` })
}

// Shared by the human-GM Scene log panel and the AI-GM unified chat feed
// (same ref, reused) -- keyed on the full log so it scrolls correctly
// whichever one is showing.
useEffect(() => {
if (sceneLogRef.current) sceneLogRef.current.scrollTop = sceneLogRef.current.scrollHeight
}, [log.length])

useEffect(() => {
if (chatLogRef.current) chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight
}, [chatLog.length])

// Shared by both panels so a roll or chat message renders identically
// wherever it shows up.
// AI-GM campaigns get one unified, chat-shaped feed (party messages +
// AI narration + rolls, in order) right here on the table instead of
// the two-panel Scene log / Party chat split -- the map, dice roller,
// and everything else on this page stays put either way.
const renderChatBubble = (entry) => {
if (entry.type === 'ai_gm') {
return (
<div key={entry.id} className="flex justify-start">
<div className="max-w-[85%] bg-ai/10 border border-ai/20 rounded-xl px-3.5 py-2.5">
<p className="font-medium text-ai-text flex items-center gap-1.5 mb-1 text-xs">
<Bot size={12} /> AI GM
</p>
<p className="text-sm text-ink whitespace-pre-wrap">{entry.text}</p>
</div>
</div>
)
}
if (entry.type === 'roll') {
return (
<div key={entry.id} className="flex justify-center">
<p className="text-[11px] text-ink-dim italic px-2 py-1">
{entry.sender_name} {entry.text}
</p>
</div>
)
}
if (entry.type === 'narration' || entry.type === 'gm') {
return (
<div key={entry.id} className="flex justify-center">
<p className="text-xs text-ink-dim italic px-2 py-1 text-center">{entry.text}</p>
</div>
)
}
const isMine = entry.sender_user_id === user?.id
return (
<div key={entry.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
<div className={`max-w-[75%] rounded-xl px-3.5 py-2 ${isMine ? 'bg-primary/20' : 'bg-panel2'}`}>
{!isMine && <p className="text-[11px] font-medium text-ink-dim mb-0.5">{entry.sender_name}</p>}
<p className="text-sm text-ink whitespace-pre-wrap">{entry.text}</p>
</div>
</div>
)
}

return (
<div className="h-screen flex flex-col overflow-hidden">
<div className="shrink-0 max-w-6xl mx-auto w-full px-6 pt-6 pb-3 flex items-center justify-between">
<div className="flex items-center gap-2.5">
<p className="text-white font-medium">{campaignName}</p>
<span className="text-[10px] px-1.5 py-0.5 rounded bg-positive/20 text-positive-text border border-positive/40">Live now</span>
</div>
<div className="flex items-center gap-1.5">
<div className="flex items-center -space-x-1.5 mr-1">
{party.slice(0, 4).map((p) => (
<div
key={p.id}
title={p.name}
className="w-6 h-6 rounded-full border-2 border-bg flex items-center justify-center text-[10px] font-medium text-white"
style={{ backgroundColor: p.color || '#3f3f46' }}
>
{p.name?.[0]?.toUpperCase() || '?'}
</div>
))}
</div>
<CampaignToolbar
onOpenLog={onOpenLog}
onOpenLibrary={onOpenLibrary}
onOpenTracker={onOpenTracker}
onOpenSettings={onOpenSettings}
after={isGm && gmType !== 'ai' && onOpenGmView && (
<button onClick={onOpenGmView} className="text-xs border border-line rounded-md px-2.5 py-1 text-ink hover:bg-panel2">
GM view
</button>
)}
/>
</div>
</div>

{myCharacter && (
<div className="shrink-0 max-w-6xl mx-auto w-full px-6 pb-3 grid grid-cols-3 sm:grid-cols-5 gap-2">
<div className="bg-panel border border-line-soft rounded-lg px-3 py-2">
<p className="text-[10px] tracking-wide text-ink-dim mb-0.5">HP</p>
<p className="text-lg font-semibold text-white">
<span className={myCharacter.hp <= myCharacter.max_hp * 0.3 ? 'text-danger-text' : 'text-positive-text'}>{myCharacter.hp}</span>
<span className="text-ink-dim"> / {myCharacter.max_hp}</span>
</p>
</div>
<div className="bg-panel border border-line-soft rounded-lg px-3 py-2">
<p className="text-[10px] tracking-wide text-ink-dim mb-0.5">AC</p>
<p className="text-lg font-semibold text-white">{myCharacter.ac}</p>
</div>
<div className="bg-panel border border-line-soft rounded-lg px-3 py-2">
<p className="text-[10px] tracking-wide text-ink-dim mb-0.5">Gear</p>
<p className="text-lg font-semibold text-warning-text">{gearUsed}<span className="text-ink-dim"> / {gearCapacity}</span></p>
</div>
<div className="bg-panel border border-line-soft rounded-lg px-3 py-2">
<p className="text-[10px] tracking-wide text-ink-dim mb-0.5 flex items-center gap-1"><Sparkles size={10} /> LUCK</p>
<p className="text-lg font-semibold text-ink-faint" title="Luck isn't tracked yet -- placeholder slot">&mdash;</p>
</div>
<div className={`rounded-lg px-3 py-2 border ${litSources[0]?.lit ? 'border-warning/60 bg-warning/5' : 'bg-panel border-line-soft'}`}>
<p className="text-[10px] tracking-wide text-ink-dim mb-0.5 flex items-center gap-1"><Flame size={10} /> TORCH</p>
{litSources[0]?.lit ? (
<p className="text-sm font-semibold text-warning-text">
{formatMinutes(litSources[0].remaining)}
<span className="text-ink-dim font-normal"> · {party.find((p) => p.id === litSources[0].character_id)?.name || '—'}</span>
</p>
) : (
<p className="text-sm text-ink-dim">Unlit</p>
)}
</div>
</div>
)}

<div className="flex-1 overflow-y-auto px-6">
<div className="max-w-6xl mx-auto w-full pb-4">
{gmType === 'ai' && aiTurnError && (
<div className="mb-3 flex items-start gap-2 text-danger-text text-xs bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
<AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
<p>{aiTurnError}</p>
</div>
)}

<div className="flex items-center gap-1.5 mb-3">
{SCENE_TABS.map((t) => (
<button
key={t.key}
onClick={() => setSceneTab(t.key)}
className={`text-xs px-3 py-1.5 rounded-md border ${
sceneTab === t.key ? 'border-primary text-primary-text bg-primary/10' : 'border-line text-ink hover:bg-panel2'
}`}
>
{t.label}
</button>
))}
</div>

<div className="grid grid-cols-1 md:grid-cols-[190px_1fr_220px] gap-3 mb-3 items-start">
{/* LEFT RAIL: my character */}
<div className="flex flex-col gap-3">
{myCharacter ? (
<>
<div className="bg-panel border border-line-soft rounded-lg p-3">
<p className="text-sm font-medium text-white">{myCharacter.name}</p>
<p className="text-[11px] text-ink-dim">Level {myCharacter.level} &middot; {myCharacter.class}</p>
</div>

<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-2">Quick actions</p>
<div className="flex flex-col gap-1.5">
{myGear.filter((g) => g.equipped).length === 0 && (
<p className="text-[11px] text-ink-dim">No equipped gear yet.</p>
)}
{myGear.filter((g) => g.equipped).map((g) => (
<Row key={g.id} icon={Swords} label={g.name} onClick={() => readyGear(g)} />
))}
{onOpenCharacterSheet && myCharacter && (
<Row icon={Backpack} label="Inspect character" onClick={() => onOpenCharacterSheet(myCharacter.id)} />
)}
<Row
icon={Package}
label="Use item"
disabled
title="Item consumption isn't wired up yet -- placeholder slot"
/>
</div>
</div>

<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-2">Talents</p>
{myTalents.length === 0 ? (
<p className="text-[11px] text-ink-dim">None yet.</p>
) : (
<div className="flex flex-col gap-2">
{myTalents.map((t) => (
<div key={t.id} className="text-[11px]">
<p className="text-ink">{t.description}</p>
<p className="text-ink-faint">{t.source}</p>
</div>
))}
</div>
)}
</div>

<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-2 flex items-center gap-1"><ShieldCheck size={11} className="text-ink-dim" /> Active effects</p>
<p className="text-[11px] text-ink-dim">Not tracked yet -- conditions/buffs are a planned feature.</p>
</div>
</>
) : (
<div className="bg-panel border border-line-soft rounded-lg p-3">
<p className="text-[11px] text-ink-dim">You don't have a character in this campaign yet.</p>
</div>
)}

<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-2">Turn order</p>
{turnOrder.length === 0 ? (
<p className="text-[11px] text-ink-dim">Not set yet -- the GM rolls initiative to start.</p>
) : (
<div className="flex flex-col gap-1">
{turnOrder.map((t, i) => (
<div
key={t.id || i}
className={`flex items-center justify-between text-[11px] px-2 py-1 rounded ${
t.status === 'acting' ? 'bg-primary/20 text-primary-text font-medium' : 'text-ink'
}`}
>
<span>{t.name}</span>
<span className={t.status === 'acting' ? '' : 'text-ink-dim'}>{t.status}</span>
</div>
))}
</div>
)}
</div>
</div>

{/* CENTER: scene + log + composer helpers */}
<div className="flex flex-col gap-3 min-w-0">
{showMapPane && (
<div className="bg-panel rounded-lg p-4">
<div className="flex items-center justify-between mb-2.5">
<span className="text-xs text-ink-dim">Scene</span>
<div className="flex items-center gap-1">
{[ZoomIn, ZoomOut, Sun].map((Icon, i) => (
<button
key={i}
disabled
title="Map view controls aren't wired up yet -- placeholder"
className="p-1 rounded border border-line-soft text-ink-faint cursor-not-allowed"
>
<Icon size={12} />
</button>
))}
</div>
</div>
<ZoneScene
mapUrl={mapUrl}
mapAccessError={mapAccessError}
party={party}
monsters={monsters}
litCharacterId={litCharacterId}
/>
<div className="flex items-center justify-between mt-3 pt-2.5 border-t border-line-soft">
<span className="text-xs text-ink-dim">Where to next?</span>
<div className="flex gap-1.5">
{VOTE_OPTIONS.map((o) => (
<button
key={o.key}
onClick={() => vote(o.key)}
className={`text-xs border rounded-md px-2 py-1 flex items-center gap-1.5 hover:bg-panel2 ${
myVote === o.key ? 'border-primary text-primary-text' : 'border-line text-ink'
}`}
>
{o.label}{' '}
<span className="text-[10px] px-1.5 rounded-full bg-primary/20 text-primary-text">{voteCounts[o.key]}</span>
</button>
))}
</div>
</div>
</div>
)}

<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
<div className="bg-panel rounded-lg p-3">
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
<p className="text-xs text-ink-dim mb-2">Roll a die</p>

<div className="flex flex-col items-center justify-center mb-3">
<div
key={rollNonce}
className={`w-16 h-16 rounded-xl border-2 flex items-center justify-center text-2xl font-bold ${
rollState
? rollState.isCrit
? 'border-positive text-white bg-positive/10'
: rollState.isFumble
? 'border-danger text-white bg-danger/10'
: 'border-primary text-white bg-primary/10'
: 'border-line text-ink-faint bg-bg'
} ${rollState?.isRolling ? 'dice-rolling' : rollState ? 'dice-landed' : ''}`}
>
{rollState ? rollState.value : <Dices size={22} />}
</div>
{rollState && (
<p className="text-[11px] text-ink-dim mt-1.5">
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
className="text-xs py-1.5 border border-line rounded-md text-ink hover:bg-panel2 disabled:opacity-50"
>
d{sides}
</button>
))}
</div>

<div className="pt-2.5 border-t border-line-soft">
<p className="text-[11px] text-ink-dim mb-1.5">Custom roll (notation, advantage/disadvantage, reason)</p>
<div className="flex gap-1.5 mb-1.5">
<input
value={notationInput}
onChange={(e) => setNotationInput(e.target.value)}
placeholder="1d20+3"
className="w-20 text-xs bg-bg border border-line rounded-md px-1.5 py-1 text-white"
/>
<div className="flex flex-1 gap-1">
{['flat', 'advantage', 'disadvantage'].map((m) => (
<button
key={m}
onClick={() => setRollMode(m)}
className={`flex-1 text-[10px] py-1 rounded-md border ${
rollMode === m ? 'border-primary text-primary-text bg-primary/10' : 'border-line text-ink'
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
className="flex-1 min-w-0 text-xs bg-bg border border-line rounded-md px-1.5 py-1 text-white"
/>
<button
onClick={rollCustom}
disabled={rollState?.isRolling}
className="text-xs px-2.5 border border-line rounded-md text-ink hover:bg-panel2 disabled:opacity-50"
>
Roll
</button>
</div>
{rollError && (
<div className="flex items-center gap-1.5 text-danger-text mb-1.5">
<AlertCircle size={12} />
<p className="text-[11px]">{rollError}</p>
</div>
)}
</div>

<div className="pt-2.5 border-t border-line-soft">
<p className="text-[11px] text-ink-dim mb-1.5">Rolled it yourself? Log it here.</p>
<div className="flex gap-1.5">
<select
value={manualDie}
onChange={(e) => setManualDie(e.target.value)}
className="w-14 text-xs bg-bg border border-line rounded-md px-1 py-1 text-white"
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
className="w-14 text-xs bg-bg border border-line rounded-md px-1.5 py-1 text-white"
/>
<button onClick={logManualRoll} className="flex-1 text-xs border border-line rounded-md text-ink hover:bg-panel2">
Log
</button>
</div>
</div>
</div>

<div className="flex flex-col gap-3">
<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-2">Attack</p>
{monsters.length === 0 ? (
<p className="text-[11px] text-ink-dim">No monsters in this encounter yet.</p>
) : (
<>
<select
value={attackTargetId}
onChange={(e) => setAttackTargetId(e.target.value)}
className="w-full text-xs bg-bg border border-line rounded-md px-1.5 py-1 text-white mb-1.5"
>
<option value="">Target...</option>
{monsters.map((m) => (
<option key={m.id} value={m.id}>{m.name}</option>
))}
</select>
<div className="flex gap-1.5 mb-1.5">
<input
value={attackNotation}
onChange={(e) => setAttackNotation(e.target.value)}
placeholder="1d20+3"
className="w-16 text-xs bg-bg border border-line rounded-md px-1.5 py-1 text-white"
/>
<input
value={damageNotation}
onChange={(e) => setDamageNotation(e.target.value)}
placeholder="1d6+1"
className="w-16 text-xs bg-bg border border-line rounded-md px-1.5 py-1 text-white"
/>
<button
onClick={resolveAttack}
disabled={!attackTargetId || attacking}
className="flex-1 text-xs border border-line rounded-md text-ink hover:bg-panel2 disabled:opacity-50"
>
{attacking ? 'Rolling…' : 'Attack'}
</button>
</div>
{attackError && (
<div className="flex items-center gap-1.5 text-danger-text">
<AlertCircle size={12} />
<p className="text-[11px]">{attackError}</p>
</div>
)}
</>
)}
</div>

<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-2">Stabilize</p>
{party.filter((p) => p.status === 'dying').length === 0 ? (
<p className="text-[11px] text-ink-dim">No one is dying right now.</p>
) : (
<>
<select
value={stabilizeTargetId}
onChange={(e) => setStabilizeTargetId(e.target.value)}
className="w-full text-xs bg-bg border border-line rounded-md px-1.5 py-1 text-white mb-1.5"
>
<option value="">Target...</option>
{party.filter((p) => p.status === 'dying').map((p) => (
<option key={p.id} value={p.id}>{p.name}{(p.zone || 'near') !== 'close' ? ' (not Close)' : ''}</option>
))}
</select>
<div className="flex gap-1.5 mb-1.5">
<input
value={stabilizeNotation}
onChange={(e) => setStabilizeNotation(e.target.value)}
placeholder="1d20+1"
className="w-16 text-xs bg-bg border border-line rounded-md px-1.5 py-1 text-white"
/>
<button
onClick={resolveStabilize}
disabled={!stabilizeTargetId || stabilizing}
className="flex-1 text-xs border border-line rounded-md text-ink hover:bg-panel2 disabled:opacity-50"
>
{stabilizing ? 'Rolling…' : 'Stabilize (DC 15 INT)'}
</button>
</div>
{stabilizeError && (
<div className="flex items-center gap-1.5 text-danger-text">
<AlertCircle size={12} />
<p className="text-[11px]">{stabilizeError}</p>
</div>
)}
</>
)}
</div>
</div>
</div>

{showLogPane && (gmType === 'ai' ? (
<div className="bg-panel rounded-lg p-4">
<p className="text-xs text-ink-dim mb-2">AI GM</p>
<div ref={sceneLogRef} className="min-h-[240px] max-h-[420px] overflow-y-auto flex flex-col gap-2.5 pr-1">
{log.length === 0 && (
<p className="text-xs text-ink-dim text-center mt-4">
Nothing has happened yet. Say or do something below, then hit Continue when the party's ready.
</p>
)}
{log.map((entry) => renderChatBubble(entry))}
{aiTurnPending && (
<div className="flex justify-start">
<div className="max-w-[85%] bg-panel2/70 border border-line rounded-xl px-3.5 py-2.5">
<p className="font-medium text-ink flex items-center gap-1.5 mb-1 text-xs">
<Loader2 size={12} className="animate-spin" /> Pending adjudication
</p>
<p className="text-xs text-ink-dim mb-2">The AI GM is resolving what happens next.</p>
<div className="flex gap-1.5">
{['No roll', 'Request check', 'Clarify'].map((label) => (
<button
key={label}
disabled
title="Manual adjudication controls aren't wired up yet -- placeholder"
className="text-[11px] border border-line rounded-md px-2 py-1 text-ink-faint cursor-not-allowed"
>
{label}
</button>
))}
</div>
</div>
</div>
)}
</div>
</div>
) : (
<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
<div className="bg-panel rounded-lg p-4">
<p className="text-xs text-ink-dim mb-2">Scene log</p>
<div className="h-[220px] overflow-y-auto flex flex-col gap-2.5 text-sm pr-1">
{narrationLog.length === 0 && <p className="text-xs text-ink-dim">Nothing has happened yet.</p>}
{narrationLog.map((entry) => <LogEntry key={entry.id} entry={entry} />)}
</div>
</div>

<div className="bg-panel rounded-lg p-4">
<p className="text-xs text-ink-dim mb-2">Party chat</p>
<div ref={chatLogRef} className="h-[220px] overflow-y-auto flex flex-col gap-2.5 text-sm pr-1">
{chatLog.length === 0 && <p className="text-xs text-ink-dim">No messages yet -- say something below.</p>}
{chatLog.map((entry) => <LogEntry key={entry.id} entry={entry} />)}
</div>
</div>
</div>
))}
</div>

{/* RIGHT RAIL: current scene / known details / objective / party */}
<div className="flex flex-col gap-3">
<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-1.5">Current scene</p>
<span className={`inline-block text-xs px-2 py-1 rounded-md border ${
sceneMode === 'Combat' ? 'border-danger/60 text-danger-text bg-danger/10' : 'border-primary/60 text-primary-text bg-primary/10'
}`}>
{sceneMode}
</span>
</div>

<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-2">Known details</p>
{gmNotes.length === 0 ? (
<p className="text-[11px] text-ink-dim">Nothing revealed yet.</p>
) : (
<div className="flex flex-col gap-1.5">
{gmNotes.map((n) => (
<div key={n.id} className="flex items-start gap-1.5 text-[11px] text-ink border border-line-soft rounded-md px-2 py-1.5">
<HelpCircle size={11} className="text-ink-dim mt-0.5 shrink-0" />
<span>{n.text}</span>
</div>
))}
</div>
)}
</div>

{objective && (
<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-1.5">Objective</p>
<p className="text-sm text-ink">{objective.title}</p>
</div>
)}

{activeClocks.length > 0 && (
<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-2">Clocks</p>
<div className="flex flex-col gap-2">
{activeClocks.map((c) => (
<div key={c.id}>
<div className="flex items-center justify-between mb-1">
<span className={`text-[11px] truncate ${c.segments_filled > 0 ? 'text-ink' : 'text-ink-dim'}`}>{c.name}</span>
<span className="text-[10px] text-ink-dim shrink-0 ml-1.5">{c.segments_filled}/{c.segments_total}</span>
</div>
<ProgressBar mode="segmented" segments={c.segments_total} filled={c.segments_filled} tone="amber" />
</div>
))}
</div>
</div>
)}

<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-2">Party</p>
{party.length === 0 && <p className="text-[11px] text-ink-dim">No characters in this campaign yet.</p>}
<div className="flex flex-col gap-2">
{party.map((p) => (
<div key={p.id} className="border border-line-soft rounded-md p-2">
<button
onClick={() => onOpenCharacterSheet && onOpenCharacterSheet(p.id)}
disabled={!onOpenCharacterSheet}
className="w-full text-left disabled:cursor-default"
>
<div className="flex items-center justify-between mb-1">
<div className="flex items-center gap-1.5 min-w-0">
{p.avatar_url ? (
<img src={p.avatar_url} alt={p.name} className="w-5 h-5 rounded-full object-cover border border-line shrink-0" />
) : (
<div className="w-5 h-5 rounded-full bg-panel2 border border-line flex items-center justify-center shrink-0">
<User size={10} className="text-ink-dim" />
</div>
)}
<span className="text-xs font-medium text-white truncate">{p.name}</span>
</div>
<span className="text-[11px] text-ink-dim shrink-0">{p.hp}/{p.max_hp}</span>
</div>
<ProgressBar value={p.hp} max={p.max_hp} barClassName={hpBarColor(p.hp, p.max_hp)} trackBg="bg-danger/40" heightClassName="h-1" />
</button>
{p.status && p.status !== 'alive' && (
<span className={`inline-block mt-1.5 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${
p.status === 'dying' ? 'border-danger text-danger-text' : p.status === 'stable' ? 'border-warning text-warning-text' : 'border-line text-ink-dim'
}`}>
{p.status === 'dying' ? `Dying (${p.death_timer ?? '?'})` : p.status}
</span>
)}
{p.status === 'dying' && (
<button
onClick={() => rollDeathCheck(p.id)}
disabled={deathCheckPendingId === p.id}
className="mt-1.5 w-full text-[11px] border border-danger/60 text-danger-text rounded-md py-1 hover:bg-danger/40 disabled:opacity-50"
>
{deathCheckPendingId === p.id ? 'Rolling…' : 'Roll death check'}
</button>
)}
</div>
))}
</div>
</div>
</div>
</div>
</div>
</div>

<Footer>
<div className="max-w-6xl mx-auto w-full px-6 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto_220px] gap-3 items-center">
<input
value={message}
onChange={(e) => setMessage(e.target.value)}
onKeyDown={(e) => e.key === 'Enter' && (gmType === 'ai' ? sendAndAskAiGm() : sendMessage())}
placeholder="Say or do something"
className="min-w-0 bg-panel border border-line rounded-md px-3 py-2 text-sm text-white"
/>
<button
disabled
title="Voice input isn't wired up yet -- placeholder"
className="text-sm border border-line-soft rounded-md px-3 py-2 text-ink-faint cursor-not-allowed"
>
<Mic size={15} />
</button>
{onOpenLibrary && (
<button
onClick={onOpenLibrary}
title="Ask a rule"
className="text-sm border border-line rounded-md px-3 py-2 flex items-center gap-1.5 text-ink hover:bg-panel2 whitespace-nowrap"
>
<HelpCircle size={15} /> Ask a rule
</button>
)}
{gmType === 'ai' ? (
<button
onClick={sendAndAskAiGm}
disabled={aiTurnPending}
className="text-sm border border-ai/40 bg-ai/10 rounded-md px-3.5 py-2 flex items-center justify-center gap-1.5 text-ai-text hover:bg-ai/20 disabled:opacity-60 whitespace-nowrap"
>
{aiTurnPending ? <Loader2 size={15} className="animate-spin" /> : message.trim() ? <Send size={15} /> : <Bot size={15} />}
{aiTurnPending ? 'Thinking…' : message.trim() ? 'Send' : 'Continue'}
</button>
) : (
<button
onClick={sendMessage}
className="text-sm border border-line rounded-md px-3.5 py-2 flex items-center justify-center gap-1.5 text-ink hover:bg-panel2"
>
<Send size={15} /> Send
</button>
)}
</div>
</Footer>
</div>
)
}
