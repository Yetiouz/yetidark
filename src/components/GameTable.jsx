import { useState, useEffect, useRef } from 'react'
import { Dices, Send, AlertCircle, User, Settings, ScrollText, BookOpen, Users, Bot, Loader2, Flame } from 'lucide-react'
import ZoneScene from './ZoneScene.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { flatDieNotation } from '../lib/dice.js'
import { useCampaignMapUrl } from '../lib/useCampaignMapUrl.js'
import { appendUniqueById } from '../app/realtimeCollections.js'

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
// Layout: fixed-viewport shell (header / scrollable content / pinned
// composer) instead of one long scrolling page. The composer at the
// bottom is a single input + action button shared by both GM modes, laid
// out in the same 1fr/220px grid as the Map/sidebar row above it so it
// spans the full width and lines up with those columns regardless of how
// far the content above has scrolled.
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

useEffect(() => {
return () => {
if (rollTimerRef.current) clearInterval(rollTimerRef.current)
}
}, [])

const [mapInfo, setMapInfo] = useState(null)
const [turnOrder, setTurnOrder] = useState([])
const [votes, setVotes] = useState([])
const [party, setParty] = useState([])
const [gmType, setGmType] = useState(null) // 'human' | 'ai'
const [aiTurnPending, setAiTurnPending] = useState(false)
const [aiTurnError, setAiTurnError] = useState(null)
const { url: mapUrl, error: mapAccessError } = useCampaignMapUrl(mapInfo)

// Status rail: the open thread standing in as "current objective", plus
// clocks and light sources -- all three already existed (and were already
// member-readable) but only surfaced in Campaign Log, behind an icon-only
// toolbar button. This is the minimal, read-only glance version of that
// same data on the table itself; editing still happens in Campaign Log.
const [threads, setThreads] = useState([])
const [clocks, setClocks] = useState([])
const [lightSources, setLightSources] = useState([])
const [monsters, setMonsters] = useState([])
const [nowTick, setNowTick] = useState(() => Date.now())

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
.select('map_path, map_url, map_cols, map_rows, party_row, party_col, gm_type')
.eq('id', campaignId)
.maybeSingle()
.then(({ data }) => {
if (cancelled) return
setMapInfo(data)
setGmType(data?.gm_type || null)
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
.select('id, name, class, level, hp, max_hp, ac, avatar_url, color, zone, owner_user_id, status, death_timer')
.eq('campaign_id', campaignId)
.order('created_at', { ascending: true })
.then(({ data }) => { if (!cancelled) setParty(data || []) })

supabase
.from('campaign_threads')
.select('id, title, status, created_at')
.eq('campaign_id', campaignId)
.eq('status', 'open')
.order('created_at', { ascending: true })
.then(({ data }) => { if (!cancelled) setThreads(data || []) })

supabase
.from('campaign_clocks')
.select('id, name, segments_filled, segments_total, created_at')
.eq('campaign_id', campaignId)
.then(({ data }) => { if (!cancelled) setClocks(data || []) })

supabase
.from('campaign_light_sources')
.select('id, name, character_id, lit, lit_at, remaining_minutes, total_minutes')
.eq('campaign_id', campaignId)
.then(({ data }) => { if (!cancelled) setLightSources(data || []) })

supabase
.from('encounter_monsters')
.select('id, name, zone, hidden')
.eq('campaign_id', campaignId)
.then(({ data }) => { if (!cancelled) setMonsters(data || []) })

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
{ event: '*', schema: 'public', table: 'campaign_clocks', filter: `campaign_id=eq.${campaignId}` },
(payload) => {
if (payload.eventType === 'INSERT') setClocks((c) => appendUniqueById(c, payload.new))
else if (payload.eventType === 'UPDATE') setClocks((c) => c.map((x) => (x.id === payload.new.id ? payload.new : x)))
else if (payload.eventType === 'DELETE') setClocks((c) => c.filter((x) => x.id !== payload.old.id))
}
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
{ event: '*', schema: 'public', table: 'encounter_monsters', filter: `campaign_id=eq.${campaignId}` },
(payload) => {
if (payload.eventType === 'INSERT') setMonsters((m) => appendUniqueById(m, payload.new))
else if (payload.eventType === 'UPDATE') setMonsters((m) => m.map((x) => (x.id === payload.new.id ? payload.new : x)))
else if (payload.eventType === 'DELETE') setMonsters((m) => m.filter((x) => x.id !== payload.old.id))
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
