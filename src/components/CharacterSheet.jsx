import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Trash2, Upload, User, Sparkles, Ban, Shield, Package, Check, Gem, Users, Filter, ArrowUpDown, Search } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import Row from './ui/Row.jsx'
import Badge from './ui/Badge.jsx'
import Card from './ui/Card.jsx'
import Button from './ui/Button.jsx'
import ProgressBar from './ui/ProgressBar.jsx'
import {
  abilityModifier,
  gearSlotCapacity,
  occupiedGearSlots,
  resolveSpellCheck,
} from '../game/rules/character.js'

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const STAT_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' }

// Combined single-scroll layout, no tabs -- Overview/Gear/Abilities/Notes
// all render in sequence, each under its own section heading. "History" is
// left out entirely rather than faked -- there's no audit-log read path
// wired up for a character yet, so it would just be a permanent empty
// section. Add it once that data actually exists.
const modifier = abilityModifier

// Full character sheet -- stats, HP/AC, XP, coin, gear (with the STR-or-10
// slot total), and talents. The compact card on GameTable only ever showed
// name/class/level/HP/AC; this is where the rest of the character_gear /
// character_talents / characters columns added in the character-sheet
// chunk actually surface.
//
// The owning player or the campaign's GM can adjust HP/XP/coin and manage
// gear; everyone else (other players) gets a read-only view -- matches the
// owner-or-gm write pattern already used for the characters table itself.
export default function CharacterSheet({ characterId, session, onBack }) {
  const user = session?.user
  const [character, setCharacter] = useState(null)
  const [gear, setGear] = useState([])
  const [talents, setTalents] = useState([])
  const [spells, setSpells] = useState([])
  const [features, setFeatures] = useState([])
  const [canEdit, setCanEdit] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [gearDraft, setGearDraft] = useState('')
  const [spellDraft, setSpellDraft] = useState({ name: '', tier: 1, range: '', duration: '', description: '' })
  const [spellCheckDrafts, setSpellCheckDrafts] = useState({})
  const [resting, setResting] = useState(false)
  const [restError, setRestError] = useState(null)
  const [changeReason, setChangeReason] = useState('')
  const [resourceChanging, setResourceChanging] = useState(false)
  const [resourceError, setResourceError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState(null)
  const [sortMode, setSortMode] = useState('default')
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [addingGear, setAddingGear] = useState(false)
  const avatarInputRef = useRef(null)

  useEffect(() => {
    if (!characterId) return
    let cancelled = false

    const load = async () => {
      const { data: char } = await supabase.from('characters').select('*').eq('id', characterId).maybeSingle()
      if (cancelled || !char) return
      setCharacter(char)

      const owns = char.owner_user_id === user?.id
      setIsOwner(owns)
      if (owns) {
        setCanEdit(true)
      } else if (user && char.campaign_id) {
        const { data: membership } = await supabase
          .from('campaign_members')
          .select('role')
          .eq('campaign_id', char.campaign_id)
          .eq('user_id', user.id)
          .maybeSingle()
        if (!cancelled) setCanEdit(membership?.role === 'gm')
      }

      const [{ data: gearRows }, { data: talentRows }, { data: spellRows }, { data: featureRows }] = await Promise.all([
        supabase.from('character_gear').select('*').eq('character_id', characterId).order('created_at', { ascending: true }),
        supabase.from('character_talents').select('*').eq('character_id', characterId).order('created_at', { ascending: true }),
        supabase.from('character_spells').select('*').eq('character_id', characterId).order('tier', { ascending: true }),
        supabase.from('character_features').select('*').eq('character_id', characterId).order('created_at', { ascending: true }),
      ])
      if (!cancelled) {
        setGear(gearRows || [])
        setTalents(talentRows || [])
        setSpells(spellRows || [])
        setFeatures(featureRows || [])
      }
      setLoading(false)
    }
    load()

    const channel = supabase
      .channel(`character-sheet-${characterId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'characters', filter: `id=eq.${characterId}` },
        (payload) => setCharacter(payload.new)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'character_gear', filter: `character_id=eq.${characterId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setGear((g) => [...g, payload.new])
          else if (payload.eventType === 'UPDATE') setGear((g) => g.map((i) => (i.id === payload.new.id ? payload.new : i)))
          else if (payload.eventType === 'DELETE') setGear((g) => g.filter((i) => i.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'character_talents', filter: `character_id=eq.${characterId}` },
        (payload) => setTalents((t) => [...t, payload.new])
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'character_spells', filter: `character_id=eq.${characterId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setSpells((s) => [...s, payload.new])
          else if (payload.eventType === 'UPDATE') setSpells((s) => s.map((i) => (i.id === payload.new.id ? payload.new : i)))
          else if (payload.eventType === 'DELETE') setSpells((s) => s.filter((i) => i.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'character_features', filter: `character_id=eq.${characterId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setFeatures((f) => [...f, payload.new])
          else if (payload.eventType === 'UPDATE') setFeatures((f) => f.map((i) => (i.id === payload.new.id ? payload.new : i)))
          else if (payload.eventType === 'DELETE') setFeatures((f) => f.filter((i) => i.id !== payload.old.id))
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [characterId, user])

  const adjustResource = async (resource, delta) => {
    const reason = changeReason.trim()
    if (!character || !reason || resourceChanging) return
    setResourceChanging(true)
    setResourceError(null)
    const { data, error } = await supabase.rpc('adjust_character_resource', {
      p_character_id: characterId,
      p_resource: resource,
      p_delta: delta,
      p_reason: reason,
    })
    setResourceChanging(false)
    if (error) {
      setResourceError(error.message)
      return
    }
    setCharacter((current) => ({ ...current, [resource]: Number(data.after) }))
    setChangeReason('')
  }

  const toggleEquipped = async (item) => {
    const { data, error } = await supabase.rpc('set_character_gear_equipped', {
      p_gear_id: item.id,
      p_equipped: !item.equipped,
    })
    if (error) return
    setGear((all) => all.map((current) => (current.id === item.id ? { ...current, ...data } : current)))
    setCharacter((current) => ({ ...current, ac: Number(data.character_ac) }))
  }

  const removeGear = async (item) => {
    const { error } = await supabase.rpc('remove_character_gear', { p_gear_id: item.id })
    if (!error) setGear((all) => all.filter((current) => current.id !== item.id))
  }

  const addGear = async () => {
    const name = gearDraft.trim()
    if (!name || !characterId) return
    const { data, error } = await supabase.rpc('add_character_gear', {
      p_character_id: characterId,
      p_name: name,
      p_slots: 1,
      p_quantity: 1,
      p_notes: null,
    })
    if (!error) {
      setGear((all) => all.some((item) => item.id === data.id) ? all : [...all, data])
      setGearDraft('')
    }
  }

  const spendFeatureUse = async (feature) => {
    const next = Math.max(0, (feature.uses_current ?? 0) - 1)
    setFeatures((f) => f.map((i) => (i.id === feature.id ? { ...i, uses_current: next } : i)))
    await supabase.from('character_features').update({ uses_current: next }).eq('id', feature.id)
  }

  const removeFeature = async (feature) => {
    setFeatures((f) => f.filter((i) => i.id !== feature.id))
    await supabase.from('character_features').delete().eq('id', feature.id)
  }

  const togglePrepared = async (spell) => {
    const { data, error } = await supabase.rpc('set_character_spell_prepared', {
      p_spell_id: spell.id,
      p_prepared: !spell.prepared,
    })
    if (!error) setSpells((all) => all.map((item) => (item.id === spell.id ? { ...item, ...data } : item)))
  }

  const updateSpellCheckDraft = (spellId, field, value) => {
    setSpellCheckDrafts((drafts) => ({
      ...drafts,
      [spellId]: { ...(drafts[spellId] || {}), [field]: value },
    }))
  }

  const recordSpellCheck = async (spell) => {
    const draft = spellCheckDrafts[spell.id] || {}
    const naturalRoll = Number.parseInt(draft.naturalRoll, 10)
    const total = Number.parseInt(draft.total, 10)
    try {
      resolveSpellCheck({
        naturalRoll,
        total,
        tier: spell.tier,
        succeededSinceRest: spell.succeeded_since_rest,
      })
    } catch {
      return
    }

    const { data, error } = await supabase.rpc('record_character_spell_check', {
      p_spell_id: spell.id,
      p_natural_roll: naturalRoll,
      p_total: total,
    })
    if (!error) {
      setSpells((all) => all.map((item) => (item.id === spell.id ? { ...item, ...data } : item)))
      setSpellCheckDrafts((drafts) => ({ ...drafts, [spell.id]: {} }))
    }
  }

  const completeFullRest = async () => {
    if (!characterId || resting) return
    setResting(true)
    setRestError(null)
    const { data, error } = await supabase.rpc('complete_character_rest', {
      p_character_id: characterId,
    })
    setResting(false)
    if (error) {
      setRestError(error.message)
      return
    }

    setCharacter((current) => ({ ...current, hp: current.max_hp }))
    setFeatures((all) => all.map((feature) => (
      feature.uses_max == null ? feature : { ...feature, uses_current: feature.uses_max }
    )))
    setSpells((all) => all.map((spell) => ({
      ...spell,
      lost: false,
      succeeded_since_rest: false,
      last_check_natural: null,
      last_check_total: null,
      last_check_succeeded: null,
      last_check_at: null,
    })))
    setGear((all) => {
      const rationIndex = all.findIndex(
        (item) => ['ration', 'rations'].includes(item.name.toLowerCase()) && item.quantity > 0
      )
      if (rationIndex === -1) return all
      if (data?.rations_remaining === 0) return all.filter((_, index) => index !== rationIndex)
      return all.map((item, index) => (
        index === rationIndex ? { ...item, quantity: data?.rations_remaining ?? item.quantity - 1 } : item
      ))
    })
  }

  const removeSpell = async (spell) => {
    const { error } = await supabase.rpc('remove_character_spell', { p_spell_id: spell.id })
    if (!error) setSpells((all) => all.filter((item) => item.id !== spell.id))
  }

  const addSpell = async () => {
    const name = spellDraft.name.trim()
    if (!name || !characterId) return
    const { data, error } = await supabase.rpc('add_character_spell', {
      p_character_id: characterId,
      p_name: name,
      p_tier: Number(spellDraft.tier) || 1,
      p_range: spellDraft.range.trim() || null,
      p_duration: spellDraft.duration.trim() || null,
      p_description: spellDraft.description.trim() || null,
    })
    if (!error) {
      setSpells((all) => all.some((spell) => spell.id === data.id) ? all : [...all, data])
      setSpellDraft({ name: '', tier: 1, range: '', duration: '', description: '' })
    }
  }

  // Owner-only, unlike HP/XP/coin/gear which the GM can also touch -- a
  // portrait is a personal choice, not something the table needs to
  // manage. Uploads to a fixed `{characterId}/avatar` path (upsert
  // replaces any previous image) and appends a cache-busting query param
  // so the new image shows immediately instead of a stale cached one.
  const uploadAvatar = async (file) => {
    if (!file || !characterId) return
    setAvatarUploading(true)
    setAvatarError(null)
    const path = `${characterId}/avatar`
    const { error: storageError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (storageError) {
      setAvatarError(storageError.message)
      setAvatarUploading(false)
      return
    }
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
    const avatarUrl = `${pub.publicUrl}?v=${Date.now()}`
    const { error: updateError } = await supabase.from('characters').update({ avatar_url: avatarUrl }).eq('id', characterId)
    setAvatarUploading(false)
    if (updateError) {
      setAvatarError(updateError.message)
      return
    }
    setCharacter((c) => ({ ...c, avatar_url: avatarUrl }))
  }

  if (loading || !character) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <p className="text-xs text-ink-faint">Loading character…</p>
      </div>
    )
  }

  const stats = character.stats || {}
  const maxSlots = gearSlotCapacity({
    strengthScore: stats.str,
    constitutionScore: stats.con,
    features,
  })
  const usedSlots = occupiedGearSlots(gear)
  // Torches/Rations aren't their own tracked resource -- they're just gear
  // items a player happens to be carrying. Counting by name (same
  // case-insensitive match completeFullRest already uses for rations)
  // keeps these stat cards honest instead of inventing a resource type the
  // schema doesn't have. This only totals carried quantity, not "how many
  // are currently lit" -- that's campaign_light_sources' job (see the
  // Party panel's torch bar on GameTable), and this component doesn't
  // load that table, so we don't claim to know it here.
  const torchCount = gear
    .filter((item) => /torch/i.test(item.name))
    .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
  const rationCount = gear
    .filter((item) => /^rations?$/i.test(item.name.trim()))
    .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
  const equippedGear = gear.filter((item) => item.equipped)
  const carriedGear = gear.filter((item) => !item.equipped)
  const gearFull = usedSlots >= maxSlots

  return (
    <div className="max-w-5xl mx-auto p-6">
      {onBack && (
        <button onClick={onBack} className="text-xs text-ink-dim hover:text-ink flex items-center gap-1 mb-3">
          <ArrowLeft size={13} /> Back
        </button>
      )}

      <div className="flex items-center gap-3 mb-4">
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => uploadAvatar(e.target.files?.[0])}
        />
        <button
          onClick={() => isOwner && avatarInputRef.current?.click()}
          disabled={!isOwner || avatarUploading}
          className={`w-16 h-16 rounded-full overflow-hidden bg-panel border border-line flex items-center justify-center shrink-0 ${
            isOwner ? 'hover:border-ink-faint cursor-pointer' : 'cursor-default'
          }`}
          title={isOwner ? (character.avatar_url ? 'Replace portrait' : 'Upload portrait') : undefined}
        >
          {character.avatar_url ? (
            <img src={character.avatar_url} alt={character.name} className="w-full h-full object-cover" />
          ) : (
            <User size={22} className="text-ink-faint" />
          )}
        </button>
        <div>
          <h1 className="text-ink text-lg font-medium">{character.name}</h1>
          <p className="text-xs text-ink-dim">
            {character.ancestry} {character.class} &middot; level {character.level} &middot; {character.alignment || 'Unaligned'}
            {character.background ? ` · ${character.background}` : ''}
          </p>
          {isOwner && (
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="text-[11px] text-ink-faint hover:text-ink-dim flex items-center gap-1 mt-1"
            >
              <Upload size={11} /> {avatarUploading ? 'Uploading…' : character.avatar_url ? 'Replace portrait' : 'Upload portrait'}
            </button>
          )}
        </div>
      </div>
      {avatarError && <p className="text-xs text-danger-text mb-3">{avatarError}</p>}

      <h2 className="text-sm font-semibold text-ink uppercase tracking-wide border-b border-line-soft pb-2 mb-4">Overview</h2>
      <div className="grid grid-cols-6 gap-2 mb-4">
        {STAT_KEYS.map((k) => (
          <div key={k} className="bg-panel rounded-md p-2 text-center">
            <p className="text-[10px] text-ink-dim mb-1">{STAT_LABELS[k]}</p>
            <p className="text-sm text-ink">{stats[k] ?? '-'}</p>
            <p className="text-[10px] text-ink-faint mt-1">
              {stats[k] != null ? (modifier(stats[k]) >= 0 ? `+${modifier(stats[k])}` : modifier(stats[k])) : ''}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-panel rounded-lg p-3">
          <p className="text-[11px] text-ink-dim mb-2">HP</p>
          <div className="flex items-center justify-between">
            {canEdit && <button disabled={!changeReason.trim() || resourceChanging} onClick={() => adjustResource('hp', -1)} className="px-2 border border-line rounded text-ink-dim disabled:opacity-40">-</button>}
            <span className="text-sm text-ink">{character.hp} / {character.max_hp}</span>
            {canEdit && <button disabled={!changeReason.trim() || resourceChanging} onClick={() => adjustResource('hp', 1)} className="px-2 border border-line rounded text-ink-dim disabled:opacity-40">+</button>}
          </div>
          <p className="text-[11px] text-ink-faint mt-2">ac {character.ac}</p>
        </div>

        <div className="bg-panel rounded-lg p-3">
          <p className="text-[11px] text-ink-dim mb-2">XP</p>
          <div className="flex items-center justify-between">
            {canEdit && <button disabled={!changeReason.trim() || resourceChanging} onClick={() => adjustResource('xp', -1)} className="px-2 border border-line rounded text-ink-dim disabled:opacity-40">-</button>}
            <span className="text-sm text-ink">{character.xp}</span>
            {canEdit && <button disabled={!changeReason.trim() || resourceChanging} onClick={() => adjustResource('xp', 1)} className="px-2 border border-line rounded text-ink-dim disabled:opacity-40">+</button>}
          </div>
        </div>

        <div className="bg-panel rounded-lg p-3">
          <p className="text-[11px] text-ink-dim mb-2">Coin</p>
          <div className="flex items-center justify-between">
            {canEdit && <button disabled={!changeReason.trim() || resourceChanging} onClick={() => adjustResource('coin', -1)} className="px-2 border border-line rounded text-ink-dim disabled:opacity-40">-</button>}
            <span className="text-sm text-ink">{character.coin} gp</span>
            {canEdit && <button disabled={!changeReason.trim() || resourceChanging} onClick={() => adjustResource('coin', 1)} className="px-2 border border-line rounded text-ink-dim disabled:opacity-40">+</button>}
          </div>
        </div>
      </div>
      {canEdit && (
        <div className="mb-4">
          <label className="text-[11px] text-ink-dim block mb-2">
            Reason for next HP, XP, or coin change
          </label>
          <input
            value={changeReason}
            onChange={(event) => setChangeReason(event.target.value)}
            maxLength={500}
            placeholder="Damage, healing, reward, purchase…"
            className="w-full text-xs bg-bg border border-line rounded-md px-3 py-2 text-ink"
          />
          <p className="text-[11px] text-ink-faint mt-1">
            Required so the campaign history explains the change.
          </p>
          {resourceError && <p className="text-[11px] text-danger-text mt-1">{resourceError}</p>}
        </div>
      )}

      <h2 className="text-sm font-semibold text-ink uppercase tracking-wide border-b border-line-soft pb-2 mb-4 mt-8">Gear</h2>

      {(() => {
        // Sort/filter operate only on real, already-loaded columns (name,
        // slots, quantity) -- no invented categorization. Filter narrows
        // Carried gear by name; Sort cycles as-added / A-to-Z / most slots.
        let visibleCarried = carriedGear
        const q = filterQuery.trim().toLowerCase()
        if (q) visibleCarried = visibleCarried.filter((item) => item.name.toLowerCase().includes(q))
        if (sortMode === 'az') {
          visibleCarried = [...visibleCarried].sort((a, b) => a.name.localeCompare(b.name))
        } else if (sortMode === 'slots') {
          visibleCarried = [...visibleCarried].sort((a, b) => b.slots * b.quantity - a.slots * a.quantity)
        }
        const sortLabel = sortMode === 'az' ? 'Sort: A to Z' : sortMode === 'slots' ? 'Sort: most slots' : 'Sort: as added'
        const cycleSort = () => setSortMode((m) => (m === 'default' ? 'az' : m === 'az' ? 'slots' : 'default'))

        return (
        <div className="flex flex-col gap-3 mb-4">
          {/* Stat-card row matches the artifact's five-card header layout
              exactly, including a Party storage slot. Gear/Coin read
              straight off the character; Torches/Rations are derived from
              real carried gear (see torchCount/rationCount above) -- no
              invented resource type. Party storage is genuinely not built:
              checked every migration, there's no party_storage table, so
              rather than show a fabricated slot count, the card is present
              (matching the artifact's shape) but honestly says it isn't set
              up yet -- same treatment as the Treasure/Party sidebar below. */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className={`rounded-lg px-3 py-2 border ${gearFull ? 'border-warning/60 bg-warning/5' : 'bg-panel border-line-soft'}`}>
              <p className="text-[10px] tracking-wide text-ink-dim mb-1">GEAR</p>
              <p className={`text-lg font-semibold ${gearFull ? 'text-warning-text' : 'text-white'}`}>
                {usedSlots}<span className="text-ink-dim text-sm font-normal"> / {maxSlots}</span>
              </p>
              {gearFull && (
                <div className="mt-2 h-1 rounded-full bg-warning/20 overflow-hidden">
                  <div className="h-full w-full bg-warning rounded-full" />
                </div>
              )}
            </div>
            <div className="bg-panel border border-line-soft rounded-lg px-3 py-2">
              <p className="text-[10px] tracking-wide text-ink-dim mb-1">COIN</p>
              <p className="text-lg font-semibold text-white">{character.coin}<span className="text-ink-dim text-sm font-normal"> gp</span></p>
            </div>
            <div className="bg-panel border border-line-soft rounded-lg px-3 py-2">
              <p className="text-[10px] tracking-wide text-ink-dim mb-1">TORCHES</p>
              <p className="text-lg font-semibold text-white">{torchCount}</p>
            </div>
            <div className="bg-panel border border-line-soft rounded-lg px-3 py-2">
              <p className="text-[10px] tracking-wide text-ink-dim mb-1">RATIONS</p>
              <p className="text-lg font-semibold text-white">{rationCount}</p>
            </div>
            <div className="bg-panel border border-dashed border-line-soft rounded-lg px-3 py-2">
              <p className="text-[10px] tracking-wide text-ink-dim mb-1">PARTY STORAGE</p>
              <p className="text-xs text-ink-faint mt-2">Not set up</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 flex flex-col gap-3">
              {/* Equipped renders as a tile grid (icon chip, name, tag row)
                  matching the artifact's card layout, instead of the plain
                  Row list used before. Tags reflect only real columns --
                  base_ac/is_shield/dex_applies. There's still no damage-die
                  /property/weapon-type field on character_gear, so weapon
                  combat tags (the artifact's "1d8 Versatile") are left off
                  rather than guessed -- same call as the Quick Actions rail
                  on GameTable and the icon reasoning from PR #66/#72/#74. */}
              <Card
                title="Equipped"
                titleRight={
                  <span className="text-[10px] text-positive-text flex items-center gap-1">
                    <Check size={11} /> Equipped items free
                  </span>
                }
              >
                {equippedGear.length === 0 && <p className="text-xs text-ink-faint">Nothing equipped.</p>}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {equippedGear.map((item) => {
                    const isDefense = item.is_shield || item.base_ac != null
                    const tag = item.is_shield
                      ? '+2 AC'
                      : item.base_ac != null
                        ? `AC ${item.base_ac}${item.dex_applies ? ' + dex' : ''}`
                        : null
                    return (
                      <div key={item.id} className="bg-panel2/40 border border-line-soft rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <span className="w-7 h-7 rounded-md bg-panel2 flex items-center justify-center shrink-0">
                            {isDefense ? <Shield size={13} className="text-ink-dim" /> : <Package size={13} className="text-ink-dim" />}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs text-ink font-medium truncate">
                              {item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name}
                            </p>
                            <p className="text-[10px] text-ink-dim">Equipped</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {tag && <Badge tone="blue">{tag}</Badge>}
                          {canEdit && (
                            <>
                              <button onClick={() => toggleEquipped(item)} className="text-[11px] text-ink-faint hover:text-ink-dim">
                                Unequip
                              </button>
                              <button onClick={() => removeGear(item)} className="text-ink-faint hover:text-danger-text ml-auto">
                                <Trash2 size={12} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>

              <Card title="Carried gear" titleRight={<Badge tone="neutral">{maxSlots} slots</Badge>}>
                <div className="flex items-center gap-2 mb-3">
                  <ProgressBar
                    mode="segmented"
                    segments={Math.max(maxSlots, usedSlots, 1)}
                    filled={usedSlots}
                    tone={usedSlots > maxSlots ? 'red' : 'amber'}
                    className="flex-1"
                  />
                  <span className={`text-[10px] shrink-0 ${gearFull ? 'text-warning-text' : 'text-ink-faint'}`}>
                    {usedSlots} / {maxSlots}
                  </span>
                </div>
                {carriedGear.length === 0 && <p className="text-xs text-ink-faint">No carried gear.</p>}
                {carriedGear.length > 0 && visibleCarried.length === 0 && (
                  <p className="text-xs text-ink-faint">No items match &ldquo;{filterQuery.trim()}&rdquo;.</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {visibleCarried.map((item) => (
                    <Row
                      key={item.id}
                      icon={Package}
                      label={item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name}
                      right={
                        <div className="flex items-center gap-2">
                          {/* notes is a real, existing character_gear column
                              -- surfacing it as a tag (e.g. a GM-set "Cult
                              marker") is honest, unlike a fabricated item
                              category. Nothing currently writes it from the
                              UI, so it's empty until that's added. */}
                          {item.notes && <Badge tone="purple">{item.notes}</Badge>}
                          <span className="text-[10px] text-ink-faint whitespace-nowrap">
                            {item.slots * item.quantity} slot{item.slots * item.quantity === 1 ? '' : 's'}
                          </span>
                          {canEdit && (
                            <>
                              <button onClick={() => toggleEquipped(item)} className="text-[11px] text-ink-faint hover:text-ink-dim whitespace-nowrap">
                                Equip
                              </button>
                              <button onClick={() => removeGear(item)} className="text-ink-faint hover:text-danger-text">
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      }
                    />
                  ))}
                </div>
              </Card>
            </div>

            {/* Treasure found and Party inventory match the artifact's
                right-sidebar shape, but there's no campaign_treasure
                hand-off/decision workflow and no party_storage table behind
                either one -- checked all migrations. These are honest "not
                set up" states (same empty-state discipline as the Rules
                Library's distinct empty states), not filled-in mock data. */}
            <div className="flex flex-col gap-3">
              <Card title="Treasure found">
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-md bg-panel2 flex items-center justify-center shrink-0">
                    <Gem size={14} className="text-ink-faint" />
                  </span>
                  <p className="text-xs text-ink-faint">
                    Nothing is waiting on a decision right now. This card will show pending treasure finds here once the hand-off workflow is built.
                  </p>
                </div>
              </Card>

              <Card title="Party inventory">
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 rounded-md bg-panel2 flex items-center justify-center shrink-0">
                    <Users size={14} className="text-ink-faint" />
                  </span>
                  <p className="text-xs text-ink-faint">
                    Shared party storage isn't set up for this campaign yet -- gear stays on each character for now.
                  </p>
                </div>
              </Card>
            </div>
          </div>

          {canEdit && addingGear && (
            <div className="flex gap-2">
              <input
                value={gearDraft}
                onChange={(e) => setGearDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (addGear(), setAddingGear(false))}
                placeholder="Item name"
                autoFocus
                className="flex-1 min-w-0 text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
              />
              <Button icon={Plus} onClick={() => { addGear(); setAddingGear(false) }} className="shrink-0">
                Add
              </Button>
            </div>
          )}

          {/* Footer bar mirrors the artifact's bottom action row. Sort and
              Filter are real, working operations over already-loaded data
              (see visibleCarried above) -- not decorative buttons. */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
            <p className="text-[11px] text-ink-faint flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-positive inline-block" />
              Changes save automatically
            </p>
            {canEdit && (
              <div className="flex items-center gap-2">
                <Button variant="outline" icon={ArrowUpDown} tooltip={sortLabel} onClick={cycleSort}>
                  Sort
                </Button>
                {filterOpen ? (
                  <div className="flex items-center gap-2 bg-bg border border-line rounded-md pl-2 pr-1 h-8">
                    <Search size={12} className="text-ink-faint shrink-0" />
                    <input
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      placeholder="Filter carried gear"
                      autoFocus
                      className="text-xs bg-transparent text-ink w-28 focus:outline-none"
                    />
                    <button
                      onClick={() => { setFilterOpen(false); setFilterQuery('') }}
                      className="text-ink-faint hover:text-ink-dim text-xs px-1"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <Button variant="outline" icon={Filter} onClick={() => setFilterOpen(true)}>
                    Filter
                  </Button>
                )}
                <Button icon={Plus} onClick={() => setAddingGear((v) => !v)}>
                  Add item
                </Button>
              </div>
            )}
          </div>
        </div>
        )
      })()}

      <h2 className="text-sm font-semibold text-ink uppercase tracking-wide border-b border-line-soft pb-2 mb-4 mt-8">Abilities</h2>
      <div className="bg-panel rounded-lg p-4 mb-4">
        <p className="text-xs text-ink-dim mb-2">Talents</p>
        {talents.length === 0 && <p className="text-xs text-ink-faint">None yet.</p>}
        <ul>
          {talents.map((t) => (
            <li key={t.id} className="text-[11px] text-ink-dim mb-1">
              {t.description} <span className="text-ink-faint">({t.source})</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-panel rounded-lg p-4 mb-4">
        <p className="text-xs text-ink-dim mb-3 flex items-center gap-2">
          <Shield size={12} /> Class &amp; Ancestry Features
        </p>
        {features.length === 0 && <p className="text-xs text-ink-faint">None yet.</p>}
        <div className="flex flex-col gap-2">
          {features.map((f) => (
            <div key={f.id} className="text-xs p-3 bg-panel2/60 rounded-md border border-line">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-ink font-medium">{f.name}</span>
                  <span className="text-[10px] text-ink-faint ml-2">({f.source})</span>
                </div>
                {canEdit && (
                  <button onClick={() => removeFeature(f)} className="text-ink-faint hover:text-danger-text shrink-0">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <p className="text-ink-dim mt-1">{f.description}</p>
              {f.uses_max != null && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[11px] text-ink-dim">
                    {f.uses_current ?? 0} / {f.uses_max} uses
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => spendFeatureUse(f)}
                      disabled={(f.uses_current ?? 0) <= 0}
                      className="text-[11px] border border-line rounded px-2 py-1 text-ink-dim disabled:opacity-40"
                    >
                      Spend
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-panel rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <p className="text-xs text-ink-dim flex items-center gap-2">
            <Sparkles size={12} /> Spells
          </p>
          {canEdit && (
            <button
              onClick={completeFullRest}
              disabled={resting}
              className="text-[11px] border border-line rounded px-2 py-1 text-ink-dim hover:bg-panel2 disabled:opacity-50"
            >
              {resting ? 'Resting…' : 'Complete full rest'}
            </button>
          )}
        </div>
        {restError && <p className="text-[11px] text-danger-text mb-2">{restError}</p>}
        <div className="flex flex-col gap-2 mb-3">
          {spells.length === 0 && <p className="text-xs text-ink-faint">None known yet.</p>}
          {spells.map((spell) => (
            <div key={spell.id} className="text-xs p-3 bg-panel2/60 rounded-md border border-line">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-ink font-medium ${spell.lost ? 'line-through text-ink-faint' : ''}`}>{spell.name}</span>
                  <span className="text-[10px] px-2 py-1 rounded bg-ai-bg text-ai-text border border-ai-line">
                    tier {spell.tier}
                  </span>
                  {(spell.range || spell.duration) && (
                    <span className="text-ink-faint text-[11px]">
                      {[spell.range, spell.duration].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
                {canEdit && (
                  <button onClick={() => removeSpell(spell)} className="text-ink-faint hover:text-danger-text shrink-0">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {spell.description && <p className="text-ink-dim mt-1">{spell.description}</p>}
              <div className="flex items-center gap-3 mt-2">
                <label className="flex items-center gap-2 text-[11px] text-ink-dim">
                  {canEdit ? (
                    <input type="checkbox" checked={spell.prepared} onChange={() => togglePrepared(spell)} />
                  ) : (
                    <span className={`w-2 h-2 rounded-full inline-block ${spell.prepared ? 'bg-primary' : 'bg-panel2'}`} />
                  )}
                  prepared
                </label>
                {spell.succeeded_since_rest && (
                  <span className="text-[11px] text-positive-text">succeeded this rest</span>
                )}
                {spell.lost && (
                  <span className="flex items-center gap-1 text-[11px] text-danger-text">
                    <Ban size={11} /> locked until full rest
                  </span>
                )}
              </div>
              {spell.last_check_natural != null && (
                <p className={`text-[11px] mt-2 ${spell.last_check_succeeded ? 'text-positive-text' : 'text-warning-text'}`}>
                  Last check: natural {spell.last_check_natural}, total {spell.last_check_total}
                  {spell.last_check_natural === 1 ? ' · mishap' : spell.last_check_succeeded ? ' · success' : ' · failure'}
                </p>
              )}
              {canEdit && !spell.lost && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={spellCheckDrafts[spell.id]?.naturalRoll ?? ''}
                    onChange={(e) => updateSpellCheckDraft(spell.id, 'naturalRoll', e.target.value)}
                    placeholder="natural d20"
                    className="w-24 text-[11px] bg-bg border border-line rounded px-2 py-1 text-ink"
                  />
                  <input
                    type="number"
                    value={spellCheckDrafts[spell.id]?.total ?? ''}
                    onChange={(e) => updateSpellCheckDraft(spell.id, 'total', e.target.value)}
                    placeholder={`total vs DC ${10 + spell.tier}`}
                    className="w-28 text-[11px] bg-bg border border-line rounded px-2 py-1 text-ink"
                  />
                  <button
                    onClick={() => recordSpellCheck(spell)}
                    className="text-[11px] border border-line rounded px-2 py-1 text-ink-dim hover:bg-panel2"
                  >
                    Resolve check
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="pt-3 border-t border-line-soft flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                value={spellDraft.name}
                onChange={(e) => setSpellDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Spell name"
                className="flex-1 min-w-0 text-xs bg-bg border border-line rounded-md px-2 py-1 text-ink"
              />
              <select
                value={spellDraft.tier}
                onChange={(e) => setSpellDraft((d) => ({ ...d, tier: e.target.value }))}
                className="text-xs bg-bg border border-line rounded-md px-2 py-1 text-ink"
              >
                {[1, 2, 3, 4, 5].map((t) => (
                  <option key={t} value={t}>
                    tier {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <input
                value={spellDraft.range}
                onChange={(e) => setSpellDraft((d) => ({ ...d, range: e.target.value }))}
                placeholder="Range (e.g. Near)"
                className="flex-1 min-w-0 text-xs bg-bg border border-line rounded-md px-2 py-1 text-ink"
              />
              <input
                value={spellDraft.duration}
                onChange={(e) => setSpellDraft((d) => ({ ...d, duration: e.target.value }))}
                placeholder="Duration (e.g. Focus)"
                className="flex-1 min-w-0 text-xs bg-bg border border-line rounded-md px-2 py-1 text-ink"
              />
            </div>
            <div className="flex gap-2">
              <input
                value={spellDraft.description}
                onChange={(e) => setSpellDraft((d) => ({ ...d, description: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addSpell()}
                placeholder="Quick reminder of the effect (optional -- full text lives in the rules library)"
                className="flex-1 min-w-0 text-xs bg-bg border border-line rounded-md px-2 py-1 text-ink"
              />
              <button onClick={addSpell} className="text-xs border border-line rounded-md px-2 py-1 flex items-center gap-1 text-ink hover:bg-panel2 shrink-0">
                <Plus size={13} /> Add
              </button>
            </div>
          </div>
        )}
      </div>

      <h2 className="text-sm font-semibold text-ink uppercase tracking-wide border-b border-line-soft pb-2 mb-4 mt-8">Notes</h2>
        <div className="bg-panel rounded-lg p-4 text-xs text-ink-faint">
          Notes aren't wired up yet -- this section is reserved for freeform character notes once that's built.
        </div>
    </div>
  )
}
