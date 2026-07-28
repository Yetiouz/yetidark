import { useState, useEffect } from 'react'
import { Dices, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const STAT_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' }
const ALIGNMENTS = ['Lawful', 'Neutral', 'Chaotic']

// Real core-rulebook data (Shadowdark RPG, The Arcane Library) -- ancestries,
// classes, weapons, armor, talent tables, and backgrounds transcribed from
// the corebook rather than the earlier placeholder set, per the Shadowdark
// RPG Third-Party License (real names/mechanics, not verbatim book layout
// or art). Cursed Scroll ancestries/classes are a separate follow-on chunk.
const ANCESTRIES = [
  {
    name: 'Human',
    languages: 'Common, plus one additional common language',
    traitName: 'Ambitious',
    trait: 'You gain one additional talent roll at 1st level.',
    talentBonus: 1,
  },
  {
    name: 'Elf',
    languages: 'Common, Elvish, Sylvan',
    traitName: 'Farsight',
    trait: 'You get a +1 bonus to attack rolls with ranged weapons or a +1 bonus to spellcasting checks.',
  },
  {
    name: 'Dwarf',
    languages: 'Common, Dwarvish',
    traitName: 'Stout',
    trait: 'Start with +2 HP. Roll hit points per level with advantage.',
    hpBonus: 2,
  },
  {
    name: 'Halfling',
    languages: 'Common',
    traitName: 'Stealthy',
    trait: 'Once per day, you can become invisible for 3 rounds.',
    dailyUses: 1,
  },
  {
    name: 'Goblin',
    languages: 'Common, Goblin',
    traitName: 'Keen Senses',
    trait: "You can't be surprised.",
  },
  {
    name: 'Half-orc',
    languages: 'Common, Orcish',
    traitName: 'Mighty',
    trait: 'You have a +1 bonus to attack and damage rolls with melee weapons.',
  },
]

// name, cost (flavor only, not deducted from starting coin), damage,
// properties, gear slots.
const WEAPONS = [
  { name: 'Bastard sword', cost: '10 gp', damage: '1d8/1d10', properties: 'Versatile', slots: 2 },
  { name: 'Club', cost: '5 cp', damage: '1d4', properties: '-', slots: 1 },
  { name: 'Crossbow', cost: '8 gp', damage: '1d6', properties: 'Two-handed, loud', slots: 1 },
  { name: 'Dagger', cost: '1 gp', damage: '1d4', properties: 'Finesse, thrown', slots: 1 },
  { name: 'Greataxe', cost: '10 gp', damage: '1d8/1d10', properties: 'Versatile', slots: 2 },
  { name: 'Greatsword', cost: '12 gp', damage: '1d12', properties: 'Two-handed', slots: 2 },
  { name: 'Javelin', cost: '5 sp', damage: '1d4', properties: 'Thrown', slots: 1 },
  { name: 'Longbow', cost: '8 gp', damage: '1d8', properties: 'Two-handed', slots: 1 },
  { name: 'Longsword', cost: '9 gp', damage: '1d8', properties: '-', slots: 1 },
  { name: 'Mace', cost: '5 gp', damage: '1d6', properties: '-', slots: 1 },
  { name: 'Shortbow', cost: '6 gp', damage: '1d4', properties: 'Two-handed', slots: 1 },
  { name: 'Shortsword', cost: '7 gp', damage: '1d6', properties: '-', slots: 1 },
  { name: 'Spear', cost: '5 sp', damage: '1d6', properties: 'Thrown', slots: 1 },
  { name: 'Staff', cost: '5 sp', damage: '1d4', properties: 'Two-handed', slots: 1 },
  { name: 'Warhammer', cost: '10 gp', damage: '1d10', properties: 'Two-handed', slots: 1 },
]

// baseAc is the flat number in "X + DEX mod"; dexApplies is false for
// plate, which caps out at a flat 15 regardless of Dexterity.
const ARMOR = [
  { name: 'Leather armor', cost: '10 gp', slots: 1, baseAc: 11, dexApplies: true, properties: '-' },
  { name: 'Chainmail', cost: '60 gp', slots: 2, baseAc: 13, dexApplies: true, properties: 'Disadvantage on stealth, swim' },
  { name: 'Plate mail', cost: '130 gp', slots: 3, baseAc: 15, dexApplies: false, properties: 'No swim, disadvantage on stealth' },
]
const SHIELD = { name: 'Shield', cost: '10 gp', slots: 1, acBonus: 2, properties: 'Occupies one hand' }

const CLASSES = [
  {
    name: 'Fighter',
    hitDie: 8,
    weaponsAllowed: 'ALL',
    armorAllowed: ARMOR.map((a) => a.name),
    shieldAllowed: true,
    blurb: 'All weapons and armor.',
    features: [
      { name: 'Hauler', description: 'Add your Constitution modifier, if positive, to your gear slots.' },
      {
        name: 'Weapon Mastery',
        description:
          'Choose one type of weapon. You gain +1 to attack and damage with that weapon type, plus half your level added to those rolls (round down).',
        needsWeaponChoice: true,
      },
      {
        name: 'Grit',
        description:
          'Choose Strength or Dexterity. You have advantage on checks of that type to overcome an opposing force (e.g. kicking open a stuck door, slipping free of chains).',
        needsStatChoice: true,
      },
    ],
    talentTable: [
      { min: 2, max: 2, text: 'Gain Weapon Mastery with one additional weapon type' },
      { min: 3, max: 6, text: '+1 to melee and ranged attacks' },
      { min: 7, max: 9, text: '+2 to Strength, Dexterity, or Constitution stat' },
      { min: 10, max: 11, text: 'Choose one kind of armor. You get +1 AC from that armor' },
      { min: 12, max: 12, text: 'Choose a talent or +2 points to distribute to stats' },
    ],
  },
  {
    name: 'Priest',
    hitDie: 6,
    weaponsAllowed: ['Club', 'Crossbow', 'Dagger', 'Mace', 'Longsword', 'Staff', 'Warhammer'],
    armorAllowed: ARMOR.map((a) => a.name),
    shieldAllowed: true,
    blurb: 'Club, crossbow, dagger, mace, longsword, staff, warhammer. All armor and shields.',
    features: [
      { name: 'Languages', description: 'You know Celestial, Diabolic, or Primordial (your choice).' },
      { name: 'Turn Undead', description: "You know the turn undead spell. It doesn't count toward your number of known spells." },
      {
        name: 'Deity',
        description: 'Choose a god to serve who matches your alignment. You have a holy symbol for your god (takes up no gear slot).',
        needsDeityChoice: true,
      },
      {
        name: 'Spellcasting',
        description:
          'You can cast priest spells you know. You know two tier 1 spells of your choice from the priest spell list -- add them in the Spells section below.',
      },
    ],
    talentTable: [
      { min: 2, max: 2, text: 'Gain advantage on casting one spell you know' },
      { min: 3, max: 6, text: '+1 to melee or ranged attacks' },
      { min: 7, max: 9, text: '+1 to priest spellcasting checks' },
      { min: 10, max: 11, text: '+2 to Strength or Wisdom stat' },
      { min: 12, max: 12, text: 'Choose a talent or +2 points to distribute to stats' },
    ],
  },
  {
    name: 'Thief',
    hitDie: 4,
    weaponsAllowed: ['Club', 'Crossbow', 'Dagger', 'Shortbow', 'Shortsword'],
    armorAllowed: ['Leather armor'],
    shieldAllowed: false,
    blurb: 'Club, crossbow, dagger, shortbow, shortsword. Leather armor only.',
    features: [
      {
        name: 'Backstab',
        description:
          'If you hit a creature who is unaware of your attack, you deal an extra weapon die of damage, plus additional weapon dice equal to half your level (round down).',
      },
      {
        name: 'Thievery',
        description:
          'Advantage on climbing; sneaking and hiding; applying disguises; finding and disabling traps; and delicate tasks like picking pockets or opening locks. Your tools take up no gear slots.',
      },
    ],
    talentTable: [
      { min: 2, max: 2, text: 'Gain advantage on initiative rolls (reroll if duplicate)' },
      { min: 3, max: 5, text: 'Your Backstab deals +1 dice of damage' },
      { min: 6, max: 9, text: '+2 to Strength, Dexterity, or Charisma stat' },
      { min: 10, max: 11, text: '+1 to melee and ranged attacks' },
      { min: 12, max: 12, text: 'Choose a talent or +2 points to distribute to stats' },
    ],
  },
  {
    name: 'Wizard',
    hitDie: 4,
    weaponsAllowed: ['Dagger', 'Staff'],
    armorAllowed: [],
    shieldAllowed: false,
    blurb: 'Dagger, staff. No armor.',
    features: [
      { name: 'Languages', description: 'You know two additional common languages and two rare languages.' },
      {
        name: 'Learning Spells',
        description:
          'You can permanently learn a wizard spell from a spell scroll by studying it for a day and succeeding on a DC 15 Intelligence check (success or fail, the scroll is used up).',
      },
      {
        name: 'Spellcasting',
        description:
          'You can cast wizard spells you know. You know three tier 1 spells of your choice from the wizard spell list -- add them in the Spells section below.',
      },
    ],
    talentTable: [
      { min: 2, max: 2, text: 'Make 1 random magic item of a type you choose' },
      { min: 3, max: 7, text: '+2 to Intelligence stat or +1 to wizard spellcasting checks' },
      { min: 8, max: 9, text: 'Gain advantage on casting one spell you know' },
      { min: 10, max: 11, text: 'Learn one additional wizard spell of any tier you know' },
      { min: 12, max: 12, text: 'Choose a talent or +2 points to distribute to stats' },
    ],
  },
]

// Generic adventuring kit, same for every class (Gear, pg. 34).
const STARTING_KIT = [
  { name: 'Backpack', slots: 0 },
  { name: 'Torch', slots: 1, quantity: 2 },
  { name: 'Rations', slots: 1, quantity: 3 },
  { name: 'Flint and steel', slots: 1 },
  { name: "Rope, 60'", slots: 1 },
]

// Background, pg. 26 -- roll a d20 or just pick one that fits.
const BACKGROUNDS = [
  'Urchin -- You grew up in the merciless streets of a large city',
  "Wanted -- There's a price on your head, but you have allies",
  'Cult Initiate -- You know blasphemous secrets and rituals',
  'Thieves’ Guild -- You have connections, contacts, and debts',
  'Banished -- Your people cast you out for supposed crimes',
  'Orphaned -- An unusual guardian rescued and raised you',
  'Wizard’s Apprentice -- You have a knack and eye for magic',
  'Jeweler -- You can easily appraise value and authenticity',
  'Herbalist -- You know plants, medicines, and poisons',
  'Barbarian -- You left the horde, but it never quite left you',
  'Mercenary -- You fought friend and foe alike for your coin',
  'Sailor -- Pirate, privateer, or merchant -- the seas are yours',
  "Acolyte -- You're well trained in religious rites and doctrines",
  'Soldier -- You served as a fighter in an organized army',
  'Ranger -- The woods and wilds are your true home',
  'Scout -- You survived on stealth, observation, and speed',
  'Minstrel -- You’ve traveled far with your charm and talent',
  'Scholar -- You know much about ancient history and lore',
  'Noble -- A famous name has opened many doors for you',
  'Chirurgeon -- You know anatomy, surgery, and first aid',
]

function rollStat() {
  return [0, 0, 0].reduce((sum) => sum + (Math.floor(Math.random() * 6) + 1), 0)
}

function roll2d6() {
  return Math.floor(Math.random() * 6) + 1 + (Math.floor(Math.random() * 6) + 1)
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

function rollClassTalents(charClass, count) {
  const table = CLASSES.find((c) => c.name === charClass).talentTable
  return Array.from({ length: count }, () => {
    const roll = roll2d6()
    const entry = table.find((e) => roll >= e.min && roll <= e.max)
    return `(2d6: ${roll}) ${entry.text}`
  })
}

// 2d6 x 5 gp starting purse (Starting Gear, pg. 33). Not run through the
// real dice engine (src/lib/dice.js) on purpose -- there's no campaign
// scene log yet to log it to at character-creation time.
function rollStartingGold() {
  return roll2d6() * 5
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
  const [coin, setCoin] = useState(() => rollStartingGold())
  const [weaponChoice, setWeaponChoice] = useState('Longsword')
  const [armorChoice, setArmorChoice] = useState('Chainmail')
  const [shieldChoice, setShieldChoice] = useState(true)
  const [gritStat, setGritStat] = useState('Strength')
  const [masteryWeapon, setMasteryWeapon] = useState('Longsword')
  const [deity, setDeity] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const selectedAncestry = ANCESTRIES.find((a) => a.name === ancestry)
  const selectedClass = CLASSES.find((c) => c.name === charClass)
  const classWeapons = selectedClass.weaponsAllowed === 'ALL' ? WEAPONS.map((w) => w.name) : selectedClass.weaponsAllowed
  const classArmors = selectedClass.armorAllowed

  // Re-roll talents whenever ancestry or class changes -- ancestry can
  // grant an extra roll (Human's Ambitious), and each class has its own
  // 2d6 talent table.
  useEffect(() => {
    const count = 1 + (selectedAncestry?.talentBonus || 0)
    setTalents(rollClassTalents(charClass, count))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ancestry, charClass])

  // Reset weapon/armor/shield choices to sensible defaults for the class,
  // since e.g. a Wizard can't keep a Fighter's chainmail selection.
  useEffect(() => {
    setWeaponChoice(classWeapons[0] || '')
    setArmorChoice(classArmors[0] || '')
    setShieldChoice(selectedClass.shieldAllowed)
    setMasteryWeapon(classWeapons[0] || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charClass])

  const rerollTalents = () => {
    const count = 1 + (selectedAncestry?.talentBonus || 0)
    setTalents(rollClassTalents(charClass, count))
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

  const rollBackground = () => setBackground(BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)])

  const conMod = modifier(stats.con)
  const dexMod = modifier(stats.dex)
  const hpBonus = selectedAncestry?.hpBonus || 0
  // Simplified for the quick builder: take the max hit die roll rather than
  // an actual roll, since Con modifier and ancestry bonuses already vary
  // outcomes.
  const computedHp = Math.max(1, selectedClass.hitDie + conMod + hpBonus)

  const selectedArmor = ARMOR.find((a) => a.name === armorChoice)
  const armorAcValue = selectedArmor ? selectedArmor.baseAc + (selectedArmor.dexApplies ? dexMod : 0) : 10 + dexMod
  const computedAc = armorAcValue + (shieldChoice && selectedClass.shieldAllowed ? SHIELD.acBonus : 0)

  const start = async () => {
    const finalName = name.trim() || `${ancestry} ${charClass.toLowerCase()}`

    if (!campaignId || !session?.user) {
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

    const weaponData = WEAPONS.find((w) => w.name === weaponChoice)
    const gearRows = [
      ...STARTING_KIT.map((item) => ({
        character_id: character.id,
        name: item.name,
        slots: item.slots,
        quantity: item.quantity || 1,
        equipped: false,
      })),
      ...(weaponData
        ? [{ character_id: character.id, name: weaponData.name, slots: weaponData.slots, quantity: 1, equipped: true }]
        : []),
      ...(selectedArmor
        ? [
            {
              character_id: character.id,
              name: selectedArmor.name,
              slots: selectedArmor.slots,
              quantity: 1,
              equipped: true,
              base_ac: selectedArmor.baseAc,
              dex_applies: selectedArmor.dexApplies,
            },
          ]
        : []),
      ...(shieldChoice && selectedClass.shieldAllowed
        ? [{ character_id: character.id, name: SHIELD.name, slots: SHIELD.slots, quantity: 1, equipped: true, is_shield: true }]
        : []),
    ]

    const talentRows = talents.map((description) => ({
      character_id: character.id,
      source: 'class talent (2d6)',
      description,
    }))

    const featureRows = [
      {
        character_id: character.id,
        source: 'ancestry',
        name: selectedAncestry.traitName,
        description: selectedAncestry.trait,
        uses_max: selectedAncestry.dailyUses || null,
        uses_current: selectedAncestry.dailyUses || null,
      },
      ...selectedClass.features.map((f) => {
        let description = f.description
        if (f.needsWeaponChoice) description = description.replace('Choose one type of weapon.', `Weapon type: ${masteryWeapon}.`)
        if (f.needsStatChoice) description = description.replace('Choose Strength or Dexterity.', `Chosen stat: ${gritStat}.`)
        if (f.needsDeityChoice && deity.trim()) description = `${description} Serves ${deity.trim()}.`
        return {
          character_id: character.id,
          source: 'class',
          name: f.name,
          description,
        }
      }),
    ]

    const [{ error: gearError }, { error: talentError }, { error: featureError }] = await Promise.all([
      supabase.from('character_gear').insert(gearRows),
      talentRows.length ? supabase.from('character_talents').insert(talentRows) : Promise.resolve({ error: null }),
      supabase.from('character_features').insert(featureRows),
    ])

    setSaving(false)
    if (gearError || talentError || featureError) {
      setError((gearError || talentError || featureError).message)
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
        <span className="text-neutral-300">{selectedAncestry.traitName}.</span> {selectedAncestry.trait}
        <span className="block text-neutral-600 mt-0.5">Languages: {selectedAncestry.languages}</span>
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
      <p className="text-[11px] text-neutral-400 mb-2">
        {charClass} &middot; 1d{selectedClass.hitDie} hit points per level. {selectedClass.blurb}
      </p>
      <ul className="mb-4">
        {selectedClass.features.map((f) => (
          <li key={f.name} className="text-[11px] text-neutral-400 bg-neutral-900 rounded-md px-2.5 py-1.5 mb-1">
            <span className="text-neutral-300">{f.name}.</span> {f.description}
          </li>
        ))}
      </ul>

      {charClass === 'Fighter' && (
        <div className="grid grid-cols-2 gap-1.5 mb-4">
          <div>
            <p className="text-[11px] text-neutral-400 mb-1">Grit stat</p>
            <select
              value={gritStat}
              onChange={(e) => setGritStat(e.target.value)}
              className="w-full text-xs bg-neutral-900 border border-neutral-700 rounded-md px-2 py-1.5 text-white"
            >
              <option>Strength</option>
              <option>Dexterity</option>
            </select>
          </div>
          <div>
            <p className="text-[11px] text-neutral-400 mb-1">Weapon Mastery</p>
            <select
              value={masteryWeapon}
              onChange={(e) => setMasteryWeapon(e.target.value)}
              className="w-full text-xs bg-neutral-900 border border-neutral-700 rounded-md px-2 py-1.5 text-white"
            >
              {classWeapons.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </div>
        </div>
      )}
      {charClass === 'Priest' && (
        <div className="mb-4">
          <p className="text-[11px] text-neutral-400 mb-1">Deity (optional)</p>
          <input
            value={deity}
            onChange={(e) => setDeity(e.target.value)}
            placeholder="Name of the god you serve"
            className="w-full text-xs bg-neutral-900 border border-neutral-700 rounded-md px-2.5 py-1.5 text-white"
          />
        </div>
      )}

      <p className="text-xs text-neutral-400 mb-2">4. Weapon &amp; armor</p>
      <div className="grid grid-cols-2 gap-1.5 mb-1.5">
        <select
          value={weaponChoice}
          onChange={(e) => setWeaponChoice(e.target.value)}
          className="text-xs bg-neutral-900 border border-neutral-700 rounded-md px-2 py-1.5 text-white"
        >
          {classWeapons.map((wname) => {
            const w = WEAPONS.find((x) => x.name === wname)
            return (
              <option key={wname} value={wname}>
                {wname} ({w.damage}, {w.slots} slot{w.slots === 1 ? '' : 's'})
              </option>
            )
          })}
        </select>
        {classArmors.length > 0 ? (
          <select
            value={armorChoice}
            onChange={(e) => setArmorChoice(e.target.value)}
            className="text-xs bg-neutral-900 border border-neutral-700 rounded-md px-2 py-1.5 text-white"
          >
            <option value="">No armor</option>
            {classArmors.map((aname) => {
              const a = ARMOR.find((x) => x.name === aname)
              return (
                <option key={aname} value={aname}>
                  {aname} (AC {a.baseAc}{a.dexApplies ? '+dex' : ''}, {a.slots} slots)
                </option>
              )
            })}
          </select>
        ) : (
          <p className="text-[11px] text-neutral-500 self-center">No armor allowed for this class.</p>
        )}
      </div>
      {selectedClass.shieldAllowed && (
        <label className="flex items-center gap-1.5 text-[11px] text-neutral-400 mb-4">
          <input type="checkbox" checked={shieldChoice} onChange={(e) => setShieldChoice(e.target.checked)} />
          Carry a shield (+2 AC, 1 slot, occupies one hand)
        </label>
      )}
      {!selectedClass.shieldAllowed && <div className="mb-4" />}

      <p className="text-xs text-neutral-400 mb-2">5. Alignment &amp; background</p>
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
      <div className="flex gap-1.5 mb-4">
        <input
          value={background}
          onChange={(e) => setBackground(e.target.value)}
          placeholder="Background (e.g. Urchin, Soldier, Scholar)"
          className="flex-1 min-w-0 bg-neutral-900 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white"
        />
        <button
          onClick={rollBackground}
          className="text-xs border border-neutral-700 rounded-md px-2.5 py-1 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800 shrink-0"
        >
          <Dices size={13} /> Roll (d20)
        </button>
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-neutral-400">6. Talents ({charClass} table, 2d6)</p>
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

      <p className="text-xs text-neutral-400 mb-2">7. Name your character</p>
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
              {weaponChoice}
              {armorChoice ? `, ${armorChoice}` : ''}
              {shieldChoice && selectedClass.shieldAllowed ? ', shield' : ''}, backpack &amp; adventuring kit
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
