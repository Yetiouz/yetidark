import { useState, useEffect, useRef } from 'react'
import { Dices, Send, AlertCircle, Bot, Loader2, Flame, HelpCircle, Swords, Backpack, Sparkles, Package, Mic, ShieldCheck } from 'lucide-react'
import ZoneScene from './ZoneScene.jsx'
import Row from './ui/Row.jsx'
import ProgressBar from './ui/ProgressBar.jsx'
import StatTile from './ui/StatTile.jsx'
import Card from './ui/Card.jsx'
import Footer from './ui/Footer.jsx'
import Modal from './ui/Modal.jsx'
import Button from './ui/Button.jsx'
import DiceRoller from './ui/DiceRoller.jsx'
import CampaignToolbar from './CampaignToolbar.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { flatDieNotation } from '../lib/dice.js'
import { useCampaignMapUrl } from '../lib/useCampaignMapUrl.js'
import { appendUniqueById } from '../app/realtimeCollections.js'
import { useCampaignSession, useProfileDisplayName } from '../lib/useCampaignSession.js'
import { gearSlotCapacity, occupiedGearSlots } from '../game/rules/character.js'

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
// per the honor-system design), the map, turn order, and the party's
// HP/AC cards.
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
// A handful of mockup elements have no real data behind them yet --
// weapon-specific attack/damage dice, tracked conditions/active effects,
// and the AI GM's per-message "pending adjudication" check card. Per
// explicit direction, those are kept as visible placeholder UI (clearly
// inert/disabled, honest empty states, no fabricated numbers) so the
// layout reads the way the mockup does, rather than being omitted --
// they're slots waiting on real schema/mechanics, not real features yet.
// Luck was one of these too until 2026-08-03 (characters.luck_tokens,
// GM-awarded via GmDashboard.jsx's Party card) -- see that file for the
// award control; this screen only ever displays the count.
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
const [moving, setMoving] = useState(false)
const [moveError, setMoveError] = useState(null)
const [deathCheckPendingId, setDeathCheckPendingId] = useState(null)
const [rollError, setRollError] = useState(null)
// The dice roller / Attack / Stabilize cards used to render as permanent
// stacked cards in the center column -- real screen-space budget the
// mockup spends on one small on-demand action instead. Now behind this,
// opened from the composer's dice button; same handlers/state, just
// moved into Modal.jsx rather than always rendered.
const [showDiceModal, setShowDiceModal] = useState(false)

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
// which tables this covers and why (campaign_threads, encounter_monsters,
// and gm_notes stay local below instead, since GameTable and GmDashboard
// read/write those very differently from each other).
const {
log, setLog,
mapInfo,
turnOrder,
party,
clocks,
lightSources,
} = useCampaignSession(campaignId, { channelKey: 'game-table', onSceneLogInsert: handleSceneLogInsert })
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
const [secrets, setSecrets] = useState([])
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

