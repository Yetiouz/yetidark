import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Trash2, Upload, User, Sparkles, Ban } from 'lucide-react'
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

      const [{ data: gearRows }, { data: talentRows }, { data: spellRows }] = await Promise.all([
        supabase.from('character_gear').select('*').eq('character_id', characterId).order('created_at', { ascending: true }),
        supabase.from('character_talents').select('*').eq('character_id', characterId).order('created_at', { ascending: true }),
        supabase.from('character_spells').select('*').eq('character_id', characterId).order('tier', { ascending: true }),
      ])
      if (!cancelled) {
        setGear(gearRows || [])
        setTalents(talentRows || [])
        setSpells(spellRows || [])
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
    setGear((g) => g.map((i) => (i.id === item.id ? { ...i, equipped: !i.equipped } : i)))
    await supabase.from('character_gear').update({ equipped: !item.equipped }).eq('id', item.id)
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
          className={`w-16 h-16 rounded-full overflow-hidden bg-neutral-900 border border-neutral-700 flex items-center justify-center shrink-0 ${
            isOwner ? 'hover:border-neutral-500 cursor-pointer' : 'cursor-default'
          }`}
          title={isOwner ? (character.avatar_url ? 'Replace portrait' : 'Upload portrait') : undefined}
        >
          {character.avatar_url ? (
            <img src={character.avatar_url} alt={character.name} className="w-full h-full object-cover" />
          ) : (
            <User size={22} className="text-neutral-600" />
          )}
        </button>
        <div>
          <h1 className="text-white text-lg font-medium">{character.name}</h1>
          <p className="text-xs text-neutral-400">
            {character.ancestry} {character.class} &middot; level {character.level} &middot; {character.alignment || 'Unaligned'}
            {character.background ? ` · ${character.background}` : ''}
          </p>
          {isOwner && (
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="text-[11px] text-neutral-500 hover:text-neutral-300 flex items-center gap-1 mt-1"
            >
              <Upload size={11} /> {avatarUploading ? 'Uploading…' : character.avatar_url ? 'Replace portrait' : 'Upload portrait'}
            </button>
          )}
        </div>
      </div>
      {avatarError && <p className="text-xs text-red-400 mb-3">{avatarError}</p>}

      <div className="grid grid-cols-6 gap-1.5 mb-4">
        {STAT_KEYS.map((k) => (
          <div key={k} className="bg-neutral-900 rounded-md p-1.5 text-center">
            <p className="text-[10px] text-neutral-400 mb-1">{STAT_LABELS[k]}</p>
            <p className="text-sm text-white">{stats[k] ?? '-'}</p>
            <p className="text-[10px] text-neutral-500 mt-1">
              {stats[k] != null ? (modifier(stats[k]) >= 0 ? `+${modifier(stats[k])}` : modifier(stats[k])) : ''}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2.5 mb-4">
        <div className="bg-neutral-900 rounded-lg p-3">
          <p className="text-[11px] text-neutral-400 mb-1.5">HP</p>
          <div className="flex items-center justify-between">
            {canEdit && <button onClick={() => adjustHp(-1)} className="px-1.5 border border-neutral-700 rounded text-neutral-300">-</button>}
            <span className="text-sm text-white">{character.hp} / {character.max_hp}</span>
            {canEdit && <button onClick={() => adjustHp(1)} className="px-1.5 border border-neutral-700 rounded text-neutral-300">+</button>}
          </div>
          <p className="text-[11px] text-neutral-500 mt-1.5">ac {character.ac}</p>
        </div>

        <div className="bg-neutral-900 rounded-lg p-3">
          <p className="text-[11px] text-neutral-400 mb-1.5">XP</p>
          <div className="flex items-center justify-between">
            {canEdit && <button onClick={() => adjustXp(-1)} className="px-1.5 border border-neutral-700 rounded text-neutral-300">-</button>}
            <span className="text-sm text-white">{character.xp}</span>
            {canEdit && <button onClick={() => adjustXp(1)} className="px-1.5 border border-neutral-700 rounded text-neutral-300">+</button>}
          </div>
        </div>

        <div className="bg-neutral-900 rounded-lg p-3">
          <p className="text-[11px] text-neutral-400 mb-1.5">Coin</p>
          <div className="flex items-center justify-between">
            {canEdit && <button onClick={() => adjustCoin(-1)} className="px-1.5 border border-neutral-700 rounded text-neutral-300">-</button>}
            <span className="text-sm text-white">{character.coin} gp</span>
            {canEdit && <button onClick={() => adjustCoin(1)} className="px-1.5 border border-neutral-700 rounded text-neutral-300">+</button>}
          </div>
        </div>
      </div>

      <div className="bg-neutral-900 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-xs text-neutral-400">
            Gear &middot; {usedSlots} / {maxSlots} slots
          </p>
          {canEdit && (
            <div className="flex gap-1.5">
              <input
                value={gearDraft}
                onChange={(e) => setGearDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGear()}
                placeholder="Item name"
                className="text-xs bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 w-32 text-white"
              />
              <button onClick={addGear} className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1 text-neutral-200 hover:bg-neutral-800">
                <Plus size={13} /> Add
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {gear.length === 0 && <p className="text-xs text-neutral-500">No gear yet.</p>}
          {gear.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-xs p-2 bg-neutral-800/60 rounded-md border border-neutral-700">
              <label className="flex items-center gap-2 flex-1">
                {canEdit ? (
                  <input type="checkbox" checked={item.equipped} onChange={() => toggleEquipped(item)} />
                ) : (
                  <span className={`w-2 h-2 rounded-full inline-block ${item.equipped ? 'bg-blue-400' : 'bg-neutral-600'}`} />
                )}
                <span className="text-white">{item.name}</span>
                {item.quantity > 1 && <span className="text-neutral-500">&times;{item.quantity}</span>}
                <span className="text-neutral-500">
                  {item.slots} slot{Number(item.slots) === 1 ? '' : 's'}
                  {item.equipped ? ' · equipped' : ''}
                </span>
              </label>
              {canEdit && (
                <button onClick={() => removeGear(item)} className="text-neutral-500 hover:text-red-400">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-neutral-900 rounded-lg p-4 mb-4">
        <p className="text-xs text-neutral-400 mb-2">Talents</p>
        {talents.length === 0 && <p className="text-xs text-neutral-500">None yet.</p>}
        <ul>
          {talents.map((t) => (
            <li key={t.id} className="text-[11px] text-neutral-300 mb-1">
              {t.description} <span className="text-neutral-600">({t.source})</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-neutral-900 rounded-lg p-4">
        <p className="text-xs text-neutral-400 mb-2.5 flex items-center gap-1.5">
          <Sparkles size={12} /> Spells
        </p>
        <div className="flex flex-col gap-1.5 mb-3">
          {spells.length === 0 && <p className="text-xs text-neutral-500">None known yet.</p>}
          {spells.map((spell) => (
            <div key={spell.id} className="text-xs p-2.5 bg-neutral-800/60 rounded-md border border-neutral-700">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-white font-medium ${spell.lost ? 'line-through text-neutral-500' : ''}`}>{spell.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/20">
                    tier {spell.tier}
                  </span>
                  {(spell.range || spell.duration) && (
                    <span className="text-neutral-500 text-[11px]">
                      {[spell.range, spell.duration].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
                {canEdit && (
                  <button onClick={() => removeSpell(spell)} className="text-neutral-500 hover:text-red-400 shrink-0">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {spell.description && <p className="text-neutral-400 mt-1">{spell.description}</p>}
              <div className="flex items-center gap-3 mt-2">
                <label className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                  {canEdit ? (
                    <input type="checkbox" checked={spell.prepared} onChange={() => togglePrepared(spell)} />
                  ) : (
                    <span className={`w-2 h-2 rounded-full inline-block ${spell.prepared ? 'bg-blue-400' : 'bg-neutral-600'}`} />
                  )}
                  prepared
                </label>
                {canEdit ? (
                  <button
                    onClick={() => toggleLost(spell)}
                    className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border ${
                      spell.lost
                        ? 'text-red-300 border-red-500/30 bg-red-500/10'
                        : 'text-neutral-500 border-neutral-700 hover:text-neutral-300'
                    }`}
                  >
                    <Ban size={11} /> {spell.lost ? 'lost -- click to restore' : 'mark lost'}
                  </button>
                ) : (
                  spell.lost && (
                    <span className="flex items-center gap-1 text-[11px] text-red-300">
                      <Ban size={11} /> lost
                    </span>
                  )
                )}
              </div>
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="pt-3 border-t border-neutral-800 flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              <input
                value={spellDraft.name}
                onChange={(e) => setSpellDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Spell name"
                className="flex-1 min-w-0 text-xs bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-white"
              />
              <select
                value={spellDraft.tier}
                onChange={(e) => setSpellDraft((d) => ({ ...d, tier: e.target.value }))}
                className="text-xs bg-neutral-950 border border-neutral-700 rounded-md px-1.5 py-1 text-white"
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
                className="flex-1 min-w-0 text-xs bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-white"
              />
              <input
                value={spellDraft.duration}
                onChange={(e) => setSpellDraft((d) => ({ ...d, duration: e.target.value }))}
                placeholder="Duration (e.g. Focus)"
                className="flex-1 min-w-0 text-xs bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-white"
              />
            </div>
            <div className="flex gap-1.5">
              <input
                value={spellDraft.description}
                onChange={(e) => setSpellDraft((d) => ({ ...d, description: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addSpell()}
                placeholder="Quick reminder of the effect (optional -- full text lives in the rules library)"
                className="flex-1 min-w-0 text-xs bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1 text-white"
              />
              <button onClick={addSpell} className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1 text-neutral-200 hover:bg-neutral-800 shrink-0">
                <Plus size={13} /> Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
