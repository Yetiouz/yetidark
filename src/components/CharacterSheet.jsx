import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Trash2, Upload, User, Sparkles, Ban, Shield } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const STAT_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' }

function modifier(score) {
  if (score >= 18) return 4
  if (score >= 16) return 3
  if (score >= 14) return 2
  if (score >= 12) return 1
  if (score >= 10) return 0
  if (score >= 8) return -1
  if (score >= 6) return -2
  if (score >= 4) return -3
  return -4
}

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
  const [loading, setLoading] = useState(true)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState(null)
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

  const adjustHp = async (delta) => {
    if (!character) return
    const nextHp = Math.max(0, Math.min(character.max_hp, character.hp + delta))
    setCharacter((c) => ({ ...c, hp: nextHp }))
    await supabase.from('characters').update({ hp: nextHp }).eq('id', characterId)
  }

  const adjustXp = async (delta) => {
    if (!character) return
    const nextXp = Math.max(0, character.xp + delta)
    setCharacter((c) => ({ ...c, xp: nextXp }))
    await supabase.from('characters').update({ xp: nextXp }).eq('id', characterId)
  }

  const adjustCoin = async (delta) => {
    if (!character) return
    const nextCoin = Math.max(0, Number(character.coin) + delta)
    setCharacter((c) => ({ ...c, coin: nextCoin }))
    await supabase.from('characters').update({ coin: nextCoin }).eq('id', characterId)
  }

  const toggleEquipped = async (item) => {
    const nextGear = gear.map((i) => (i.id === item.id ? { ...i, equipped: !i.equipped } : i))
    setGear(nextGear)
    await supabase.from('character_gear').update({ equipped: !item.equipped }).eq('id', item.id)

    const dexMod = modifier((character.stats || {}).dex ?? 10)
    const equippedArmor = nextGear.find((g) => g.equipped && g.base_ac != null)
    const equippedShield = nextGear.find((g) => g.equipped && g.is_shield)
    const baseAc = equippedArmor ? equippedArmor.base_ac + (equippedArmor.dex_applies ? dexMod : 0) : 10 + dexMod
    const nextAc = baseAc + (equippedShield ? 2 : 0)
    if (nextAc !== character.ac) {
      setCharacter((c) => ({ ...c, ac: nextAc }))
      await supabase.from('characters').update({ ac: nextAc }).eq('id', characterId)
    }
  }

  const removeGear = async (item) => {
    setGear((g) => g.filter((i) => i.id !== item.id))
    await supabase.from('character_gear').delete().eq('id', item.id)
  }

  const addGear = async () => {
    const name = gearDraft.trim()
    if (!name || !characterId) return
    await supabase.from('character_gear').insert({ character_id: characterId, name, slots: 1, quantity: 1, equipped: false })
    setGearDraft('')
  }

  const spendFeatureUse = async (feature) => {
    const next = Math.max(0, (feature.uses_current ?? 0) - 1)
    setFeatures((f) => f.map((i) => (i.id === feature.id ? { ...i, uses_current: next } : i)))
    await supabase.from('character_features').update({ uses_current: next }).eq('id', feature.id)
  }

  // No rest-tracking feature yet (same situation as the Lost-spell toggle),
  // so restoring a daily-use feature like Halfling's Stealthy is a manual
  // "I rested" acknowledgement rather than something on a timer.
  const resetFeatureUse = async (feature) => {
    setFeatures((f) => f.map((i) => (i.id === feature.id ? { ...i, uses_current: feature.uses_max } : i)))
    await supabase.from('character_features').update({ uses_current: feature.uses_max }).eq('id', feature.id)
  }

  const removeFeature = async (feature) => {
    setFeatures((f) => f.filter((i) => i.id !== feature.id))
    await supabase.from('character_features').delete().eq('id', feature.id)
  }

  const togglePrepared = async (spell) => {
    setSpells((s) => s.map((i) => (i.id === spell.id ? { ...i, prepared: !i.prepared } : i)))
    await supabase.from('character_spells').update({ prepared: !spell.prepared }).eq('id', spell.id)
  }

  // Toggling a spell back from Lost is the "benefited from a full rest"
  // moment in Shadowdark's rules -- there's no separate rest-tracking
  // feature yet, so this is a manual acknowledgement rather than
  // something the app enforces on a timer.
  const toggleLost = async (spell) => {
    setSpells((s) => s.map((i) => (i.id === spell.id ? { ...i, lost: !i.lost } : i)))
    await supabase.from('character_spells').update({ lost: !spell.lost }).eq('id', spell.id)
  }

  const removeSpell = async (spell) => {
    setSpells((s) => s.filter((i) => i.id !== spell.id))
    await supabase.from('character_spells').delete().eq('id', spell.id)
  }

  const addSpell = async () => {
    const name = spellDraft.name.trim()
    if (!name || !characterId) return
    await supabase.from('character_spells').insert({
      character_id: characterId,
      name,
      tier: Number(spellDraft.tier) || 1,
      range: spellDraft.range.trim() || null,
      duration: spellDraft.duration.trim() || null,
      description: spellDraft.description.trim() || null,
      prepared: false,
      lost: false,
    })
    setSpellDraft({ name: '', tier: 1, range: '', duration: '', description: '' })
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
        <p className="text-xs text-neutral-500">Loading character…</p>
      </div>
    )
  }

  const stats = character.stats || {}
  const maxSlots = Math.max(stats.str || 10, 10)
  const usedSlots = gear.reduce((sum, item) => sum + Number(item.slots) * (item.quantity || 1), 0)

  return (
    <div className="max-w-xl mx-auto p-6">
      {onBack && (
        <button onClick={onBack} className="text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1 mb-3">
          <ArrowLeft size={13} /> Ba