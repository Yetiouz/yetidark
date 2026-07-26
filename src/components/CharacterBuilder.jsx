import { useState, useEffect } from 'react'
import { Dices, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const STAT_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' }
const ALIGNMENTS = ['Lawful', 'Neutral', 'Chaotic']

const ANCESTRIES = [
  { name: 'Human', trait: 'Ambitious — one additional talent roll at 1st level.', talentBonus: 1 },
  { name: 'Elf', trait: 'Farsight — +1 to ranged attacks or spellcasting checks.' },
  { name: 'Dwarf', trait: 'Stout — +2 HP, roll hit points per level with advantage.', hpBonus: 2 },
  { name: 'Halfling', trait: 'Stealthy — once per day, turn invisible for 3 rounds.' },
  { name: 'Goblin', trait: "Keen senses — you can't be surprised." },
  { name: 'Half-orc', trait: 'Mighty — +1 to melee attack and damage rolls.' },
]

const CLASSES = [
  { name: 'Fighter', hitDie: 8, blurb: 'All weapons and armor.' },
  { name: 'Priest', hitDie: 6, blurb: 'Club, crossbow, dagger, mace, longsword, staff, warhammer.' },
  { name: 'Thief', hitDie: 4, blurb: 'Club, crossbow, dagger, shortbow, shortsword.' },
  { name: 'Wizard', hitDie: 4, blurb: 'Dagger, staff. No armor.' },
]

// Simplified, class-appropriate starting loadout -- not the book's actual
// starting-gear tables, just enough to make "starting gear auto-added"
// true instead of aspirational. A real content-accurate loadout can
// replace this once a rules-library chunk exists to pull from.
const CLASS_STARTING_GEAR = {
  Fighter: { weapon: 'Longsword', armor: 'Chainmail', shield: true },
  Priest: { weapon: 'Mace', armor: 'Leather armor', shield: true },
  Thief: { weapon: 'Shortsword', armor: null, shield: false },
  Wizard: { weapon: 'Dagger', armor: null, shield: false },
}

// Generic adventuring kit, same for every class.
const STARTING_KIT = [
  { name: 'Backpack', slots: 0 },
  { name: 'Torch', slots: 1, quantity: 2 },
  { name: 'Rations', slots: 1, quantity: 3 },
  { name: 'Flint and steel', slots: 1 },
  { name: "Rope, 50'", slots: 1 },
]

// A small, generic talent pool -- deliberately not the book's actual
// talent tables (which are specific, copyrighted content), just enough
// variety that two characters of the same class don't feel identical.
const TALENT_POOL = [
  '+1 to attack rolls',
  '+1 to damage rolls',
  '+2 max HP',
  '+1 to one ability score of your choice (max 18)',
  'Advantage on saves against one condition you choose',
  'Learn one extra language',
]

function rollStat() {
  return [0, 0, 0].reduce((sum) => sum + (Math.floor(Math.random() * 6) + 1), 0)
}

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

function rollTalents(count) {
  return Array.from({ length: count }, () => TALENT_POOL[Math.floor(Math.random() * TALENT_POOL.length)])
}

// Not run through the real dice engine (src/lib/dice.js) on purpose --
// there's no campaign scene log yet to log it to at character-creation
// time. Just a quick 5d6 roll for a plausible starting purse.
function rollCoin() {
  return Array.from({ length: 5 }, () => Math.floor(Math.random() * 6) + 1).reduce((a, b) => a + b, 0)
}

const emptyStats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }

export default function CharacterBuilder({ campaignId, session, campaignName = 'The sunken keep', onComplete }) {
  const [stats, setStats] = useState(emptyStats)
  const [ancestry, setAncestry] = useState('Dwarf')
  const [charClass, setCharClass] = useState('Fighter')
  const [name, setName] = useState('')
  const [alignment, setAlignment] = useState('Neutral')
  const [background, setBackground] = useState('')
  const [talents, setTalents] = useState([])
  const [coin, setCoin] = useState(() => rollCoin())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const selectedAncestry = ANCESTRIES.find((a) => a.name === ancestry)

  // Re-roll talents whenever ancestry changes, since ancestry can grant an
  // extra roll (e.g. Human's Ambitious). Also covers the initial roll.
  useEffect(() => {
    const count = 1 + (selectedAncestry?.talentBonus || 0)
    setTalents(rollTalents(count))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ancestry])

  const rerollTalents = () => {
    const count = 1 + (selectedAncestry?.talentBonus || 0)
    setTalents(rollTalents(count))
  }

  const rollAll = () => {
    const next = {}
    STAT_KEYS.forEach((k) => {
      next[k] = rollStat()
    })
    setStats(next)
  }

  const setStat = (key, value) => {
    const n = parseInt(value, 10)
    setStats((s) => ({ ...s, [key]: Number.isNaN(n) ? 0 : n }))
  }

  const selectedClass = CLASSES.find((c) => c.name === charClass)
  const conMod = modifier(stats.con)
  const dexMod = modifier(stats.dex)
  const hpBonus = selectedAncestry?.hpBonus || 0
  // Simplified for the quick builder: take the max hit die roll rather than
  // an actual roll, since Con modifier and ancestry bonuses already vary
  // outcomes. Real dice-roll-per-level HP can come later.
  const computedHp = Math.max(1, selectedClass.hitDie + conMod + hpBonus)
  const startingGear = CLASS_STARTING_GEAR[charClass]
  // Base AC before armor -- refined below once armor is factored in.
  const armorBonus = startingGear.armor ? 4 : 0 // rough stand-in until real armor data exists
  const shieldBonus = startingGear.shield ? 2 : 0
  const computedAc = 10 + dexMod + armorBonus + shieldBonus

  const start = async () => {
    const finalName = name.trim() || `${ancestry} ${charClass.toLowerCase()}`

    if (!campaignId || !session?.user) {
      // No real campaign/session context (e.g. still on mock data) --
      // fall back to just handing the character up without saving.
      onComplete && onComplete({ name: finalName, ancestry, charClass, stats, hp: computedHp })
      return
    }

    setSaving(true)
    setError(null)

    const { data: character, error: insertError } = await supabase
      .from('characters')
      .insert({
        campaign_id: campaignId,
        owner_user_id: session.user.id,
        name: finalName,
        ancestry,
        class: charClass,
        level: 1,
        stats,
        hp: computedHp,
        max_hp: computedHp,
        ac: computedAc,
        alignment,
        background: background.trim() || null,
        xp: 0,
        coin,
      })
      .select()
      .single()

    if (insertError) {
      setSaving(false)
      setError(insertError.message)
      return
    }

    // Build the gear rows: the generic kit, plus a class-appropriate
    // weapon/armor/shield marked equipped.
    const gearRows = [
      ...STARTING_KIT.map((item) => ({
        character_id: character.id,
        name: item.name,
        slots: item.slots,
        quantity: item.quantity || 1,
        equipped: false,
      })),
      { character_id: character.id, name: startingGear.weapon, slots: 1, quantity: 1, equipped: true },
      ...(startingGear.armor
        ? [{ character_id: character.id, name: startingGear.armor, slots: 1, quantity: 1, equipped: true }]
        : []),
      ...(startingGear.shield
        ? [{ character_id: character.id, name: 'Shield', slots: 1, quantity: 1, equipped: true }]
        : []),
    ]

    const talentRows = talents.map((description) => ({
      character_id: character.id,
      source: 'class/ancestry talent roll',
      description,
    }))

    const [{ error: gearError }, { error: talentError }] = await Promise.all([
      supabase.from('character_gear').insert(gearRows),
      talentRows.length ? supabase.from('character_talents').insert(talentRows) : Promise.resolve({ error: null }),
    ])

    setSaving(false)
    if (gearError || talentError) {
      setError((gearError || talentError).message)
      return
    }

    onComplete && onComplete(character)
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      <p className="text-xs text-neutral-400 mb-0.5">{campaignName}</p>
      <h1 className="text-white text-lg font-medium mb-4">Build your character</h1>

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-neutral-400">1. Roll your stats (3d6 each)</p>
        <button
          onClick={rollAll}
          className="text-xs border border-neutral-700 rounded-md px-2.5 py-1 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800"
        >
          <Dices size={13} /> Roll all
        </button>
      </div>
      <div className="grid grid-cols-6 gap-1.5 mb-1.5">
        {STAT_KEYS.map((k) => (
          <div key={k} className="bg-neutral-900 rounded-md p-1.5 text-center">
            <p className="text-[10px] text-neutral-400 mb-1">{STAT_LABELS[k]}</p>
            <input
              type="number"
              value={stats[k]}
              onChange={(e) => setStat(k, e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-700 rounded text-center text-sm text-white py-0.5"
            />
            <p className="text-[10px] text-neutral-500 mt-1">
              {modifier(stats[k]) >= 0 ? `+${modifier(stats[k])}` : modifier(stats[k])}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-neutral-500 mb-4">
        "Roll all" fills these in for you, or type in numbers straight off your own dice.
      </p>

      <p className="text-xs text-neutral-400 mb-2">2. Pick your ancestry</p>
      <div className="grid grid-cols-3 gap-1.5 mb-1.5">
        {ANCESTRIES.map((a) => (
          <button
            key={a.name}
            onClick={() => setAncestry(a.name)}
            className={`text-xs py-2 rounded-md border ${
              ancestry === a.name
                ? 'bg-neutral-800 border-blue-500 text-white'
                : 'border-neutral-700 text-neutral-200 hover:bg-neutral-800'
            }`}
          >
            {a.name}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-neutral-400 mb-4">
        {ancestry} — {selectedAncestry.trait}
      </p>

      <p className="text-xs text-neutral-400 mb-2">3. Pick your class</p>
      <div className="grid grid-cols-4 gap-1.5 mb-1.5">
        {CLASSES.map((c) => (
          <button
            key={c.name}
            onClick={() => setCharClass(c.name)}
            className={`text-xs py-2 rounded-md border ${
              charClass === c.name
                ? 'bg-neutral-800 border-blue-500 text-white'
                : 'border-neutral-700 text-neutral-200 hover:bg-neutral-800'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-neutral-400 mb-4">
        {charClass} — 1d{selectedClass.hitDie} hit points per level. {selectedClass.blurb}
      </p>

      <p className="text-xs text-neutral-400 mb-2">4. Alignment &amp; background</p>
      <div className="grid grid-cols-3 gap-1.5 mb-1.5">
        {ALIGNMENTS.map((a) => (
          <button
            key={a}
            onClick={() => setAlignment(a)}
            className={`text-xs py-1.5 rounded-md border ${
              alignment === a
                ? 'bg-neutral-800 border-blue-500 text-white'
                : 'border-neutral-700 text-neutral-200 hover:bg-neutral-800'
            }`}
          >
            {a}
          </button>
        ))}
      </div>
      <input
        value={background}
        onChange={(e) => setBackground(e.target.value)}
        placeholder="Background (e.g. Blacksmith, Orphan, Scholar) — optional"
        className="w-full bg-neutral-900 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white mb-4"
      />

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-neutral-400">5. Talents</p>
        <button
          onClick={rerollTalents}
          className="text-xs border border-neutral-700 rounded-md px-2.5 py-1 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800"
        >
          <Dices size={13} /> Reroll
        </button>
      </div>
      <ul className="mb-4">
        {talents.map((t, i) => (
          <li key={i} className="text-[11px] text-neutral-300 bg-neutral-900 rounded-md px-2.5 py-1.5 mb-1">
            {t}
          </li>
        ))}
      </ul>

      <p className="text-xs text-neutral-400 mb-2">6. Name your character</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Rendil the bold"
        className="w-full bg-neutral-900 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white mb-4"
      />

      <div className="bg-neutral-900 rounded-md px-3.5 py-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm font-medium text-white">
              {ancestry} {charClass.toLowerCase()} &middot; level 1 &middot; {alignment}
            </p>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              {computedHp} hp (1d{selectedClass.hitDie}{hpBonus ? ` + ${hpBonus} stout` : ''}
              {conMod ? ` ${conMod >= 0 ? '+' : ''}${conMod} con` : ''}) &middot; ac {computedAc} &middot; {coin} gp
            </p>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Starting gear: {startingGear.weapon}{startingGear.armor ? `, ${startingGear.armor}` : ''}
              {startingGear.shield ? ', shield' : ''}, backpack &amp; crawling kit
            </p>
            {error && (
              <div className="flex items-center gap-1.5 text-red-400 mt-1.5">
                <AlertCircle size={12} />
                <p className="text-[11px]">{error}</p>
              </div>
            )}
          </div>
          <button
            onClick={start}
            disabled={saving}
            className="bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm rounded-md px-3.5 py-2 whitespace-nowrap"
          >
            {saving ? 'Saving...' : 'Start playing'}
          </button>
        </div>
      </div>
    </div>
  )
}