// Everything useCampaignSession doesn't cover: the open-thread objective,
// the read-only monster overlay, and revealed GM notes. Its own realtime
// channel, separate from the shared one above -- two channels per screen
// instead of one, but each one's subscription list matches exactly what
// this screen needs.
useEffect(() => {
if (!campaignId) return
let cancelled = false

supabase
.from('campaign_threads')
.select('id, title, status, created_at')
.eq('campaign_id', campaignId)
.eq('status', 'open')
.order('created_at', { ascending: true })
.then(({ data }) => { if (!cancelled) setThreads(data || []) })

supabase
.from('encounter_monsters')
.select('id, name, zone, hidden, hp, max_hp, hp_visible')
.eq('campaign_id', campaignId)
.then(({ data }) => { if (!cancelled) setMonsters(data || []) })

supabase
.from('scene_secrets')
.select('id, name, description, zone, state')
.eq('campaign_id', campaignId)
.then(({ data }) => { if (!cancelled) setSecrets(data || []) })

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
{ event: '*', schema: 'public', table: 'scene_secrets', filter: `campaign_id=eq.${campaignId}` },
(payload) => {
if (payload.eventType === 'INSERT') setSecrets((s) => appendUniqueById(s, payload.new))
else if (payload.eventType === 'UPDATE') setSecrets((s) => s.map((x) => (x.id === payload.new.id ? payload.new : x)))
else if (payload.eventType === 'DELETE') setSecrets((s) => s.filter((x) => x.id !== payload.old.id))
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

// Turn order used to be its own left-rail card; merged into the Party
// panel below so "whose turn is it" and "how's the party doing" live in
// one place. actingEntry can be a monster -- turn order includes visible
// monsters too, not just party members (see GmDashboard.jsx's
// rollInitiative) -- so when it's a monster's turn there's no party row
// to highlight; that gets its own small line instead of silently
// disappearing.
const actingEntry = turnOrder.find((t) => t.status === 'acting') || null
const actingIsMonster = actingEntry ? !party.some((p) => p.id === actingEntry.id) : false
const myCharacter = party.find((p) => p.owner_user_id === user?.id) || null

// Player self-movement (Phase 3 build order item 4, user decision:
// one zone-step per turn, not free movement). myTurnEntry is my own
// turn_order entry (carries the per-turn moved/acted flags move_
// character_zone reads/writes); canMove gates both the ZoneScene
// moveRestriction below and the "your turn to move" hint under the map.
const myTurnEntry = myCharacter ? turnOrder.find((t) => t.id === myCharacter.id) : null
const canMove = Boolean(myCharacter && actingEntry?.id === myCharacter.id && myTurnEntry && !myTurnEntry.moved)
const isSurprised = myTurnEntry?.status === 'surprised'
const ADJACENT_ZONES = { close: ['near'], near: ['close', 'far'], far: ['near'] }
const myAdjacentZones = myCharacter ? ADJACENT_ZONES[myCharacter.zone || 'near'] || ['close', 'near', 'far'] : []

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

// The Scene/Map/Split view toggle was removed per direct user feedback --
// scene and log always render together now. These stay as named consts
// since the rest of this file already branches on them.
const showMapPane = true
const showLogPane = true

// Precomputed once for DiceRoller's Stabilize panel (used for both the
// empty-state check and the target select's option list).
const dyingParty = party.filter((p) => p.status === 'dying')

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

// Player self-movement -- move_character_zone (server-side) re-validates
// everything this component already gates the UI on (it's my turn, I
// haven't moved yet, the target zone is adjacent), so a stale client
// state can't actually move a character out of turn. characters.zone and
// turn_order.order_list both update via the existing realtime channel,
// same as when the GM sets a zone -- no local state patch needed here.
const handleSetZone = async (type, id, zone) => {
  if (type !== 'character' || !myCharacter || id !== myCharacter.id || moving) return
  setMoving(true)
  setMoveError(null)
  const { data, error } = await supabase.rpc('move_character_zone', {
    p_campaign_id: campaignId,
    p_character_id: id,
    p_zone: zone,
  })
  setMoving(false)
  if (error) {
    setMoveError(error.message || 'Could not move there.')
    return
  }
  if (data?.scene_entry) {
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

// Every entry (narration, GM lines, rolls, and party chat) renders
// through one shared feed now -- see the CENTER column below. This used
// to be split into two permanent side-by-side panels (Scene log / Party
// chat) for human-GM campaigns, with only AI-GM campaigns getting this
// unified treatment; that split is exactly what read as "two different
// windows" against the mockup's single conversation feed, so both GM
// types now share the one feed AI-GM campaigns already had working.
const renderChatBubble = (entry) => {
if (entry.type === 'ai_gm') {
return (
<div key={entry.id} className="flex justify-start">
<div className="max-w-[85%] bg-ai/10 border border-ai/20 rounded-xl px-4 py-3">
<p className="font-medium text-ai-text flex items-center gap-2 mb-1 text-xs">
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
<div className={`max-w-[75%] rounded-xl px-4 py-2 ${isMine ? 'bg-primary/20' : 'bg-panel2'}`}>
{!isMine && <p className="text-[11px] font-medium text-ink-dim mb-1" style={party.find((p) => p.owner_user_id === entry.sender_user_id)?.color ? { color: party.find((p) => p.owner_user_id === entry.sender_user_id).color } : undefined}>{entry.sender_name}</p>}
<p className="text-sm text-ink whitespace-pre-wrap">{entry.text}</p>
</div>
</div>
)
}

return (
<div className="h-screen flex flex-col overflow-hidden">
<div className="shrink-0 max-w-6xl mx-auto w-full px-6 pt-6 pb-3 flex items-center justify-between">
<div className="flex items-center gap-3">
<p className="text-white font-medium">{campaignName}</p>
<span className="text-[10px] px-2 py-1 rounded bg-positive/20 text-positive-text border border-positive/40">Live now</span>
</div>
<div className="flex items-center gap-2">
<div className="flex items-center -space-x-2 mr-1">
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
<Button onClick={onOpenGmView}>GM view</Button>
)}
/>
</div>
</div>

{myCharacter && (
<div className="shrink-0 max-w-6xl mx-auto w-full px-6 pb-3 grid grid-cols-3 sm:grid-cols-5 gap-2">
<StatTile label="HP">
<p className="text-lg font-semibold text-white">
<span className={myCharacter.hp <= myCharacter.max_hp * 0.3 ? 'text-danger-text' : 'text-positive-text'}>{myCharacter.hp}</span>
<span className="text-ink-dim"> / {myCharacter.max_hp}</span>
</p>
</StatTile>
<StatTile label="AC">
<p className="text-lg font-semibold text-white">{myCharacter.ac}</p>
</StatTile>
<StatTile label="Gear">
<p className="text-lg font-semibold text-warning-text">{gearUsed}<span className="text-ink-dim"> / {gearCapacity}</span></p>
</StatTile>
<StatTile label="LUCK" icon={Sparkles} highlight={Boolean(myCharacter?.luck_tokens)}>
<p className={`text-lg font-semibold ${myCharacter?.luck_tokens ? 'text-primary-text' : 'text-ink-faint'}`}>
{myCharacter?.luck_tokens ?? 0}
</p>
</StatTile>
<StatTile label="TORCH" icon={Flame} highlight={litSources[0]?.lit}>
{litSources[0]?.lit ? (
<p className="text-sm font-semibold text-warning-text">
{formatMinutes(litSources[0].remaining)}
<span className="text-ink-dim font-normal"> · {party.find((p) => p.id === litSources[0].character_id)?.name || '—'}</span>
</p>
) : (
<p className="text-sm text-ink-dim">Unlit</p>
)}
</StatTile>
</div>
)}

<div className="flex-1 overflow-y-auto md:overflow-hidden md:min-h-0">
<div className="max-w-6xl mx-auto w-full px-6 pb-4 md:h-full md:flex md:flex-col md:min-h-0">
{gmType === 'ai' && aiTurnError && (
<div className="mb-3 flex items-start gap-2 text-danger-text text-xs bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
<AlertCircle size={14} className="mt-1 flex-shrink-0" />
<p>{aiTurnError}</p>
</div>
)}

{/* Below md, this is a normal stacked grid and the outer page scrolls --
cramming three independently-tall columns into one screen height only
makes sense once there's room for them side by side. At md+, the row
is height-locked to whatever's left below the header/HP bar so nothing
here forces the whole page to scroll; each column scrolls internally
instead (see md:overflow-y-auto below), and the CENTER column further
splits 2:1 between the map and the Scene log per explicit user request. */}
<div className="grid grid-cols-1 md:grid-cols-[190px_1fr_220px] gap-3 mb-3 items-start md:items-stretch md:flex-1 md:min-h-0 md:grid-rows-[1fr]">
{/* LEFT RAIL: my character */}
<div className="flex flex-col gap-3 md:h-full md:min-h-0 md:overflow-y-auto">
{myCharacter ? (
<>
<div className="bg-panel border border-line-soft rounded-lg p-3">
<p className="text-sm font-medium text-white">{myCharacter.name}</p>
<p className="text-[11px] text-ink-dim">Level {myCharacter.level} &middot; {myCharacter.class}</p>
</div>

<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-2">Quick actions</p>
<div className="flex flex-col gap-2">
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
</div>

{/* CENTER: scene + log + composer helpers. At md+, the map and Scene
log cards split the column 2:1 (flex-[2] / flex-1) per explicit user
request, so together they always exactly fill this column's height
rather than however tall their content happens to be. */}
<div className="flex flex-col gap-3 min-w-0 md:h-full md:min-h-0">
{showMapPane && (
<Card className="md:flex-[2] md:min-h-0 md:flex md:flex-col" bodyClassName="md:flex-1 md:min-h-0 md:flex md:flex-col">
{/* No card title/header here, matching GmDashboard's map panel -- a
map is self-explanatory, per direct user feedback (see GmDashboard.jsx),
and this card previously had its own "Scene" label plus disabled
Zoom/Light placeholder buttons that GmDashboard's never had; dropped
here too so the frame around the map -- not just ZoneScene itself --
renders identically on both screens. */}
{/* Clocks used to be their own stacked right-rail card, competing for
the same vertical space as Party/Known details/Objective -- moved to
an overlay on the map itself, since that's screen real estate the
scene image already owns and the mockup treats a clock as something
you glance at while looking at the scene, not a separate list. */}
<div className="relative md:flex-1 md:min-h-0">
<ZoneScene
mapUrl={mapUrl}
mapAccessError={mapAccessError}
party={party}
monsters={monsters}
secrets={secrets}
litCharacterId={litCharacterId}
onSetZone={handleSetZone}
moveRestriction={canMove ? { tokenId: myCharacter.id, allowedZones: myAdjacentZones } : { tokenId: '__none__', allowedZones: [] }}
/>
{canMove && (
<div className="absolute bottom-2 left-2 max-w-[220px] bg-bg/90 backdrop-blur border border-line-soft rounded-lg px-3 py-2">
<p className="text-[10px] text-primary-text">
{moving ? 'Moving\u2026' : `Your turn \u2014 right-click your token to move (${myAdjacentZones.map((z) => z[0].toUpperCase() + z.slice(1)).join(' or ')}).`}
</p>
{moveError && <p className="text-[10px] text-danger-text mt-1">{moveError}</p>}
</div>
)}
{isSurprised && (
<div className="absolute bottom-2 left-2 max-w-[220px] bg-bg/90 backdrop-blur border border-line-soft rounded-lg px-3 py-2">
<p className="text-[10px] text-ink-dim">You&rsquo;re surprised \u2014 wait for the surprise round to end before you can act.</p>
</div>
)}
{activeClocks.length > 0 && (
<div className="absolute top-2 right-2 max-w-[180px] bg-bg/90 backdrop-blur border border-line-soft rounded-lg p-3">
<p className="text-[10px] text-ink-dim mb-2 uppercase tracking-wide">Clocks</p>
<div className="flex flex-col gap-2">
{activeClocks.map((c) => (
<div key={c.id}>
<div className="flex items-center justify-between mb-1">
<span className={`text-[11px] truncate ${c.segments_filled > 0 ? 'text-ink' : 'text-ink-dim'}`}>{c.name}</span>
<span className="text-[10px] text-ink-dim shrink-0 ml-2">{c.segments_filled}/{c.segments_total}</span>
</div>
<ProgressBar mode="segmented" segments={c.segments_total} filled={c.segments_filled} tone="amber" />
</div>
))}
</div>
</div>
)}
</div>
</Card>
)}

<Modal open={showDiceModal} onClose={() => setShowDiceModal(false)} title="Dice & combat">
<DiceRoller
rollState={rollState}
rollNonce={rollNonce}
onRollQuickDie={rollQuickDie}
notationInput={notationInput}
setNotationInput={setNotationInput}
rollMode={rollMode}
setRollMode={setRollMode}
reasonInput={reasonInput}
setReasonInput={setReasonInput}
onRollCustom={rollCustom}
rollError={rollError}
manualDie={manualDie}
setManualDie={setManualDie}
manualValue={manualValue}
setManualValue={setManualValue}
onLogManualRoll={logManualRoll}
monsters={monsters}
attackTargetId={attackTargetId}
setAttackTargetId={setAttackTargetId}
attackNotation={attackNotation}
setAttackNotation={setAttackNotation}
damageNotation={damageNotation}
setDamageNotation={setDamageNotation}
onResolveAttack={resolveAttack}
attacking={attacking}
attackError={attackError}
dyingParty={dyingParty}
stabilizeTargetId={stabilizeTargetId}
setStabilizeTargetId={setStabilizeTargetId}
stabilizeNotation={stabilizeNotation}
setStabilizeNotation={setStabilizeNotation}
onResolveStabilize={resolveStabilize}
stabilizing={stabilizing}
stabilizeError={stabilizeError}
/>
</Modal>

{showLogPane && (
<div className="bg-panel rounded-lg p-4 md:flex-1 md:min-h-0 md:flex md:flex-col">
<p className="text-xs text-ink-dim mb-2">{gmType === 'ai' ? 'AI GM' : 'Scene log'}</p>
<div ref={sceneLogRef} className="min-h-[160px] max-h-[280px] md:min-h-0 md:max-h-none md:flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
{log.length === 0 && (
<p className="text-xs text-ink-dim text-center mt-4">
{gmType === 'ai'
? "Nothing has happened yet. Say or do something below, then hit Continue when the party's ready."
: 'Nothing has happened yet. Say or do something below.'}
</p>
)}
{log.map((entry) => renderChatBubble(entry))}
{aiTurnPending && (
<div className="flex justify-start">
<div className="max-w-[85%] bg-panel2/70 border border-line rounded-xl px-4 py-3">
<p className="font-medium text-ink flex items-center gap-2 mb-1 text-xs">
<Loader2 size={12} className="animate-spin" /> Pending adjudication
</p>
<p className="text-xs text-ink-dim mb-2">The AI GM is resolving what happens next.</p>
<div className="flex gap-2">
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
)}
</div>

{/* RIGHT RAIL: current scene / known details / objective / party */}
<div className="flex flex-col gap-3 md:h-full md:min-h-0 md:overflow-y-auto">
<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-2">Current scene</p>
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
<div className="flex flex-col gap-2">
{gmNotes.map((n) => (
<div key={n.id} className="flex items-start gap-2 text-[11px] text-ink border border-line-soft rounded-md px-2 py-2">
<HelpCircle size={11} className="text-ink-dim mt-1 shrink-0" />
<span>{n.text}</span>
</div>
))}
</div>
)}
</div>

{objective && (
<div className="bg-panel rounded-lg p-3">
<p className="text-xs text-ink-dim mb-2">Objective</p>
<p className="text-sm text-ink">{objective.title}</p>
</div>
)}

{/* Clocks moved to a map overlay above (see the CENTER column's
ZoneScene wrapper) so they no longer stack in this rail as their own
card. */}

<div className="bg-panel rounded-lg p-3">
<div className="flex items-center justify-between mb-2">
<p className="text-xs text-ink-dim">Party</p>
{/* actingEntry can be a monster, which has no row of its own below --
this is the only place that turn gets surfaced. */}
{actingIsMonster && (
<span className="text-[10px] text-primary-text bg-primary/10 border border-primary/30 rounded-full px-2 py-1 truncate max-w-[55%]">
{actingEntry.name}&rsquo;s turn
</span>
)}
</div>
{party.length === 0 && <p className="text-[11px] text-ink-dim">No characters in this campaign yet.</p>}
<div className="flex flex-col gap-2">
{party.map((p) => {
const isActing = actingEntry?.id === p.id
const isPartySurprised = turnOrder.find((t) => t.id === p.id)?.status === 'surprised'
const light = lightSources.find((s) => s.character_id === p.id)
const lightRemaining = light?.lit ? displayedMinutes(light, nowTick) : null
return (
<div key={p.id} className={`border rounded-md p-2 ${isActing ? 'border-primary bg-primary/10' : 'border-line-soft'}`}>
<button
onClick={() => onOpenCharacterSheet && onOpenCharacterSheet(p.id)}
disabled={!onOpenCharacterSheet}
className="w-full text-left disabled:cursor-default"
>
<div className="flex items-center justify-between mb-1">
<div className="flex items-center gap-2 min-w-0">
{p.avatar_url ? (
<img src={p.avatar_url} alt={p.name} className="w-5 h-5 rounded-full object-cover border border-line shrink-0" />
) : (
<div
className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium text-white shrink-0"
style={{ backgroundColor: p.color || '#3f3f46' }}
>
{p.name?.[0]?.toUpperCase() || '?'}
</div>
)}
<span className="text-xs font-medium text-white truncate">{p.name}</span>
{isActing && (
<span className="text-[9px] uppercase tracking-wide text-primary-text bg-primary/20 rounded-full px-2 py-1 shrink-0">Acting</span>
)}
{isPartySurprised && (
<span className="text-[9px] uppercase tracking-wide text-ink-dim bg-line/40 rounded-full px-2 py-1 shrink-0">Surprised</span>
)}
</div>
<span className="text-[11px] text-ink-dim shrink-0">{p.hp}/{p.max_hp}</span>
</div>
<ProgressBar value={p.hp} max={p.max_hp} barClassName={hpBarColor(p.hp, p.max_hp)} trackBg="bg-danger/40" heightClassName="h-1" />
</button>
{lightRemaining !== null && (
<div className="mt-2">
<div className="flex items-center justify-between mb-1">
<span className="text-[9px] text-warning-text flex items-center gap-1"><Flame size={9} /> Torch</span>
<span className="text-[9px] text-ink-dim">{formatMinutes(lightRemaining)}</span>
</div>
<ProgressBar value={lightRemaining} max={light.total_minutes} tone="amber" heightClassName="h-1" />
</div>
)}
{p.status && p.status !== 'alive' && (
<span className={`inline-block mt-2 text-[9px] uppercase tracking-wide px-2 py-1 rounded-full border ${
p.status === 'dying' ? 'border-danger text-danger-text' : p.status === 'stable' ? 'border-warning text-warning-text' : 'border-line text-ink-dim'
}`}>
{p.status === 'dying' ? `Dying (${p.death_timer ?? '?'})` : p.status}
</span>
)}
{p.status === 'dying' && (
<button
onClick={() => rollDeathCheck(p.id)}
disabled={deathCheckPendingId === p.id}
className="mt-2 w-full text-[11px] border border-danger/60 text-danger-text rounded-md py-1 hover:bg-danger/40 disabled:opacity-50"
>
{deathCheckPendingId === p.id ? 'Rolling…' : 'Roll death check'}
</button>
)}
</div>
)
})}
</div>
</div>
</div>
</div>
</div>
</div>

<Footer>
<div className="max-w-6xl mx-auto w-full px-6 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_220px] gap-3 items-center">
<input
value={message}
onChange={(e) => setMessage(e.target.value)}
onKeyDown={(e) => e.key === 'Enter' && (gmType === 'ai' ? sendAndAskAiGm() : sendMessage())}
placeholder="Say or do something"
className="min-w-0 bg-panel border border-line rounded-md px-3 py-2 text-sm text-white"
/>
<Button iconOnly icon={Dices} onClick={() => setShowDiceModal(true)} title="Roll dice / Attack / Stabilize" />
<Button iconOnly icon={Mic} disabled title="Voice input isn't wired up yet -- placeholder" />
{onOpenLibrary && (
<Button icon={HelpCircle} onClick={onOpenLibrary}>Ask a rule</Button>
)}
{gmType === 'ai' ? (
<button
onClick={sendAndAskAiGm}
disabled={aiTurnPending}
className="text-sm border border-ai/40 bg-ai/10 rounded-md px-4 py-2 flex items-center justify-center gap-2 text-ai-text hover:bg-ai/20 disabled:opacity-60 whitespace-nowrap"
>
{aiTurnPending ? <Loader2 size={15} className="animate-spin" /> : message.trim() ? <Send size={15} /> : <Bot size={15} />}
{aiTurnPending ? 'Thinking…' : message.trim() ? 'Send' : 'Continue'}
</button>
) : (
<Button icon={Send} onClick={sendMessage}>Send</Button>
)}
</div>
</Footer>
</div>
)
}
