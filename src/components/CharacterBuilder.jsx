import { useState } from 'react'
import { Dices } from 'lucide-react'

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const STAT_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' }

const ANCESTRIES = [
  { name: 'Human', trait: 'Ambitious — one additional talent roll at 1st level.' },
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

const emptyStats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }

export default function CharacterBuilder({ campaignName = 'The sunken keep', onComplete }) {
  const [stats, setStats] = useState(emptyStats)
  const [ancestry, setAncestry] = useState('Dwarf')
  const [charClass, setCharClass] = useState('Fighter')
  const [name, setName] = useState('')

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
  const selectedAncestry = ANCESTRIES.find((a) => a.name === ancestry)
  const conMod = modifier(stats.con)
  const hpBonus = selectedAncestry?.hpBonus || 0
  // Simplified for the quick builder: take the max hit die roll rather than
  // an actual roll, since Con modifier and ancestry bonuses already vary
  // outcomes. Real dice-roll-per-level HP can come later.
  const computedHp = Math.max(1, selectedClass.hitDie + conMod + hpBonus)

  const start = () => {
    onComplete &&
      onComplete({
        name: name.trim() || `${ancestry} ${charClass.toLowerCase()}`,
        ancestry,
        charClass,
        stats,
        hp: computedHp,
      })
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

      <p className="text-xs text-neutral-400 mb-2">4. Name your character</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Rendil the bold"
        className="w-full bg-neutral-900 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white mb-4"
      />

      <div className="bg-neutral-900 rounded-md px-3.5 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-white">
            {ancestry} {charClass.toLowerCase()} · level 1
          </p>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            {computedHp} hp (1d{selectedClass.hitDie}{hpBonus ? ` + ${hpBonus} stout` : ''}
            {conMod ? ` ${conMod >= 0 ? '+' : ''}${conMod} con` : ''}) · starting gear auto-added
          </p>
        </div>
        <button onClick={start} className="bg-blue-500 hover:bg-blue-400 text-white text-sm rounded-md px-3.5 py-2">
          Start playing
        </button>
      </div>
    </div>
  )
}
