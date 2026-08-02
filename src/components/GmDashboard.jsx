import { useState, useEffect, useRef } from 'react'
import {
  Eye, EyeOff, Plus, Upload, Dices, SkipForward, Flame, AlertTriangle, RotateCw, Timer, Sun, CloudFog,
  Target, Mic, Paperclip, Megaphone, Lock, Pause, Play, HelpCircle, Swords, Shuffle, Gauge, Users, Gem,
  Skull, StickyNote,
} from 'lucide-react'

import ZoneScene from './ZoneScene.jsx'
import ProgressBar from './ui/ProgressBar.jsx'
import Card from './ui/Card.jsx'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import Row from './ui/Row.jsx'
import Modal from './ui/Modal.jsx'
import Footer from './ui/Footer.jsx'
import LogEntry from './LogEntry.jsx'
import CampaignToolbar from './CampaignToolbar.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { campaignMapPath, useCampaignMapUrl } from '../lib/useCampaignMapUrl.js'
import { abilityModifier } from '../game/rules/character.js'
import { useCampaignSession, useProfileDisplayName } from '../lib/useCampaignSession.js'

// Mirrors GameTable.jsx's minute formatting -- kept local here rather
// than shared since this is the only other screen that needs it.
function formatMinutes(totalMin) {
const clamped = Math.max(0, totalMin)
const h = Math.floor(clamped / 60)
const m = Math.floor(clamped % 60)
const s = Math.floor((clamped * 60) % 60)
if (h > 0) return `${h}h ${m}m`
return `${m}m ${s}s`
}

function displayedMinutes(source, nowMs) {
if (source.lit && source.lit_at) {
const elapsed = (nowMs - new Date(source.lit_at).getTime()) / 60000
return Math.max(0, source.remaining_minutes - elapsed)
}
return source.remaining_minutes
}

// Mirrors GameTable.jsx's Party HP bar coloring -- same thresholds, kept
// local here for the same reason formatMinutes/displayedMinutes are.
function hpBarColor(hp, maxHp) {
const pct = maxHp ? hp / maxHp : 0
if (pct > 0.6) return 'bg-positive'
if (pct > 0.3) return 'bg-warning'
return 'bg-danger'
}

