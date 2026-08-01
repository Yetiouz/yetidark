import { useState, useEffect, useRef } from 'react'
import { Eye, EyeOff, Plus, Upload, Dices, SkipForward, Settings, ScrollText, BookOpen, Users, Flame, AlertTriangle, RotateCw, Timer, Sun, CloudFog, Target, Mic, Paperclip, Megaphone, Lock } from 'lucide-react'

import ZoneScene from './ZoneScene.jsx'
import ProgressBar from './ui/ProgressBar.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { campaignMapPath, useCampaignMapUrl } from '../lib/useCampaignMapUrl.js'
import { abilityModifier } from '../game/rules/character.js'

const GM_TABS = [
{ key: 'scene', label: 'Scene' },
{ key: 'map', label: 'Map' },
{ key: 'encounter', label: 'Encounter' },
]

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

// Everything here is real Supabase data, synced live: the encounter
// tracker, GM notes, turn order, the scene log, and the zone map (upload
// a scene image, then set each character/monster's Close/Near/Far zone).
//
// Initiative rolls go through the same authoritative server command as
// player app rolls and are persisted with their scene-log entries in one
// transaction.
//
// Layout: three-column shell (party/scene-controls rail / scene+log /
// GM notes rail) matching the delve-ui-reference gm-session mockup,
// inside the same fixed-viewport header/scroll/composer frame as before.
//
// Danger level, crawling-round tracking, the next-encounter-check
// countdown, the per-entity (trap/statue) selected inspector, and
// Secrets/Light/Fog map toggles have no schema behind them yet. Per
// explicit direction, those stay as visible placeholder UI (dimmed,
// disabled, honest empty states) rather than being omitted, so the
// layout reads the way the mockup does -- they're slots waiting on real
// mechanics, not real features yet. "Quick tables" are real dice-engine
// shortcuts (a flat roll with a label), not lookup tables Delve doesn't
// have data for. Clocks & threats and Preview player view are real.
export default function GmDashboard({ campaignId, session, campaignName = 'The sunken keep', onSwitchToPlayerView, onOpenCharacterSheet, onOpenSettings, onOpenLog, onOpenLibrary, onOpenTracker }) {
  const user = session?.user
  const [displayName, setDisplayName] = useState('GM')
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
  const [party, setParty] = useState([])
  const [turnOrder, setTurnOrder] = useState([])
  const [log, setLog] = useState([])
  const [message, setMessage] = useState('')
  const [gmTab, setGmTab] = useState('map') // 'scene' | 'map' | 'encounter' -- pure view toggle, no new data
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [clocks, setClocks] = useState([])
  const [composeMode, setComposeMode] = useState('public') // 'public' -> scene_log, 'private' -> gm_notes
  const sceneLogRef = useRef(null)
  const chatLogRef = useRef(null)

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || user.email || 'GM'))
  }, [user])

  // Only matters while a torch is actually burning, but a cheap 1s
  // interval the whole time this screen is open is simplest.
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const [mapInfo, setMapInfo] = useState(null)
  const [lightSources, setLightSources] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [moraleChecking, setMoraleChecking] = useState(false)
  const [requestingRoll, setRequestingRoll] = useState(false)
  const [quickRolling, setQuickRolling] = useState(false)
  const fileInputRef = useRef(null)
  const { url: mapUrl, error: mapAccessError } = useCampaignMapUrl(mapInfo)

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
      .from('characters')
      .select('id, name, class, level, hp, max_hp, ac, avatar_url, color, zone, stats, status, death_timer')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setParty(data || []) })

    supabase
      .from('turn_order')
      .select('order_list')
      .eq('campaign_id', campaignId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setTurnOrder(data?.order_list || []) })

    supabase
      .from('campaigns')
      .select('map_path, map_url')
      .eq('id', campaignId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setMapInfo(data) })

    supabase
      .from('campaign_light_sources')
      .select('id, name, character_id, lit, lit_at, remaining_minutes, total_minutes')
      .eq('campaign_id', campaignId)
      .then(({ data }) => { if (!cancelled) setLightSources(data || []) })

    supabase
      .from('scene_log')
      .select('id, type, sender_name, text, roll_source, dice_roll_id, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setLog(data || []) })

    supabase
      .from('campaign_clocks')
      .select('id, name, segments_filled, segments_total, created_at')
      .eq('campaign_id', campaignId)
      .then(({ data }) => { if (!cancelled) setClocks(data || []) })

    const channel = supabase
      .channel(`gm-dashboard-${campaignId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scene_log', filter: `campaign_id=eq.${campaignId}` },
        (payload) => setLog((l) => (l.some((e) => e.id === payload.new.id) ? l : [...l, payload.new]))
      )
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
        { event: '*', schema: 'public', table: 'characters', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setParty((p) => [...p, payload.new])
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'turn_order', filter: `campaign_id=eq.${campaignId}` },
        (payload) => setTurnOrder(payload.new?.order_list || [])
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'campaign_light_sources', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setLightSources((l) => [...l, payload.new])
          else if (payload.eventType === 'UPDATE') setLightSources((l) => l.map((x) => (x.id === payload.new.id ? payload.new : x)))
          else if (payload.eventType === 'DELETE') setLightSources((l) => l.filter((x) => x.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${campaignId}` },
        (payload) => setMapInfo(payload.new)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'campaign_clocks', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setClocks((c) => (c.some((x) => x.id === payload.new.id) ? c : [...c, payload.new]))
          else if (payload.eventType === 'UPDATE') setClocks((c) => c.map((x) => (x.id === payload.new.id ? payload.new : x)))
          else if (payload.eventType === 'DELETE') setClocks((c) => c.filter((x) => x.id !== payload.old.id))
        }
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

  // Split the same way the player table does: Scene log is narration/GM
  // lines/rolls, Party chat is the players' own OOC conversation.
  const narrationLog = log.filter((entry) => entry.type !== 'chat')
  const chatLog = log.filter((entry) => entry.type === 'chat')

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

  useEffect(() => {
    if (sceneLogRef.current) sceneLogRef.current.scrollTop = sceneLogRef.current.scrollHeight
  }, [narrationLog.length])

  useEffect(() => {
    if (chatLogRef.current) chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight
  }, [chatLog.length])

  const renderLogEntry = (entry) => {
    if (entry.type === 'narration') {
      return <p key={entry.id} className="italic text-ink-dim">{entry.text}</p>
    }
    if (entry.type === 'gm') {
      return (
        <p key={entry.id}>
          <span className="font-medium text-primary-text">{entry.sender_name}:</span>{' '}
          <span className="text-ink">{entry.text}</span>
        </p>
      )
    }
    if (entry.type === 'roll') {
      return (
        <p key={entry.id} className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-white">{entry.sender_name}:</span>
          <span className="text-ink">{entry.text}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              entry.roll_source === 'app'
                ? 'bg-primary/20 text-primary-text'
                : 'bg-panel2 border border-line text-ink-dim'
            }`}
          >
            {entry.roll_source === 'app' ? 'app roll' : 'self-reported'}
          </span>
        </p>
      )
    }
    return (
      <p key={entry.id}>
        <span className="font-medium text-white">{entry.sender_name}:</span>{' '}
        <span className="text-ink">{entry.text}</span>
      </p>
    )
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="shrink-0 max-w-6xl mx-auto w-full px-6 pt-6 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <p className="text-white font-medium">{campaignName}</p>
          <span className="text-xs px-2 py-0.5 rounded bg-ai/20 text-ai-text">GM view</span>
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
          {onOpenLog && (
            <button
              onClick={onOpenLog}
              title="Campaign log"
              className="text-xs border border-line rounded-md p-1.5 text-ink hover:bg-panel2"
            >
              <ScrollText size={14} />
            </button>
          )}
          {onOpenLibrary && (
            <button
              onClick={onOpenLibrary}
              title="Rules library"
              className="text-xs border border-line rounded-md p-1.5 text-ink hover:bg-panel2"
            >
              <BookOpen size={14} />
            </button>
          )}
          {onOpenTracker && (
            <button
              onClick={onOpenTracker}
              title="NPCs, factions & treasure"
              className="text-xs border border-line rounded-md p-1.5 text-ink hover:bg-panel2"
            >
              <Users size={14} />
            </button>
          )}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              title="Campaign settings"
              className="text-xs border border-line rounded-md p-1.5 text-ink hover:bg-panel2"
            >
              <Settings size={14} />
            </button>
          )}
          {onSwitchToPlayerView && (
            <button
              onClick={onSwitchToPlayerView}
              className="text-xs border border-line rounded-md px-2.5 py-1 flex items-center gap-1.5 text-ink hover:bg-panel2"
            >
              <Eye size={14} /> Switch to player view
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 max-w-6xl mx-auto w-full px-6 pb-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className={`rounded-lg px-3 py-2 border ${litTorch ? 'border-warning/60 bg-warning/5' : 'bg-panel border-line-soft'}`}>
          <p className="text-[10px] tracking-wide text-ink-dim mb-0.5 flex items-center gap-1"><Flame size={10} /> TORCH</p>
          {litTorch ? (
            <p className="text-sm font-semibold text-warning-text">
              {formatMinutes(litTorch.remaining)}
              <span className="text-ink-dim font-normal"> · {party.find((p) => p.id === litTorch.character_id)?.name || '—'}</span>
            </p>
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

      <div className="flex-1 overflow-y-auto px-6">
        <div className="max-w-6xl mx-auto w-full pb-4">
          <div className="flex items-center gap-1.5 mb-3">
            {GM_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setGmTab(t.key)}
                className={`text-xs px-3 py-1.5 rounded-md border ${
                  gmTab === t.key ? 'border-primary text-primary-text bg-primary/10' : 'border-line text-ink hover:bg-panel2'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[190px_1fr_220px] gap-3 mb-3 items-start">
            {/* LEFT RAIL: party glance, scene controls, quick tables */}
            <div className="flex flex-col gap-3">
              <div className="bg-panel rounded-lg p-3">
                <p className="text-xs text-ink-dim mb-2">Party</p>
                {party.length === 0 && <p className="text-[11px] text-ink-dim">No characters yet.</p>}
                <div className="flex flex-col gap-1.5">
                  {party.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onOpenCharacterSheet && onOpenCharacterSheet(p.id)}
                      disabled={!onOpenCharacterSheet}
                      className="flex items-center justify-between text-[11px] text-left disabled:cursor-default hover:text-white"
                    >
                      <span className="text-ink truncate">{p.name}</span>
                      <span className="text-ink-dim shrink-0 ml-1.5">{p.hp}/{p.max_hp} &middot; AC {p.ac}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-panel rounded-lg p-3">
                <p className="text-xs text-ink-dim mb-2">Scene controls</p>
                <div className="flex flex-col gap-1.5">
                  <button onClick={advanceTurn} disabled={turnOrder.length === 0} className="flex items-center gap-1.5 text-xs border border-line rounded-md px-2 py-1.5 text-ink hover:bg-panel2 disabled:opacity-50 text-left">
                    <SkipForward size={12} className="text-ink-dim shrink-0" /> Advance round
                  </button>
                  <button onClick={requestRoll} disabled={requestingRoll} className="flex items-center gap-1.5 text-xs border border-line rounded-md px-2 py-1.5 text-ink hover:bg-panel2 disabled:opacity-50 text-left">
                    <Dices size={12} className="text-ink-dim shrink-0" /> Request a roll
                  </button>
                  <button onClick={rollInitiative} className="flex items-center gap-1.5 text-xs border border-line rounded-md px-2 py-1.5 text-ink hover:bg-panel2 text-left">
                    <Dices size={12} className="text-ink-dim shrink-0" /> Roll initiative
                  </button>
                  <button onClick={moraleCheck} disabled={moraleChecking || encounter.length === 0} className="flex items-center gap-1.5 text-xs border border-line rounded-md px-2 py-1.5 text-ink hover:bg-panel2 disabled:opacity-50 text-left">
                    <Dices size={12} className="text-ink-dim shrink-0" /> {moraleChecking ? 'Rolling…' : 'Morale check'}
                  </button>
                  {encounter.some((m) => m.hidden) && (
                    <button
                      onClick={() => encounter.filter((m) => m.hidden).forEach((m) => revealMonster(m.id))}
                      className="flex items-center gap-1.5 text-xs border border-line rounded-md px-2 py-1.5 text-ink hover:bg-panel2 text-left"
                    >
                      <Eye size={12} className="text-ink-dim shrink-0" /> Reveal hidden monster
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-panel rounded-lg p-3">
                <p className="text-xs text-ink-dim mb-2">Quick tables</p>
                <div className="flex flex-col gap-1.5">
                  <button onClick={() => rollQuickTable('Random encounter check', '1d6')} disabled={quickRolling} className="text-xs border border-line rounded-md px-2 py-1.5 text-ink hover:bg-panel2 disabled:opacity-50 text-left">
                    Random encounter
                  </button>
                  <button onClick={() => rollQuickTable('Reaction roll', '2d6')} disabled={quickRolling} className="text-xs border border-line rounded-md px-2 py-1.5 text-ink hover:bg-panel2 disabled:opacity-50 text-left">
                    Reaction
                  </button>
                  <button onClick={() => rollQuickTable('Treasure roll', '1d100')} disabled={quickRolling} className="text-xs border border-line rounded-md px-2 py-1.5 text-ink hover:bg-panel2 disabled:opacity-50 text-left">
                    Treasure
                  </button>
                </div>
              </div>

              {turnOrder.length > 0 && (
                <div className="bg-panel rounded-lg p-3">
                  <p className="text-xs text-ink-dim mb-1.5">Turn order</p>
                  <div className="flex flex-wrap gap-1.5">
                    {turnOrder.map((t, i) => (
                      <span
                        key={t.id || i}
                        className={`text-[11px] px-2 py-0.5 rounded-full ${
                          t.status === 'acting' ? 'bg-primary/20 text-primary-text' : 'bg-panel2 text-ink-dim'
                        }`}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* CENTER: scene / map / encounter tabs + log */}
            <div className="flex flex-col gap-3 min-w-0">
              {gmTab === 'map' && (
                <div className="bg-panel rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
                    <p className="text-xs text-ink-dim">Map</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {onSwitchToPlayerView && (
                        <button
                          onClick={onSwitchToPlayerView}
                          className="text-xs border border-primary/40 bg-primary/10 rounded-md px-2 py-1 flex items-center gap-1.5 text-primary-text hover:bg-primary/20"
                        >
                          <Eye size={13} /> Preview player view
                        </button>
                      )}
                      {[{ Icon: EyeOff, label: 'Secrets' }, { Icon: Sun, label: 'Light' }, { Icon: CloudFog, label: 'Fog' }].map(({ Icon, label }) => (
                        <button
                          key={label}
                          disabled
                          title={`${label} isn't wired up yet -- placeholder`}
                          className="text-xs border border-line-soft rounded-md px-2 py-1 flex items-center gap-1.5 text-ink-faint cursor-not-allowed"
                        >
                          <Icon size={13} /> {label}
                        </button>
                      ))}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => uploadMap(e.target.files?.[0])}
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="text-xs border border-line rounded-md px-2 py-1 flex items-center gap-1.5 text-ink hover:bg-panel2 disabled:opacity-50"
                      >
                        <Upload size={13} /> {uploading ? 'Uploading...' : campaignMapPath(mapInfo) ? 'Replace map image' : 'Upload map image'}
                      </button>
                    </div>
                  </div>
                  {(uploadError || mapAccessError) && (
                    <p className="text-xs text-danger-text mb-2">{uploadError || mapAccessError}</p>
                  )}
                  <ZoneScene
                    mapUrl={mapUrl}
                    mapAccessError={mapAccessError}
                    party={party}
                    monsters={encounter}
                    litCharacterId={lightSources.find((s) => s.lit)?.character_id || null}
                    onSelectToken={(id, type, name) => selectEntity(type, id, name)}
                    selectedTokenId={selectedEntity?.id || null}
                  />
                  <p className="text-[11px] text-ink-dim mt-2 mb-2">
                    Set each character or monster's zone -- Close, Near, or Far from the party.
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {party.map((p) => (
                      <div key={p.id} className="flex items-center gap-1 text-[11px]">
                        <span className="text-ink w-24 truncate">{p.name}</span>
                        {['close', 'near', 'far'].map((z) => (
                          <button
                            key={z}
                            onClick={() => setCharacterZone(p.id, z)}
                            className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${
                              (p.zone || 'near') === z ? 'border-primary text-primary-text bg-primary/10' : 'border-line text-ink-dim'
                            }`}
                          >
                            {z}
                          </button>
                        ))}
                      </div>
                    ))}
                    {encounter.map((m) => (
                      <div key={m.id} className="flex items-center gap-1 text-[11px]">
                        <span className="text-ink w-24 truncate">{m.name}</span>
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
                    ))}
                  </div>
                </div>
              )}

              {gmTab === 'encounter' && (
                <div className="bg-panel rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2.5">
                    <p className="text-xs text-ink-dim">Active encounter</p>
                    <div className="flex gap-1.5">
                      <input
                        value={monsterDraft}
                        onChange={(e) => setMonsterDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addMonster()}
                        placeholder="Monster name"
                        className="text-xs bg-bg border border-line rounded-md px-2 py-1 w-32 text-white"
                      />
                      <button onClick={addMonster} className="text-xs border border-line rounded-md px-2 py-1 flex items-center gap-1 text-ink hover:bg-panel2">
                        <Plus size={13} /> Add
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    {encounter.length === 0 && <p className="text-xs text-ink-dim">No monsters yet -- add one above.</p>}
                    {encounter.map((m) => (
                      <div
                        key={m.id}
                        className={`flex flex-col gap-1 text-xs p-2 bg-panel2/60 rounded-md border ${
                          m.hidden ? 'border-danger/60' : 'border-line'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium text-white">{m.name}</span>
                            <span className="text-ink-dim"> &middot; ac {m.ac}{m.hidden ? ' · hidden' : ''}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => adjustHp(m, -1)} className="px-1.5 border border-line rounded text-ink">-</button>
                            <span className="min-w-[44px] text-center text-ink">{m.hp} / {m.max_hp} hp</span>
                            <button onClick={() => adjustHp(m, 1)} className="px-1.5 border border-line rounded text-ink">+</button>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
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
                </div>
              )}

              {/* The 'scene' tab intentionally renders no extra panel here --
                  it just hides the Map/Encounter panel above so the Scene
                  log / Party chat grid below (always visible) gets the
                  full-width view instead of a redundant second copy of the
                  same narration feed. */}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-panel rounded-lg p-4">
                  <p className="text-xs text-ink-dim mb-2">Scene log</p>
                  <div ref={sceneLogRef} className="h-[220px] overflow-y-auto flex flex-col gap-2 text-sm pr-1">
                    {narrationLog.length === 0 && <p className="text-xs text-ink-dim">No messages yet -- narrate something below.</p>}
                    {narrationLog.map((entry) => renderLogEntry(entry))}
                  </div>
                </div>

                <div className="bg-panel rounded-lg p-4">
                  <p className="text-xs text-ink-dim mb-2">Party chat</p>
                  <div ref={chatLogRef} className="h-[220px] overflow-y-auto flex flex-col gap-2 text-sm pr-1">
                    {chatLog.length === 0 && <p className="text-xs text-ink-dim">Nothing from the players yet.</p>}
                    {chatLog.map((entry) => renderLogEntry(entry))}
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT RAIL: selected entity / clocks & threats / GM notes */}
            <div className="flex flex-col gap-3">
              <div className="bg-panel rounded-lg p-3">
                <p className="text-xs text-ink-dim mb-2 flex items-center gap-1"><Target size={11} className="text-ink-dim" /> Selected</p>
                {selectedEntity ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white font-medium truncate">{selectedEntity.name}</span>
                      <button
                        onClick={() => setSelectedEntity(null)}
                        className="text-[10px] text-ink-dim hover:text-ink shrink-0 ml-1.5"
                      >
                        Clear
                      </button>
                    </div>
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
                              <button
                                onClick={() => revealNote(n.id)}
                                className="text-[11px] px-2 py-0.5 border border-line rounded text-ink hover:bg-panel2"
                              >
                                Reveal to party
                              </button>
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
                      <button onClick={addEntityNote} className="text-xs border border-line rounded-md px-2 py-1 flex items-center gap-1 text-ink hover:bg-panel2">
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-ink-dim">Click a token on the map to inspect it and see notes tied to it. Traps and other map features aren't selectable yet -- character and monster tokens only.</p>
                )}
              </div>

              {activeClocks.length > 0 && (
                <div className="bg-panel rounded-lg p-3">
                  <p className="text-xs text-ink-dim mb-2">Clocks &amp; threats</p>
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
                <p className="text-xs text-ink-dim mb-2">GM notes (private, general)</p>
                <div className="flex flex-col gap-1.5">
                  {notes.filter((n) => !n.entity_type).length === 0 && <p className="text-xs text-ink-dim">No general notes yet -- notes on a specific character or monster show in Selected above once you click their token.</p>}
                  {notes.filter((n) => !n.entity_type).map((n) => (
                    <div key={n.id} className="text-xs p-2 bg-panel2/60 rounded-md">
                      <p className={`mb-1.5 ${n.revealed ? 'text-ink-dim line-through' : 'text-ink'}`}>{n.text}</p>
                      {!n.revealed && (
                        <button
                          onClick={() => revealNote(n.id)}
                          className="text-[11px] px-2 py-0.5 border border-line rounded text-ink hover:bg-panel2"
                        >
                          Reveal to party
                        </button>
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
                  <button onClick={addNote} className="text-xs border border-line rounded-md px-2 py-1 flex items-center gap-1 text-ink hover:bg-panel2">
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-line-soft">
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
        <div className="max-w-6xl mx-auto w-full px-6 py-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto_180px] gap-3 items-center">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder={composeMode === 'private' ? 'Note only you can see' : 'Narrate something to the party'}
            className="min-w-0 bg-panel border border-line rounded-md px-3 py-2 text-sm text-white"
          />
          <button
            disabled
            title="Voice input isn't wired up yet -- placeholder"
            className="text-sm border border-line-soft rounded-md px-3 py-2 text-ink-faint cursor-not-allowed"
          >
            <Mic size={15} />
          </button>
          <button
            disabled
            title="Attachments aren't wired up yet -- placeholder"
            className="text-sm border border-line-soft rounded-md px-3 py-2 text-ink-faint cursor-not-allowed"
          >
            <Paperclip size={15} />
          </button>
          <button
            onClick={sendMessage}
            className="text-sm border border-line rounded-md px-3.5 py-2 flex items-center justify-center text-ink hover:bg-panel2"
          >
            {composeMode === 'private' ? 'Save note' : 'Send to players'}
          </button>
        </div>
      </div>
    </div>
  )
}
