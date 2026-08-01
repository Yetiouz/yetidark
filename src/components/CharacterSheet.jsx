import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Trash2, Upload, User, Sparkles, Ban, Shield } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import Tabs from './ui/Tabs.jsx'
import {
  abilityModifier,
  gearSlotCapacity,
  occupiedGearSlots,
  resolveSpellCheck,
} from '../game/rules/character.js'

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const STAT_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' }

// Matches design-handoff-spec Section 2.6 / Section 4.4's Overview/Gear/
// Abilities/Notes/History tab row. "History" is left out here rather than
// faked -- there's no audit-log read path wired up for a character yet, so
// a History tab would just be a permanent empty state. Add it once that
// data actually exists instead of shipping a tab that never has content.
const SHEET_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'gear', label: 'Gear' },
  { key: 'abilities', label: 'Abilities' },
  { key: 'notes', label: 'Notes' },
]

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
  const [activeTab, setActiveTab] = useState('overview')
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
      <div className="max-w-xl mx-auto p-6">
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

  return (
    <div className="max-w-xl mx-auto p-6">
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

      <Tabs tabs={SHEET_TABS} activeKey={activeTab} onChange={setActiveTab} />

      {activeTab === 'overview' && (
      <>
      <div className="grid grid-cols-6 gap-1.5 mb-4">
        {STAT_KEYS.map((k) => (
          <div key={k} className="bg-panel rounded-md p-1.5 text-center">
            <p className="text-[10px] text-ink-dim mb-1">{STAT_LABELS[k]}</p>
            <p className="text-sm text-ink">{stats[k] ?? '-'}</p>
            <p className="text-[10px] text-ink-faint mt-1">
              {stats[k] != null ? (modifier(stats[k]) >= 0 ? `+${modifier(stats[k])}` : modifier(stats[k])) : ''}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2.5 mb-4">
        <div className="bg-panel rounded-lg p-3">
          <p className="text-[11px] text-ink-dim mb-1.5">HP</p>
          <div className="flex items-center justify-between">
            {canEdit && <button disabled={!changeReason.trim() || resourceChanging} onClick={() => adjustResource('hp', -1)} className="px-1.5 border border-line rounded text-ink-dim disabled:opacity-40">-</button>}
            <span className="text-sm text-ink">{character.hp} / {character.max_hp}</span>
            {canEdit && <button disabled={!changeReason.trim() || resourceChanging} onClick={() => adjustResource('hp', 1)} className="px-1.5 border border-line rounded text-ink-dim disabled:opacity-40">+</button>}
          </div>
          <p className="text-[11px] text-ink-faint mt-1.5">ac {character.ac}</p>
        </div>

        <div className="bg-panel rounded-lg p-3">
          <p className="text-[11px] text-ink-dim mb-1.5">XP</p>
          <div className="flex items-center justify-between">
            {canEdit && <button disabled={!changeReason.trim() || resourceChanging} onClick={() => adjustResource('xp', -1)} className="px-1.5 border border-line rounded text-ink-dim disabled:opacity-40">-</button>}
            <span className="text-sm text-ink">{character.xp}</span>
            {canEdit && <button disabled={!changeReason.trim() || resourceChanging} onClick={() => adjustResource('xp', 1)} className="px-1.5 border border-line rounded text-ink-dim disabled:opacity-40">+</button>}
          </div>
        </div>

        <div className="bg-panel rounded-lg p-3">
          <p className="text-[11px] text-ink-dim mb-1.5">Coin</p>
          <div className="flex items-center justify-between">
            {canEdit && <button disabled={!changeReason.trim() || resourceChanging} onClick={() => adjustResource('coin', -1)} className="px-1.5 border border-line rounded text-ink-dim disabled:opacity-40">-</button>}
            <span className="text-sm text-ink">{character.coin} gp</span>
            {canEdit && <button disabled={!changeReason.trim() || resourceChanging} onClick={() => adjustResource('coin', 1)} className="px-1.5 border border-line rounded text-ink-dim disabled:opacity-40">+</button>}
          </div>
        </div>
      </div>
      {canEdit && (
        <div className="mb-4">
          <label className="text-[11px] text-ink-dim block mb-1.5">
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
      </>
      )}

      {activeTab === 'gear' && (
      <div className="bg-panel rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-xs text-ink-dim">
            Gear &middot; {usedSlots} / {maxSlots} slots
          </p>
          {canEdit && (
            <div className="flex gap-1.5">
              <input
                value={gearDraft}
                onChange={(e) => setGearDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGear()}
                placeholder="Item name"
                className="text-xs bg-bg border border-line rounded-md px-2 py-1 w-32 text-ink"
              />
              <button onClick={addGear} className="text-xs border border-line rounded-md px-2 py-1 flex items-center gap-1 text-ink hover:bg-panel2">
                <Plus size={13} /> Add
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {gear.length === 0 && <p className="text-xs text-ink-faint">No gear yet.</p>}
          {gear.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-xs p-2 bg-panel2/60 rounded-md border border-line">
              <label className="flex items-center gap-2 flex-1">
                {canEdit ? (
                  <input type="checkbox" checked={item.equipped} onChange={() => toggleEquipped(item)} />
                ) : (
                  <span className={`w-2 h-2 rounded-full inline-block ${item.equipped ? 'bg-primary' : 'bg-panel2'}`} />
                )}
                <span className="text-ink">{item.name}</span>
                {item.quantity > 1 && <span className="text-ink-faint">&times;{item.quantity}</span>}
                <span className="text-ink-faint">
                  {item.slots} slot{Number(item.slots) === 1 ? '' : 's'}
                  {item.equipped ? ' · equipped' : ''}
                </span>
              </label>
              {canEdit && (
                <button onClick={() => removeGear(item)} className="text-ink-faint hover:text-danger-text">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      )}

      {activeTab === 'abilities' && (
      <>
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
        <p className="text-xs text-ink-dim mb-2.5 flex items-center gap-1.5">
          <Shield size={12} /> Class &amp; Ancestry Features
        </p>
        {features.length === 0 && <p className="text-xs text-ink-faint">None yet.</p>}
        <div className="flex flex-col gap-1.5">
          {features.map((f) => (
            <div key={f.id} className="text-xs p-2.5 bg-panel2/60 rounded-md border border-line">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-ink font-medium">{f.name}</span>
                  <span className="text-[10px] text-ink-faint ml-1.5">({f.source})</span>
                </div>
                {canEdit && (
                  <button onClick={() => removeFeature(f)} className="text-ink-faint hover:text-danger-text shrink-0">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <p className="text-ink-dim mt-1">{f.description}</p>
              {f.uses_max != null && (
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[11px] text-ink-dim">
                    {f.uses_current ?? 0} / {f.uses_max} uses
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => spendFeatureUse(f)}
                      disabled={(f.uses_current ?? 0) <= 0}
                      className="text-[11px] border border-line rounded px-1.5 py-0.5 text-ink-dim disabled:opacity-40"
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
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <p className="text-xs text-ink-dim flex items-center gap-1.5">
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
        <div className="flex flex-col gap-1.5 mb-3">
          {spells.length === 0 && <p className="text-xs text-ink-faint">None known yet.</p>}
          {spells.map((spell) => (
            <div key={spell.id} className="text-xs p-2.5 bg-panel2/60 rounded-md border border-line">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-ink font-medium ${spell.lost ? 'line-through text-ink-faint' : ''}`}>{spell.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-ai-bg text-ai-text border border-ai-line">
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
                <label className="flex items-center gap-1.5 text-[11px] text-ink-dim">
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
                <p className={`text-[11px] mt-1.5 ${spell.last_check_succeeded ? 'text-positive-text' : 'text-warning-text'}`}>
                  Last check: natural {spell.last_check_natural}, total {spell.last_check_total}
                  {spell.last_check_natural === 1 ? ' · mishap' : spell.last_check_succeeded ? ' · success' : ' · failure'}
                </p>
              )}
              {canEdit && !spell.lost && (
                <div className="flex items-center gap-1.5 mt-2">
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={spellCheckDrafts[spell.id]?.naturalRoll ?? ''}
                    onChange={(e) => updateSpellCheckDraft(spell.id, 'naturalRoll', e.target.value)}
                    placeholder="natural d20"
                    className="w-24 text-[11px] bg-bg border border-line rounded px-1.5 py-1 text-ink"
                  />
                  <input
                    type="number"
                    value={spellCheckDrafts[spell.id]?.total ?? ''}
                    onChange={(e) => updateSpellCheckDraft(spell.id, 'total', e.target.value)}
                    placeholder={`total vs DC ${10 + spell.tier}`}
                    className="w-28 text-[11px] bg-bg border border-line rounded px-1.5 py-1 text-ink"
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
          <div className="pt-3 border-t border-line-soft flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              <input
                value={spellDraft.name}
                onChange={(e) => setSpellDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Spell name"
                className="flex-1 min-w-0 text-xs bg-bg border border-line rounded-md px-2 py-1 text-ink"
              />
              <select
                value={spellDraft.tier}
                onChange={(e) => setSpellDraft((d) => ({ ...d, tier: e.target.value }))}
                className="text-xs bg-bg border border-line rounded-md px-1.5 py-1 text-ink"
              >
                {[1, 2, 3, 4, 5].map((t) => (
                  <option key={t} value={t}>
                    tier {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-1.5">
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
            <div className="flex gap-1.5">
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
      </>
      )}

      {activeTab === 'notes' && (
        <div className="bg-panel rounded-lg p-4 text-xs text-ink-faint">
          Notes aren't wired up yet -- this tab is reserved for freeform character notes once that's built.
        </div>
      )}
    </div>
  )
}