// Rebuilt to match the delve-gm-dashboard-visual mockup's actual structure
// (status strip of individual bordered cards, 3-column body, shared
// ui/ components as the implementation vocabulary) rather than the prior
// hand-styled-everywhere version -- same standing directive as the
// Character Sheet's Gear rebuild: the artifact's layout wins, built with
// Card/Badge/Button/Row/ProgressBar.
//
// Everything here is real Supabase data, synced live: the encounter
// tracker, GM notes, turn order, the scene log, the zone map, and (new in
// this pass) the campaign's session_active toggle -- the real backend
// behind the mockup's "Pause torch" control (it's session-wide, pausing
// every light source's burn-down and not just one torch, so the button is
// labeled "Pause session" / "Resume session" rather than the mockup's
// literal wording, to stay accurate to what it actually does).
//
// Danger level, crawling-round tracking, the next-encounter-check
// countdown, a per-entity trap stat block, and the map's Secrets/Light/Fog/
// Reveal-area toggles have no schema behind them yet -- per explicit
// direction (AskUserQuestion, picked "add honest placeholder cards"),
// those stay as visible placeholder UI (dimmed, disabled, honest empty
// states) rather than being omitted, matching the artifact's shape without
// fabricating data. "Quick tables" are real dice-engine shortcuts (a flat
// roll with a label), not lookup tables Delve doesn't have data for.
// Clocks & threats, the Encounter sidebar list, and Preview player view
// are all real.
//
// The mockup's composer also has an unlabeled hex/die icon whose function
// isn't identifiable from the mockup alone -- left out rather than guessed
// at. The book icon is real: it's the same "Ask a rule" -> Rules Library
// link the Player Table composer already has (onOpenLibrary), just not
// previously wired up here.
//
// Brought into closer parity with GameTable.jsx (the player page) per
// direct user feedback: the body wrapper's max-w-6xl/px-6 shell now matches
// exactly (a misplaced px-6 on the outer scroll container instead of the
// inner max-width box was pushing this screen's content ~24px out of
// alignment with its own header/status strip above -- same bug class as the
// Character Sheet's width fix). The standalone "Turn order" badge list is
// gone; whose-turn-is-it is now shown the same way the player page shows
// it -- a highlighted border + "Acting" badge on the acting party member,
// with a small banner for a monster's turn -- both merged into the Party
// card. Clocks moved off their own right-rail card and onto the map image
// itself as an overlay, matching the player page's map exactly (the GM's
// map still carries its own extra layers on top -- Secrets/Light/Fog
// placeholders, map upload, zone assignment, Preview player view -- that's
// the "different view levels" the GM needs that the player doesn't). Card
// placement was also brought as close to the player page's rail layout as
// the content allows: Party now sits in the right rail, last, the same
// position it holds on the player page, instead of the left rail.
//
// The Scene/Map/Encounter tab switcher is gone, per direct user feedback --
// the user has a bigger map redesign planned later, and for now just wants
// the Map and Active encounter cards always visible and stacked (same
// tabs-to-one-page precedent as the Character Sheet) rather than gated
// behind a tab. The Map card's Preview player view / Secrets / Light / Fog
// controls are now small icon-only toggles instead of labelled buttons, per
// direct request ("no need for big buttons"). Per-character/monster zone
// assignment (Close/Near/Far) is no longer an always-visible button list
// below the map -- it's a right-click context menu on each token now (see
// ZoneScene.jsx's onSetZone), which is GM-only (GameTable.jsx never passes
// onSetZone, so players still get the browser's normal right-click menu).
//
// Scene controls / Active encounter have moved several times now (own
// left-rail card -> folded into Active encounter -> horizontal header
// strip -> a shrunk mini-card next to that strip) -- per the user's own
// framing, that's because the layout was still being actively explored,
// not because earlier placements were wrong. This pass is the real
// consolidation: the left rail is now the actual "run the encounter"
// console -- a "Scene controls" card (turn indicator + Advance round /
// Pause-or-Resume session / Start encounter / Reveal area / Reveal hidden
// monster) stacked above an "Active encounter" card (the real Add-monster
// input and full monster list, HP +/- and zone controls included, not a
// shrunk stand-in). The header's icon strip and mini-card from the last
// few passes are gone -- their content lives here now, all in one place,
// matching the user's own reasoning ("that is what you use to run
// encounters"). "Quick tables" (Random encounter/Reaction/Morale/
// Treasure) and "Request a roll" moved out of the left rail entirely and
// into a new on-demand dice modal, mirroring GameTable.jsx's dice/Attack/
// Stabilize modal -- opened from a new dice icon in the composer footer,
// same `Modal.jsx` component, so dice actions stop permanently occupying
// rail space the same way GameTable.jsx already stopped doing for the
// player page. The left rail widened (190px -> 260px) to fit the fuller
// monster cards reasonably; the center column's own "Active encounter"
// card is gone -- monsters still render as tokens on the map via
// ZoneScene same as always, and the left rail is now the one place their
// full stat list lives, so nothing is duplicated across rails/columns.
//
// The CENTER column's Map and Scene log cards now adopt the same 2:1
// height-locked split GameTable.jsx's player page has used since PR #69:
// at md+, the whole body below the header/status strip stops page-
// scrolling and instead locks to the remaining viewport height, each rail
// scrolls independently, and the Map/Scene log cards split that height
// 2:1 (flex-[2] / flex-1) so together they always exactly fill the column
// instead of however tall their content happens to be. Below md it's a
// normal stacked, page-scrolling grid, same reasoning as the player page:
// three independently-tall columns only make sense locked to one screen
// height once they're side by side.
//
// RIGHT RAIL, another round of direct feedback: the standalone "Trap
// details" placeholder card is gone -- traps are now a disabled icon
// toggle in the Map card's icon row (next to Secrets/Light/Fog, same
// still-a-placeholder honesty as those, per PR #79/#81), rather than a
// whole card for a feature that isn't built yet. "GM notes (private,
// general)" is gone from the rail too -- it's now an on-demand modal
// opened via a new icon in the header next to Campaign log/Rules library,
// same idea as the dice modal above (all the same note state/handlers,
// just relocated). And the rail order changed: Selected now sits last,
// below Party, a deliberate departure from matching GameTable.jsx's rail
// order (Party last) that PR #80 established -- this was a direct,
// explicit instruction, not an oversight.
//
// PARTY CARD, per direct instruction ("Party card on Gm and player should
// be the same"): each character row now matches GameTable.jsx's Party row
// exactly -- a real HP `ProgressBar` (color-coded via the same
// `hpBarColor` thresholds) instead of plain HP/AC text, a per-character
// amber Torch bar when that character has a lit light source (using the
// same `lightSources`/`displayedMinutes` data this file already read for
// the header Torch card), a "Dying (timer)"/"stable" status pill instead
// of a plain alive/dying dot, and a "Roll death check" button for dying
// characters (calls the same `resolve_dying_turn` RPC the player page
// calls -- it takes an explicit character_id, so the GM triggering it
// here is the same real action, not a new code path). AC is no longer
// shown here -- GameTable.jsx's Party card never showed it either, and
// matching means matching, not matching-plus-extra. The outer `Card`
// wrapper (title="Party") stays, for consistency with this rail's other
// cards; only the per-character content changed.
export default function GmDashboard({ campaignId, session, campaignName = 'The sunken keep', onSwitchToPlayerView, onOpenCharacterSheet, onOpenSettings, onOpenLog, onOpenLibrary, onOpenTracker }) {
  const user = session?.user
  const displayName = useProfileDisplayName(user, 'GM')
  const [encounter, setEncounter] = useState([])
  const [notes, setNotes] = useState([])
  const [noteDraft, setNoteDraft] = useState('')
  const [entityNoteDraft, setEntityNoteDraft] = useState('')
  // Whatever's currently selected on the map -- a party token or a monster
  // token. Drives the "Selected" rail panel below: persistent notes attach
  // to this entity instead of sitting in one flat list, per the confirmed
  // design decision. Traps/features aren't real entities yet (no table for
  // them), so selection is character/monster only for now.
  const [selectedEntity, setSelectedEntity] = useState(null) // { type: 'character' | 'monster', id, name }
  const [monsterDraft, setMonsterDraft] = useState('')
  const [message, setMessage] = useState('')
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [composeMode, setComposeMode] = useState('public') // 'public' -> scene_log, 'private' -> gm_notes
  // Quick tables / Request a roll used to sit permanently in the left rail
  // and header; now behind an on-demand modal opened from the composer's
  // dice icon, same pattern as GameTable.jsx's dice/Attack/Stabilize modal.
  const [showDiceModal, setShowDiceModal] = useState(false)
  // GM notes (general, private) used to be a permanently-visible right-rail
  // card; now behind an on-demand modal opened from a header icon next to
  // Campaign log/Rules library, same on-demand-icon pattern as the dice
  // modal above and PR #86's left-rail consolidation.
  const [showNotesModal, setShowNotesModal] = useState(false)
  const [sessionActive, setSessionActive] = useState(false)
  const [togglingSession, setTogglingSession] = useState(false)
  // Party card parity with GameTable.jsx: which dying character (if any)
  // has a death-check roll in flight, same state name/shape as the player
  // page's own deathCheckPendingId.
  const [deathCheckPendingId, setDeathCheckPendingId] = useState(null)
  const sceneLogRef = useRef(null)

  // Only matters while a torch is actually burning, but a cheap 1s
  // interval the whole time this screen is open is simplest.
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const {
    log, setLog,
    mapInfo, setMapInfo,
    turnOrder, setTurnOrder,
    party, setParty,
    clocks,
    lightSources,
  } = useCampaignSession(campaignId, { channelKey: 'gm-dashboard' })
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [moraleChecking, setMoraleChecking] = useState(false)
  const [requestingRoll, setRequestingRoll] = useState(false)
  const [quickRolling, setQuickRolling] = useState(false)
  const fileInputRef = useRef(null)
  const { url: mapUrl, error: mapAccessError } = useCampaignMapUrl(mapInfo)

  // Second channel for the tables this screen reads/writes very
  // differently from the player table: encounter_monsters (full read/write
  // here vs. GameTable's read-only subset), gm_notes (all notes, revealed
  // or not, including entity_type/entity_id -- GameTable only ever sees
  // revealed ones), and campaigns.session_active (the real "pause" state
  // behind the mockup's torch-pause control). Everything else lives in
  // useCampaignSession.
  useEffect(() => {
    if (!campaignId) return
    let cancelled = false

    supabase
      .from('encounter_monsters')
      .select('id, name, ac, hp, max_hp, hidden, zone, dex_mod')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setEncounter(data || []) })

    supabase
      .from('gm_notes')
      .select('id, text, revealed, entity_type, entity_id')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setNotes(data || []) })

    supabase
      .from('campaigns')
      .select('session_active')
      .eq('id', campaignId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setSessionActive(data?.session_active || false) })

    const channel = supabase
      .channel(`gm-dashboard-extra-${campaignId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'encounter_monsters', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setEncounter((list) => [...list, payload.new])
          else if (payload.eventType === 'UPDATE') setEncounter((list) => list.map((m) => (m.id === payload.new.id ? payload.new : m)))
          else if (payload.eventType === 'DELETE') setEncounter((list) => list.filter((m) => m.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gm_notes', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setNotes((list) => [...list, payload.new])
          else if (payload.eventType === 'UPDATE') setNotes((list) => list.map((n) => (n.id === payload.new.id ? payload.new : n)))
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${campaignId}` },
        (payload) => setSessionActive(payload.new.session_active)
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [campaignId])

  const adjustHp = async (monster, delta) => {
    const nextHp = Math.max(0, Math.min(monster.max_hp, monster.hp + delta))
    setEncounter((list) => list.map((m) => (m.id === monster.id ? { ...m, hp: nextHp } : m)))
    await supabase.from('encounter_monsters').update({ hp: nextHp }).eq('id', monster.id)
  }

  const revealMonster = async (id) => {
    setEncounter((list) => list.map((m) => (m.id === id ? { ...m, hidden: false } : m)))
    await supabase.from('encounter_monsters').update({ hidden: false }).eq('id', id)
  }

  // Selected panel's Hidden/Visible badge toggle -- same direct GM-only
  // write path adjustHp/revealMonster above already use.
  const toggleMonsterHidden = async (monster) => {
    if (!monster) return
    const nextHidden = !monster.hidden
    setEncounter((list) => list.map((m) => (m.id === monster.id ? { ...m, hidden: nextHidden } : m)))
    await supabase.from('encounter_monsters').update({ hidden: nextHidden }).eq('id', monster.id)
  }

  // Party card parity with GameTable.jsx: death check, rolled on a dying
  // character's subsequent turn. Same RPC (`resolve_dying_turn`) the
  // player page already calls -- it takes an explicit character_id rather
  // than inferring the caller, so the GM triggering it here for a dying
  // party member (e.g. one who's stepped away) is the same real action,
  // not a separate code path.
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

  const addMonster = async () => {
    const name = monsterDraft.trim()
    if (!name || !campaignId) return
    const acInput = window.prompt('Armor class?', '10')
    if (acInput === null) return
    const hpInput = window.prompt('Starting / max HP?', '4')
    if (hpInput === null) return
    const dexInput = window.prompt('DEX modifier (for initiative)?', '0')
    if (dexInput === null) return
    const ac = parseInt(acInput, 10) || 10
    const hp = Math.max(1, parseInt(hpInput, 10) || 1)
    const dexMod = parseInt(dexInput, 10) || 0
    await supabase.from('encounter_monsters').insert({ campaign_id: campaignId, name, ac, hp, max_hp: hp, hidden: false, dex_mod: dexMod })
    setMonsterDraft('')
  }

  const revealNote = async (id) => {
    setNotes((list) => list.map((n) => (n.id === id ? { ...n, revealed: true } : n)))
    await supabase.from('gm_notes').update({ revealed: true }).eq('id', id)
  }

  // General notes (the panel further down) are always untagged, regardless
  // of what's selected on the map -- entity-tagged notes only come from the
  // Selected panel's own composer (addEntityNote below), so the two inputs
  // don't both silently tag notes to whatever token happens to be selected.
  const addNote = async () => {
    if (!noteDraft.trim() || !campaignId) return
    await supabase.from('gm_notes').insert({ campaign_id: campaignId, text: noteDraft.trim() })
    setNoteDraft('')
  }

  const addEntityNote = async () => {
    if (!entityNoteDraft.trim() || !campaignId || !selectedEntity) return
    await supabase.from('gm_notes').insert({
      campaign_id: campaignId,
      text: entityNoteDraft.trim(),
      entity_type: selectedEntity.type,
      entity_id: selectedEntity.id,
    })
    setEntityNoteDraft('')
  }

  // Clicking a token on the map (or in the Selected panel's own list)
  // selects it; clicking the same one again clears the selection, same
  // toggle pattern as the zone buttons elsewhere on this screen.
  const selectEntity = (type, id, name) => {
    setSelectedEntity((current) => (current?.type === type && current?.id === id ? null : { type, id, name }))
  }

  // Shadowdark initiative: highest 1d20+DEX starts. Rolls for every party
  // member + visible monster through the same dice engine as the player
  // table (auditable via dice_rolls), then the order just rotates
  // (advanceTurn below) rather than re-sorting -- clockwise, not a ranked
  // tracker that reshuffles every round.
  const rollInitiative = async () => {
    if (!campaignId) return
    const participants = [
      ...party.map((c) => ({ id: c.id, name: c.name, dexMod: abilityModifier(Number(c.stats?.dex) || 10) })),
      ...encounter.filter((m) => !m.hidden).map((m) => ({ id: m.id, name: m.name, dexMod: m.dex_mod || 0 })),
    ]
    if (participants.length === 0) return

    const rolled = (await Promise.all(
      participants.map(async (participant) => {
        const notation = `1d20${participant.dexMod >= 0 ? '+' : ''}${participant.dexMod}`
        const { data, error } = await supabase.rpc('roll_campaign_dice', {
          p_campaign_id: campaignId,
          p_notation: notation,
          p_mode: 'flat',
          p_reason: `${participant.name} — initiative`,
          p_roller_name: participant.name,
        })
        if (error) return null
        return { ...participant, result: data.roll }
      })
    )).filter(Boolean).sort((a, b) => b.result.total - a.result.total)

    const orderList = rolled.map((p, i) => ({ id: p.id, name: p.name, status: i === 0 ? 'acting' : 'waiting' }))
    setTurnOrder(orderList)
    await supabase.from('turn_order').upsert({ campaign_id: campaignId, order_list: orderList }, { onConflict: 'campaign_id' })
  }

  // Mockup's "Start encounter" -- the real action is rolling initiative
  // (there's no separate "encounter start" flag). Used to also jump the
  // center tabs over to Encounter, but the Scene/Map/Encounter tab switcher
  // is gone now (see the Map/Active encounter cards below), so there's
  // nowhere left to jump to -- both are always visible.
  const startEncounter = async () => {
    await rollInitiative()
  }

  const advanceTurn = async () => {
    if (!campaignId || turnOrder.length === 0) return
    const rotated = [...turnOrder.slice(1), turnOrder[0]].map((t, i) => ({ ...t, status: i === 0 ? 'acting' : 'waiting' }))
    setTurnOrder(rotated)
    await supabase.from('turn_order').upsert({ campaign_id: campaignId, order_list: rotated }, { onConflict: 'campaign_id' })
  }

  const setCharacterZone = async (id, zone) => {
    setParty((list) => list.map((p) => (p.id === id ? { ...p, zone } : p)))
    await supabase.from('characters').update({ zone }).eq('id', id)
  }

  const setMonsterZone = async (id, zone) => {
    setEncounter((list) => list.map((m) => (m.id === id ? { ...m, zone } : m)))
    await supabase.from('encounter_monsters').update({ zone }).eq('id', id)
  }

  // GM-triggered DC 15 WIS morale check for a monster group -- the app
  // doesn't try to auto-detect "half the group is down," that judgment
  // call stays with the GM, same as picking who/what a check applies to.
  const moraleCheck = async () => {
    if (moraleChecking) return
    const label = window.prompt('Morale check for which group?', encounter[0]?.name || 'Monsters')
    if (!label) return
    const notation = window.prompt('WIS check notation?', '1d20') || '1d20'
    setMoraleChecking(true)
    await supabase.rpc('resolve_morale_check', {
      p_campaign_id: campaignId,
      p_group_label: label,
      p_wis_notation: notation,
    })
    setMoraleChecking(false)
  }

  // "Request a roll": the GM picks who rolls and what, same authoritative
  // roll_campaign_dice command as every other app roll, just invoked on
  // someone else's behalf rather than the player's own dice card.
  const requestRoll = async () => {
    if (requestingRoll || !campaignId) return
    const roller = window.prompt('Who rolls?', party[0]?.name || 'Party')
    if (!roller) return
    const notation = window.prompt('Notation?', '1d20') || '1d20'
    const reason = window.prompt('Reason (optional)?', '') || null
    setRequestingRoll(true)
    await supabase.rpc('roll_campaign_dice', {
      p_campaign_id: campaignId,
      p_notation: notation,
      p_mode: 'flat',
      p_reason: reason,
      p_roller_name: roller,
    })
    setRequestingRoll(false)
  }

  // Quick tables: real dice-engine shortcuts under recognizable Shadowdark
  // labels. There's no random-encounter/reaction/treasure lookup-table
  // data in this app, so these just roll and log -- the GM reads the
  // result off the physical/PDF tables themselves, same as they would
  // for any other roll this app doesn't have full table data for.
  const rollQuickTable = async (label, notation) => {
    if (quickRolling || !campaignId) return
    setQuickRolling(true)
    await supabase.rpc('roll_campaign_dice', {
      p_campaign_id: campaignId,
      p_notation: notation,
      p_mode: 'flat',
      p_reason: label,
      p_roller_name: 'GM',
    })
    setQuickRolling(false)
  }

  // Real backend behind the mockup's "Pause torch" -- session_active is
  // campaign-wide (every light source's burn-down freezes, not just one
  // torch), same toggle Campaign Lobby's Start/End session and Campaign
  // Log's own pause control already use.
  const toggleSession = async () => {
    if (togglingSession || !campaignId) return
    setTogglingSession(true)
    const nextActive = !sessionActive
    const { error } = await supabase.rpc('set_campaign_session_active', {
      p_campaign_id: campaignId,
      p_active: nextActive,
    })
    if (!error) setSessionActive(nextActive)
    setTogglingSession(false)
  }

  const uploadMap = async (file) => {
    if (!file || !campaignId) return
    setUploading(true)
    setUploadError(null)
    const path = `${campaignId}/${Date.now()}-${file.name}`
    const { error: storageError } = await supabase.storage.from('maps').upload(path, file, { upsert: true })
    if (storageError) {
      setUploadError(storageError.message)
      setUploading(false)
      return
    }
    const { error: updateError } = await supabase
      .from('campaigns')
      .update({ map_path: path, map_url: null })
      .eq('id', campaignId)
    setUploading(false)
    if (updateError) {
      setUploadError(updateError.message)
      return
    }
    setMapInfo((m) => ({ ...(m || {}), map_path: path, map_url: null }))
  }

  const sendMessage = async () => {
    if (!message.trim() || !campaignId) return
    const text = message.trim()
    // Public narration -> scene_log, same as before. Private note -> the
    // GM's own gm_notes list (unrevealed until explicitly shared), reusing
    // the existing addNote path instead of inventing a new table -- this
    // just gives that real action a spot in the composer, matching the
    // mockup's Public narration / Private note toggle.
    if (composeMode === 'private') {
      setMessage('')
      await supabase.from('gm_notes').insert({ campaign_id: campaignId, text })
      return
    }
    setMessage('')
    const { data, error } = await supabase
      .from('scene_log')
      .insert({
        campaign_id: campaignId,
        type: 'gm',
        sender_user_id: user?.id,
        sender_name: displayName,
        text,
      })
      .select()
      .single()
    if (!error && data) {
      setLog((l) => (l.some((e) => e.id === data.id) ? l : [...l, data]))
    }
  }

  // "Combat" vs "Exploration" is derived, not stored -- see the same
  // comment in GameTable.jsx. A non-empty turn order is the honest
  // stand-in rather than a fabricated Danger/Mode field.
  const gmSceneMode = turnOrder.length > 0 ? 'Combat' : 'Exploration'
  const litTorch = lightSources
    .filter((s) => s.lit)
    .map((s) => ({ ...s, remaining: displayedMinutes(s, nowTick) }))
    .sort((a, b) => a.remaining - b.remaining)[0] || null

  // Same real campaign_clocks data GameTable.jsx's status rail shows the
  // party -- the GM gets it too now, sorted most-complete-first.
  const activeClocks = clocks
    .slice()
    .sort((a, b) => (b.segments_filled / b.segments_total) - (a.segments_filled / a.segments_total))
    .slice(0, 4)

  const selectedMonster = selectedEntity?.type === 'monster' ? encounter.find((m) => m.id === selectedEntity.id) : null

  // Turn indicator merged into the Party card below, matching GameTable.jsx's
  // player-page treatment (an acting party member gets a highlighted border +
  // "Acting" badge; when a monster is acting there's no party row to
  // highlight, so that gets its own small banner in the card header instead).
  // Per direct user feedback, the standalone "Turn order" list this replaced
  // doesn't come back -- whose-turn-is-it now lives in exactly one place,
  // same as the player page.
  const actingEntry = turnOrder.find((t) => t.status === 'acting') || null
  const actingIsMonster = actingEntry ? !party.some((p) => p.id === actingEntry.id) : false

  useEffect(() => {
    if (sceneLogRef.current) sceneLogRef.current.scrollTop = sceneLogRef.current.scrollHeight
  }, [log.length])

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="shrink-0 max-w-6xl mx-auto w-full px-6 pt-6 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <p className="text-white font-medium">{campaignName}</p>
          <Badge tone="purple">GM view</Badge>
          <Badge tone="green">Live now</Badge>
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
          {/* GM notes moved here from a permanent right-rail card, per
              direct user feedback -- an icon next to Campaign log/Rules
              library, same on-demand-icon idea as the dice modal below.
              GM-only, so it lives beside CampaignToolbar rather than
              inside it (that component is shared with the player page). */}
          <Button icon={StickyNote} iconOnly onClick={() => setShowNotesModal(true)} title="GM notes (private, general)" />
          <CampaignToolbar
            onOpenLog={onOpenLog}
            onOpenLibrary={onOpenLibrary}
            onOpenTracker={onOpenTracker}
            onOpenSettings={onOpenSettings}
            after={onSwitchToPlayerView && (
              <Button icon={Eye} onClick={onSwitchToPlayerView}>Switch to player view</Button>
            )}
          />
        </div>
      </div>

      <div className="shrink-0 max-w-6xl mx-auto w-full px-6 pb-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className={`rounded-lg px-3 py-2 border ${litTorch ? 'border-warning/60 bg-warning/5' : 'bg-panel border-line-soft'}`}>
          <p className="text-[10px] tracking-wide text-ink-dim mb-0.5 flex items-center gap-1">
            <Flame size={10} /> TORCH{litTorch ? ` — ${(party.find((p) => p.id === litTorch.character_id)?.name || '').toUpperCase()}` : ''}
          </p>
          {litTorch ? (
            <>
              <p className="text-sm font-semibold text-warning-text">{formatMinutes(litTorch.remaining)}</p>
              <ProgressBar value={litTorch.remaining} max={litTorch.total_minutes} tone="amber" heightClassName="h-1" className="mt-1.5" />
            </>
          ) : (
            <p className="text-sm text-ink-dim">Unlit</p>
          )}
        </div>
        <div className="bg-panel border border-line-soft rounded-lg px-3 py-2">
          <p className="text-[10px] tracking-wide text-ink-dim mb-0.5">MODE</p>
          <span className={`text-sm font-semibold ${gmSceneMode === 'Combat' ? 'text-danger-text' : 'text-primary-text'}`}>{gmSceneMode}</span>
        </div>
        <div className="bg-panel border border-line-soft rounded-lg px-3 py-2">
          <p className="text-[10px] tracking-wide text-ink-dim mb-0.5 flex items-center gap-1"><AlertTriangle size={10} /> DANGER</p>
          <p className="text-sm font-semibold text-ink-faint" title="Danger level isn't tracked yet -- placeholder slot">&mdash;</p>
        </div>
        <div className="bg-panel border border-line-soft rounded-lg px-3 py-2">
          <p className="text-[10px] tracking-wide text-ink-dim mb-0.5 flex items-center gap-1"><RotateCw size={10} /> CRAWLING ROUND</p>
          <p className="text-sm font-semibold text-ink-faint" title="Crawling-round tracking isn't wired up yet -- placeholder slot">&mdash;</p>
        </div>
        <div className="bg-panel border border-line-soft rounded-lg px-3 py-2">
          <p className="text-[10px] tracking-wide text-ink-dim mb-0.5 flex items-center gap-1"><Timer size={10} /> NEXT ENCOUNTER CHECK</p>
          <p className="text-sm font-semibold text-ink-faint" title="Next-encounter-check tracking isn't wired up yet -- placeholder slot">&mdash;</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto md:overflow-hidden md:min-h-0">
        <div className="max-w-6xl mx-auto w-full px-6 pb-4 md:h-full md:flex md:flex-col md:min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-[260px_1fr_220px] gap-3 mb-3 items-start md:items-stretch md:flex-1 md:min-h-0 md:grid-rows-[1fr]">
            {/* LEFT RAIL: the actual "run the encounter" console -- Scene
                controls (turn indicator + Advance round / Pause-or-Resume /
                Start encounter / Reveal area / Reveal hidden monster) above
                the real Active encounter card (Add-monster input + full
                monster list, HP +/- and zone controls included), per direct
                user feedback that this is what the GM actually uses to run
                encounters, so it should all live together in one place.
                Quick tables and Request a roll moved out to the dice modal
                (see the Footer's dice button below) so the rail stays about
                running the encounter, not dice shortcuts. Party status lives
                in the right rail, matching GameTable.jsx's player-page Party
                card position. */}
            <div className="flex flex-col gap-3 md:h-full md:min-h-0 md:overflow-y-auto">
              <Card title="Scene controls">
                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] text-ink-dim px-0.5">
                    {actingEntry ? (
                      <><span className="text-ink font-medium">{actingEntry.name}</span>&rsquo;s turn</>
                    ) : (
                      'No initiative rolled yet.'
                    )}
                  </p>
                  <Row icon={SkipForward} label="Advance round" onClick={advanceTurn} disabled={turnOrder.length === 0} />
                  <Row
                    icon={sessionActive ? Pause : Play}
                    label={togglingSession ? 'Working…' : sessionActive ? 'Pause session' : 'Resume session'}
                    onClick={toggleSession}
                    disabled={togglingSession}
                  />
                  <Row icon={Swords} label="Start encounter" onClick={startEncounter} />
                  <Row icon={EyeOff} label="Reveal area" disabled title="Fog-of-war / area reveal isn't built yet -- placeholder" />
                  {encounter.some((m) => m.hidden) && (
                    <Row
                      icon={Eye}
                      label="Reveal hidden monster"
                      onClick={() => encounter.filter((m) => m.hidden).forEach((m) => revealMonster(m.id))}
                    />
                  )}
                </div>
              </Card>

              <Card
                title="Active encounter"
                titleRight={
                  <div className="flex gap-1.5">
                    <input
                      value={monsterDraft}
                      onChange={(e) => setMonsterDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addMonster()}
                      placeholder="Monster name"
                      className="text-xs bg-bg border border-line rounded-md px-2 py-1 w-24 text-white"
                    />
                    <Button icon={Plus} iconOnly onClick={addMonster} title="Add monster" />
                  </div>
                }
              >
                <div className="flex flex-col gap-1.5">
                  {encounter.length === 0 && <p className="text-xs text-ink-dim">No monsters yet -- add one above.</p>}
                  {encounter.map((m) => (
                    <div
                      key={m.id}
                      className={`flex flex-col gap-1 text-xs p-2 bg-panel2/60 rounded-md border ${
                        m.hidden ? 'border-danger/60' : 'border-line'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-white">{m.name}</span>
                          <span className="text-ink-dim">ac {m.ac}</span>
                          {m.hidden && <Badge tone="purple">Hidden</Badge>}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => adjustHp(m, -1)} className="px-1.5 border border-line rounded text-ink">-</button>
                          <span className="min-w-[44px] text-center text-ink">{m.hp} / {m.max_hp} hp</span>
                          <button onClick={() => adjustHp(m, 1)} className="px-1.5 border border-line rounded text-ink">+</button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] text-ink-dim mr-0.5">Zone</span>
                        {['close', 'near', 'far'].map((z) => (
                          <button
                            key={z}
                            onClick={() => setMonsterZone(m.id, z)}
                            className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${
                              (m.zone || 'near') === z ? 'border-primary text-primary-text bg-primary/10' : 'border-line text-ink-dim'
                            }`}
                          >
                            {z}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* CENTER: map + scene log -- Active encounter moved to the left
                rail above, so monsters live there now; they still render as
                tokens on the map via ZoneScene same as always. At md+ this
                column splits 2:1 (Map flex-[2], Scene log flex-1) and locks
                to the row's full height, same as GameTable.jsx's player
                page -- see the top-of-file comment. */}
            <div className="flex flex-col gap-3 min-w-0 md:h-full md:min-h-0">
              {/* Map and Active encounter used to be Scene/Map/Encounter tabs
                  (pick one, see it, lose the others); the tab switcher is
                  gone now, per direct user feedback, so both are just always
                  visible and stacked, same as Character Sheet's tabs-to-
                  one-page precedent. A bigger map redesign is planned later
                  -- this is the interim shape, not the final one. */}
              <Card
                className="md:flex-[2] md:min-h-0 md:flex md:flex-col"
                bodyClassName="md:flex-1 md:min-h-0 md:flex md:flex-col"
                title="Map"
                titleRight={
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    {onSwitchToPlayerView && (
                      <Button variant="primary" icon={Eye} iconOnly onClick={onSwitchToPlayerView} title="Preview player view" />
                    )}
                    <Button icon={EyeOff} iconOnly disabled title="Secrets isn't wired up yet -- placeholder" />
                    <Button icon={Sun} iconOnly disabled title="Light isn't wired up yet -- placeholder" />
                    <Button icon={CloudFog} iconOnly disabled title="Fog isn't wired up yet -- placeholder" />
                    <Button icon={Skull} iconOnly disabled title="Traps isn't wired up yet -- placeholder; will show trigger/attack/damage details once traps become selectable map objects" />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => uploadMap(e.target.files?.[0])}
                    />
                    <Button icon={Upload} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {uploading ? 'Uploading...' : campaignMapPath(mapInfo) ? 'Replace map image' : 'Upload map image'}
                    </Button>
                  </div>
                }
              >
                {(uploadError || mapAccessError) && (
                  <p className="text-xs text-danger-text mb-2">{uploadError || mapAccessError}</p>
                )}
                {/* Clocks overlaid on the scene image itself, matching
                    GameTable.jsx's player-page treatment, instead of a
                    separate "Clocks & threats" list card. Zone assignment
                    (Close/Near/Far) is now a right-click menu on each token
                    -- see ZoneScene.jsx's onSetZone -- replacing the old
                    always-visible per-character/monster button list below
                    the map. */}
                <div className="relative md:flex-1 md:min-h-0">
                  <ZoneScene
                    mapUrl={mapUrl}
                    mapAccessError={mapAccessError}
                    party={party}
                    monsters={encounter}
                    litCharacterId={lightSources.find((s) => s.lit)?.character_id || null}
                    onSelectToken={(id, type, name) => selectEntity(type, id, name)}
                    selectedTokenId={selectedEntity?.id || null}
                    onSetZone={(type, id, zone) => (type === 'character' ? setCharacterZone(id, zone) : setMonsterZone(id, zone))}
                  />
                  {activeClocks.length > 0 && (
                    <div className="absolute top-2 right-2 max-w-[180px] bg-bg/90 backdrop-blur border border-line-soft rounded-lg p-2.5">
                      <p className="text-[10px] text-ink-dim mb-1.5 uppercase tracking-wide">Clocks</p>
                      <div className="flex flex-col gap-1.5">
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
                </div>
                <p className="text-[11px] text-ink-dim mt-2">
                  Right-click a token on the map to set its zone -- Close, Near, or Far from the party.
                </p>
              </Card>

              <Card
                className="md:flex-1 md:min-h-0 md:flex md:flex-col"
                bodyClassName="md:flex-1 md:min-h-0 md:flex md:flex-col"
                title="Scene log"
              >
                <div
                  ref={sceneLogRef}
                  className="min-h-[160px] max-h-[280px] md:min-h-0 md:max-h-none md:flex-1 overflow-y-auto flex flex-col gap-2 text-sm pr-1"
                >
                  {log.length === 0 && <p className="text-xs text-ink-dim">No messages yet -- narrate something below.</p>}
                  {log.map((entry) => <LogEntry as="p" key={entry.id} entry={entry} />)}
                </div>
              </Card>
            </div>

            {/* RIGHT RAIL: encounter / party / selected. Trap details and GM
                notes moved out (see the Map card's icon row and the header's
                new notes icon, respectively). Selected now sits last, below
                Party, per direct user feedback -- a deliberate departure
                from matching GameTable.jsx's rail order (Party last) that
                PR #80 established. */}
            <div className="flex flex-col gap-3 md:h-full md:min-h-0 md:overflow-y-auto">
              {encounter.length > 0 && (
                <Card title="Encounter">
                  <div className="flex flex-col gap-1.5">
                    {encounter.map((m) => (
                      <Row
                        key={m.id}
                        icon={m.hidden ? EyeOff : undefined}
                        label={m.name}
                        right={<span className="text-[11px] text-ink-dim">{m.hp}/{m.max_hp} HP</span>}
                        onClick={() => selectEntity('monster', m.id, m.name)}
                        selected={selectedEntity?.type === 'monster' && selectedEntity?.id === m.id}
                      />
                    ))}
                  </div>
                </Card>
              )}

              <Card
                title="Party"
                titleRight={actingIsMonster && (
                  <span className="text-[10px] text-primary-text bg-primary/10 border border-primary/30 rounded-full px-2 py-0.5 truncate max-w-[55%]">
                    {actingEntry.name}&rsquo;s turn
                  </span>
                )}
              >
                {party.length === 0 && <p className="text-[11px] text-ink-dim">No characters yet.</p>}
                <div className="flex flex-col gap-2">
                  {party.map((p) => {
                    const isActing = actingEntry?.id === p.id
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
                          <div className="flex items-center gap-1.5 min-w-0">
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
                              <span className="text-[9px] uppercase tracking-wide text-primary-text bg-primary/20 rounded-full px-1.5 py-0.5 shrink-0">Acting</span>
                            )}
                          </div>
                          <span className="text-[11px] text-ink-dim shrink-0">{p.hp}/{p.max_hp}</span>
                        </div>
                        <ProgressBar value={p.hp} max={p.max_hp} barClassName={hpBarColor(p.hp, p.max_hp)} trackBg="bg-danger/40" heightClassName="h-1" />
                      </button>
                      {lightRemaining !== null && (
                        <div className="mt-1.5">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[9px] text-warning-text flex items-center gap-1"><Flame size={9} /> Torch</span>
                            <span className="text-[9px] text-ink-dim">{formatMinutes(lightRemaining)}</span>
                          </div>
                          <ProgressBar value={lightRemaining} max={light.total_minutes} tone="amber" heightClassName="h-1" />
                        </div>
                      )}
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
                    )
                  })}
                </div>
              </Card>

              <Card
                title="Selected"
                titleRight={selectedEntity && (
                  <div className="flex items-center gap-2">
                    {selectedMonster && (
                      <button onClick={() => toggleMonsterHidden(selectedMonster)} title="Toggle hidden/visible">
                        <Badge tone={selectedMonster.hidden ? 'purple' : 'green'}>{selectedMonster.hidden ? 'Hidden' : 'Visible'}</Badge>
                      </button>
                    )}
                    <button onClick={() => setSelectedEntity(null)} className="text-[10px] text-ink-dim hover:text-ink shrink-0">
                      Clear
                    </button>
                  </div>
                )}
              >
                {selectedEntity ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm text-white font-medium truncate flex items-center gap-1.5">
                      <Target size={12} className="text-ink-dim" /> {selectedEntity.name}
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {notes.filter((n) => n.entity_type === selectedEntity.type && n.entity_id === selectedEntity.id).length === 0 && (
                        <p className="text-[11px] text-ink-dim">No notes on {selectedEntity.name} yet.</p>
                      )}
                      {notes
                        .filter((n) => n.entity_type === selectedEntity.type && n.entity_id === selectedEntity.id)
                        .map((n) => (
                          <div key={n.id} className="text-xs p-2 bg-panel2/60 rounded-md">
                            <p className={`mb-1.5 ${n.revealed ? 'text-ink-dim line-through' : 'text-ink'}`}>{n.text}</p>
                            {!n.revealed && (
                              <Button onClick={() => revealNote(n.id)} className="text-[11px] px-2 py-1">Reveal to party</Button>
                            )}
                          </div>
                        ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        value={entityNoteDraft}
                        onChange={(e) => setEntityNoteDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addEntityNote()}
                        placeholder={`Note on ${selectedEntity.name}`}
                        className="flex-1 min-w-0 text-xs bg-bg border border-line rounded-md px-2 py-1 text-white"
                      />
                      <Button icon={Plus} iconOnly onClick={addEntityNote} title="Add note" />
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-ink-dim">Click a token on the map to inspect it and see notes tied to it. Traps and other map features aren't selectable yet -- character and monster tokens only.</p>
                )}
              </Card>
            </div>
          </div>
        </div>
      </div>

      {/* Dice tables -- Quick tables (Random encounter/Reaction/Morale/
          Treasure) and Request a roll used to live permanently in the left
          rail and header; now they're behind this on-demand modal opened
          from the composer's dice button, mirroring GameTable.jsx's dice/
          Attack/Stabilize modal exactly (same shared Modal.jsx). */}
      <Modal open={showDiceModal} onClose={() => setShowDiceModal(false)} title="Dice tables">
        <div className="flex flex-col gap-1.5">
          <Row icon={Shuffle} label="Random encounter" onClick={() => rollQuickTable('Random encounter check', '1d6')} disabled={quickRolling} />
          <Row icon={Users} label="Reaction" onClick={() => rollQuickTable('Reaction roll', '2d6')} disabled={quickRolling} />
          <Row icon={Gauge} label={moraleChecking ? 'Rolling…' : 'Morale'} onClick={moraleCheck} disabled={moraleChecking || encounter.length === 0} />
          <Row icon={Gem} label="Treasure" onClick={() => rollQuickTable('Treasure roll', '1d100')} disabled={quickRolling} />
          <Row icon={Dices} label={requestingRoll ? 'Requesting…' : 'Request a roll'} onClick={requestRoll} disabled={requestingRoll} />
        </div>
      </Modal>

      {/* GM notes (general, private) -- used to be a permanently-visible
          right-rail card; now behind this on-demand modal, opened from the
          new sticky-note icon next to Campaign log/Rules library in the
          header, per direct user feedback. Same state/handlers as before
          (noteDraft, addNote, notes filtered to the general/untagged ones)
          -- just relocated, no behavior changes. Entity-specific notes stay
          in the Selected card, unaffected. */}
      <Modal open={showNotesModal} onClose={() => setShowNotesModal(false)} title="GM notes (private, general)">
        <div className="flex flex-col gap-1.5">
          {notes.filter((n) => !n.entity_type).length === 0 && <p className="text-xs text-ink-dim">No general notes yet -- notes on a specific character or monster show in the Selected card instead.</p>}
          {notes.filter((n) => !n.entity_type).map((n) => (
            <div key={n.id} className="text-xs p-2 bg-panel2/60 rounded-md">
              <p className={`mb-1.5 ${n.revealed ? 'text-ink-dim line-through' : 'text-ink'}`}>{n.text}</p>
              {!n.revealed && (
                <Button onClick={() => revealNote(n.id)} className="text-[11px] px-2 py-1">Reveal to party</Button>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 mt-2">
          <input
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addNote()}
            placeholder="New note"
            className="flex-1 text-xs bg-bg border border-line rounded-md px-2 py-1 text-white"
          />
          <Button icon={Plus} iconOnly onClick={addNote} title="Add note" />
        </div>
      </Modal>

      <Footer>
        <div className="max-w-6xl mx-auto w-full px-6 pt-2.5 flex items-center gap-1.5">
          <button
            onClick={() => setComposeMode('public')}
            className={`text-[11px] border rounded-md px-2 py-1 flex items-center gap-1.5 ${
              composeMode === 'public' ? 'border-primary text-primary-text bg-primary/10' : 'border-line text-ink-dim hover:bg-panel2'
            }`}
          >
            <Megaphone size={11} /> Public narration
          </button>
          <button
            onClick={() => setComposeMode('private')}
            className={`text-[11px] border rounded-md px-2 py-1 flex items-center gap-1.5 ${
              composeMode === 'private' ? 'border-primary text-primary-text bg-primary/10' : 'border-line text-ink-dim hover:bg-panel2'
            }`}
          >
            <Lock size={11} /> Private note
          </button>
        </div>
        <div className="max-w-6xl mx-auto w-full px-6 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto_180px] gap-3 items-center">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder={composeMode === 'private' ? 'Note only you can see' : 'Narrate something to the party'}
            className="min-w-0 bg-panel border border-line rounded-md px-3 py-2 text-sm text-white"
          />
          <Button iconOnly icon={Dices} onClick={() => setShowDiceModal(true)} title="Dice tables -- quick rolls & request a roll" />
          <Button iconOnly icon={Mic} disabled title="Voice input isn't wired up yet -- placeholder" />
          {onOpenLibrary && <Button icon={HelpCircle} onClick={onOpenLibrary}>Ask a rule</Button>}
          <Button iconOnly icon={Paperclip} disabled title="Attachments aren't wired up yet -- placeholder" />
          <Button onClick={sendMessage}>{composeMode === 'private' ? 'Save note' : 'Send to players'}</Button>
        </div>
      </Footer>
    </div>
  )
}
