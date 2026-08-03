import { useState, useEffect, useRef } from 'react'
import { Dices, AlertCircle, User, Upload, X as XIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import Footer from './ui/Footer.jsx'
import Stepper from './ui/Stepper.jsx'
import {
  SHADOWDARK_RULESET,
  abilityModifier,
  gearSlotCapacity,
  isValidAbilityScore,
  isValidHitDieRoll,
  resolveTalentRolls,
  startingHp,
} from '../game/rules/character.js'
import {
  ANCESTRIES,
  WEAPONS,
  ARMOR,
  SHIELD,
  CLASSES,
  STARTING_KIT,
  BACKGROUNDS,
} from '../game/rules/content.js'

const STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const STAT_LABELS = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' }
const ALIGNMENTS = ['Lawful', 'Neutral', 'Chaotic']

function rollStat() {
  const dice = [0, 0, 0].map(() => Math.floor(Math.random() * 6) + 1)
  return { dice, total: dice.reduce((sum, die) => sum + die, 0) }
}

function roll2d6() {
  return Math.floor(Math.random() * 6) + 1 + (Math.floor(Math.random() * 6) + 1)
}

const modifier = abilityModifier

function rollClassTalents(charClass, count) {
  const table = CLASSES.find((c) => c.name === charClass).talentTable
  const rolls = Array.from({ length: count }, () => roll2d6())
  return resolveTalentRolls({ rolls, table })
}

// 2d6 x 5 gp starting purse (Starting Gear, pg. 33). Not run through the
// real dice engine (src/lib/dice.js) on purpose -- there's no campaign
// scene log yet to log it to at character-creation time.
function rollStartingGold() {
  return roll2d6() * 5
}

// Classes grouped by source book for the Class step -- flat grids of 12+
// options get hard to scan once the Cursed Scrolls are mixed in with the
// corebook four, so the picker clusters them under a small heading per
// source instead.
function classesBySource() {
  const groups = [{ label: 'Core rulebook', classes: [] }]
  const bySource = {}
  for (const c of CLASSES) {
    if (!c.source) {
      groups[0].classes.push(c)
      continue
    }
    if (!bySource[c.source]) {
      bySource[c.source] = { label: c.source, classes: [] }
      groups.push(bySource[c.source])
    }
    bySource[c.source].classes.push(c)
  }
  return groups
}

const emptyStats = { str: null, dex: null, con: null, int: null, wis: null, cha: null }
const STEPS = ['Method', 'Stats', 'Ancestry', 'Class', 'Background', 'Gear', 'Review']

// Character creation, rebuilt as a step-by-step wizard (matches the rest
// of Delve's onboarding flows) instead of one long scrolling form. Every
// step reuses the same data tables and computed values the old single-page
// builder used -- this pass is a layout/navigation change, not a rules
// change. Two things intentionally NOT built yet, left for a follow-up
// chunk: a richer per-die stat-roll breakdown with the "no stat 14+, reroll
// the set once" rule, and a "best fit" class recommendation engine in the
// sidebar. "Save draft" also isn't wired to real persistence yet -- leaving
// the wizard mid-way loses progress, same as the old form did if you
// navigated away, so the button is left out rather than implying a save
// that doesn't happen.
export default function CharacterBuilder({ campaignId, session, campaignName = 'The sunken keep', onComplete, onCancel }) {
  const [step, setStep] = useState(0)
  const [rollMethod, setRollMethod] = useState('digital') // 'digital' | 'physical' -- affects the Stats step only
  const [stats, setStats] = useState(emptyStats)
  const [statRolls, setStatRolls] = useState({})
  const [hpRoll, setHpRoll] = useState(null)
  const [hpRollDice, setHpRollDice] = useState([])
  const [hpRollSource, setHpRollSource] = useState(null)
  const [ancestry, setAncestry] = useState('Dwarf')
  const [charClass, setCharClass] = useState('Fighter')
  const [name, setName] = useState('')
  const [alignment, setAlignment] = useState('Neutral')
  const [background, setBackground] = useState('')
  const [talentRollsByChoice, setTalentRollsByChoice] = useState({})
  const [coin] = useState(() => rollStartingGold())
  const [weaponChoice, setWeaponChoice] = useState('Longsword')
  const [armorChoice, setArmorChoice] = useState('Chainmail')
  const [shieldChoice, setShieldChoice] = useState(true)
  const [gritStat, setGritStat] = useState('Strength')
  const [masteryWeapon, setMasteryWeapon] = useState('Longsword')
  const [deity, setDeity] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [portraitFile, setPortraitFile] = useState(null)
  const [portraitPreview, setPortraitPreview] = useState(null)
  const portraitInputRef = useRef(null)

  const selectedAncestry = ANCESTRIES.find((a) => a.name === ancestry)
  const selectedClass = CLASSES.find((c) => c.name === charClass)
  const classWeapons = selectedClass.weaponsAllowed === 'ALL' ? WEAPONS.map((w) => w.name) : selectedClass.weaponsAllowed
  const classArmors = selectedClass.armorAllowed
  const talentChoiceKey = `${ancestry}:${charClass}`
  const talents = talentRollsByChoice[talentChoiceKey] || []

  // Roll each ancestry/class combination once. Switching choices and then
  // returning restores the original result instead of quietly rerolling it.
  useEffect(() => {
    const count = 1 + (selectedAncestry?.talentBonus || 0)
    setTalentRollsByChoice((allRolls) => {
      const key = `${ancestry}:${charClass}`
      if (allRolls[key]) return allRolls
      return { ...allRolls, [key]: rollClassTalents(charClass, count) }
    })
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

  useEffect(() => {
    setHpRoll(null)
    setHpRollDice([])
    setHpRollSource(null)
  }, [charClass, ancestry])

  useEffect(() => {
    return () => {
      if (portraitPreview) URL.revokeObjectURL(portraitPreview)
    }
  }, [portraitPreview])

  const rollAll = () => {
    const next = {}
    const provenance = {}
    STAT_KEYS.forEach((k) => {
      const result = rollStat()
      next[k] = result.total
      provenance[k] = { source: 'digital', dice: result.dice, total: result.total }
    })
    setStats(next)
    setStatRolls(provenance)
  }

  const setStat = (key, value) => {
    const n = parseInt(value, 10)
    const total = Number.isNaN(n) ? null : n
    setStats((s) => ({ ...s, [key]: total }))
    setStatRolls((rolls) => {
      const next = { ...rolls }
      if (isValidAbilityScore(total)) {
        next[key] = { source: rollMethod === 'physical' ? 'physical' : 'manual', total }
      } else {
        delete next[key]
      }
      return next
    })
  }

  const rollHitDie = () => {
    const count = selectedAncestry?.hpRollAdvantage ? 2 : 1
    const dice = Array.from(
      { length: count },
      () => Math.floor(Math.random() * selectedClass.hitDie) + 1
    )
    setHpRoll(Math.max(...dice))
    setHpRollDice(dice)
    setHpRollSource('digital')
  }

  const recordHitDie = (value) => {
    const roll = parseInt(value, 10)
    setHpRoll(Number.isNaN(roll) ? null : roll)
    setHpRollDice(Number.isNaN(roll) ? [] : [roll])
    setHpRollSource('physical')
  }

  const rollBackground = () => setBackground(BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)])

  const pickPortrait = (file) => {
    if (!file) return
    if (portraitPreview) URL.revokeObjectURL(portraitPreview)
    setPortraitFile(file)
    setPortraitPreview(URL.createObjectURL(file))
  }

  const hasCompleteStatRolls = STAT_KEYS.every(
    (key) => isValidAbilityScore(stats[key]) && statRolls[key]
  )
  const conMod = modifier(stats.con ?? 10)
  const dexMod = modifier(stats.dex ?? 10)
  const hpBonus = selectedAncestry?.hpBonus || 0
  const hasValidHpRoll = isValidHitDieRoll(hpRoll, selectedClass.hitDie)
  const computedHp = hasValidHpRoll
    ? startingHp({
        hitDieRoll: hpRoll,
        hitDie: selectedClass.hitDie,
        constitutionScore: stats.con,
        ancestryBonus: hpBonus,
      })
    : null

  const selectedArmor = ARMOR.find((a) => a.name === armorChoice)
  const armorAcValue = selectedArmor ? selectedArmor.baseAc + (selectedArmor.dexApplies ? dexMod : 0) : 10 + dexMod
  const computedAc = armorAcValue + (shieldChoice && selectedClass.shieldAllowed ? SHIELD.acBonus : 0)
  const gearSlots = gearSlotCapacity({
    strengthScore: stats.str,
    constitutionScore: stats.con,
    features: selectedClass.features,
  })

  const goNext = () => setStep((s) => Math.min(STEPS.length - 1, s + 1))
  const goBack = () => setStep((s) => Math.max(0, s - 1))

  const start = async () => {
    const finalName = name.trim() || `${ancestry} ${charClass.toLowerCase()}`

    if (!hasCompleteStatRolls) {
      setError('Record all six 3d6 ability scores before creating the character.')
      return
    }

    if (!hasValidHpRoll) {
      setError(`Record a 1d${selectedClass.hitDie} starting HP roll before creating the character.`)
      return
    }

    if (!campaignId || !session?.user) {
      onComplete && onComplete({ name: finalName, ancestry, charClass, stats, hp: computedHp })
      return
    }

    setSaving(true)
    setError(null)

    const characterData = {
      name: finalName,
      ancestry,
      class: charClass,
      stats,
      hp: computedHp,
      max_hp: computedHp,
      ac: computedAc,
      alignment,
      background: background.trim() || null,
      xp: 0,
      coin,
      rules_version: SHADOWDARK_RULESET.version,
      creation_rolls: {
        ruleset: SHADOWDARK_RULESET,
        stats: statRolls,
        hp: {
          source: hpRollSource,
          die: `1d${selectedClass.hitDie}`,
          advantage: Boolean(selectedAncestry?.hpRollAdvantage),
          dice: hpRollDice,
          roll: hpRoll,
          constitution_modifier: conMod,
          ancestry_bonus: hpBonus,
          total: computedHp,
        },
        talents,
      },
    }

    const weaponData = WEAPONS.find((w) => w.name === weaponChoice)
    // Decision Queue #38 (resolved): category/damage_die/properties are
    // real character_gear columns now, not just this file's in-memory
    // WEAPONS/ARMOR/SHIELD/STARTING_KIT shape -- copied straight from the
    // same constants used to render the pickers above, so there's no new
    // data invented here, just persisted past character creation for the
    // first time. Torch/Rations are the only STARTING_KIT items treated
    // as "consumable" (matches the same migration's backfill judgment
    // call for existing characters); Backpack/Flint and steel/Rope stay
    // plain 'gear'.
    const CONSUMABLE_STARTING_KIT_NAMES = ['Torch', 'Rations']
    const gearRows = [
      ...STARTING_KIT.map((item) => ({
        name: item.name,
        slots: item.slots,
        quantity: item.quantity || 1,
        equipped: false,
        category: CONSUMABLE_STARTING_KIT_NAMES.includes(item.name) ? 'consumable' : 'gear',
      })),
      ...(weaponData
        ? [{
            name: weaponData.name,
            slots: weaponData.slots,
            quantity: 1,
            equipped: true,
            category: 'weapon',
            damage_die: weaponData.damage,
            properties: weaponData.properties,
          }]
        : []),
      ...(selectedArmor
        ? [
            {
              name: selectedArmor.name,
              slots: selectedArmor.slots,
              quantity: 1,
              equipped: true,
              base_ac: selectedArmor.baseAc,
              dex_applies: selectedArmor.dexApplies,
              category: 'armor',
              properties: selectedArmor.properties,
            },
          ]
        : []),
      ...(shieldChoice && selectedClass.shieldAllowed
        ? [{ name: SHIELD.name, slots: SHIELD.slots, quantity: 1, equipped: true, is_shield: true, category: 'shield', properties: SHIELD.properties }]
        : []),
    ]

    const talentRows = talents.map((talent) => ({
      source: 'class talent (2d6)',
      description: talent.description,
      roll_formula: talent.formula,
      roll_total: talent.roll,
      rules_version: SHADOWDARK_RULESET.version,
    }))

    const featureRows = [
      {
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
          source: 'class',
          name: f.name,
          description,
          uses_max: f.dailyUses || null,
          uses_current: f.dailyUses || null,
        }
      }),
    ]

    const { data: character, error: insertError } = await supabase.rpc('create_character', {
      p_campaign_id: campaignId,
      p_character: characterData,
      p_gear: gearRows,
      p_talents: talentRows,
      p_features: featureRows,
    })

    if (insertError) {
      setSaving(false)
      setError(insertError.message)
      return
    }

    // Portrait upload happens last, after the character row exists --
    // same storage path/upsert/cache-bust pattern CharacterSheet.jsx uses
    // for a portrait added after the fact, so either path produces an
    // identical avatar_url shape.
    if (portraitFile) {
      const path = `${character.id}/avatar`
      const { error: storageError } = await supabase.storage.from('avatars').upload(path, portraitFile, { upsert: true })
      if (!storageError) {
        const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
        const avatarUrl = `${pub.publicUrl}?v=${Date.now()}`
        await supabase.from('characters').update({ avatar_url: avatarUrl }).eq('id', character.id)
        character.avatar_url = avatarUrl
      }
    }

    setSaving(false)
    onComplete && onComplete(character)
  }

  const stepper = (
    <Stepper
      steps={STEPS.map((label, i) => ({ label, state: i < step ? 'done' : i === step ? 'active' : 'upcoming' }))}
      onStepClick={setStep}
    />
  )

  const sidebar = (
    <div className="bg-panel rounded-lg p-4 h-fit md:sticky md:top-6">
      <input
        ref={portraitInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pickPortrait(e.target.files?.[0])}
      />
      <div className="flex flex-col items-center text-center mb-3">
        <button
          onClick={() => portraitInputRef.current?.click()}
          className="w-16 h-16 rounded-full overflow-hidden bg-bg border border-line flex items-center justify-center hover:border-ink-faint mb-2"
        >
          {portraitPreview ? (
            <img src={portraitPreview} alt="Portrait preview" className="w-full h-full object-cover" />
          ) : (
            <User size={22} className="text-ink-faint" />
          )}
        </button>
        <button
          onClick={() => portraitInputRef.current?.click()}
          className="text-[11px] text-ink-faint hover:text-ink-dim flex items-center gap-1 mb-3"
        >
          <Upload size={11} /> {portraitPreview ? 'Replace portrait' : 'Add portrait'}
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Unnamed adventurer"
          className="w-full text-sm bg-bg border border-line rounded-md px-3 py-2 text-ink text-center"
        />
      </div>

      <div className="grid grid-cols-4 gap-2 text-center mb-3 pb-3 border-b border-line-soft">
        <div>
          <p className="text-[10px] text-ink-faint">Level</p>
          <p className="text-sm text-ink">1</p>
        </div>
        <div>
          <p className="text-[10px] text-ink-faint">HP</p>
          <p className="text-sm text-ink">{computedHp ?? '—'}</p>
        </div>
        <div>
          <p className="text-[10px] text-ink-faint">AC</p>
          <p className="text-sm text-ink">{computedAc}</p>
        </div>
        <div>
          <p className="text-[10px] text-ink-faint">Gear slots</p>
          <p className="text-sm text-ink">{gearSlots}</p>
        </div>
      </div>

      <p className="text-xs text-ink-dim mb-2">Current choices</p>
      <div className="flex flex-col gap-1 text-[11px]">
        <div className="flex justify-between">
          <span className="text-ink-faint">Ancestry</span>
          <span className="text-ink">{ancestry || '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-faint">Class</span>
          <span className="text-ink">{charClass || '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-faint">Background</span>
          <span className="text-ink truncate max-w-[140px]" title={background}>
            {background ? background.split(' -- ')[0] : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-faint">Alignment</span>
          <span className="text-ink">{alignment || '—'}</span>
        </div>
      </div>
      <p className="text-[11px] text-ink-faint mt-3">You can change any choice before creating the character.</p>
    </div>
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="shrink-0 border-b border-line-soft px-6 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-ink-dim truncate">{campaignName}</p>
          <h1 className="text-ink font-medium">Create a character</h1>
        </div>
        {stepper}
        {onCancel && (
          <button onClick={onCancel} className="text-ink-dim hover:text-ink shrink-0">
            <XIcon size={18} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6 grid grid-cols-1 md:grid-cols-[1fr_260px] gap-4">
          <div className="bg-panel rounded-lg p-5 min-h-[420px]">
            {step === 0 && (
              <div>
                <h2 className="text-ink text-sm font-medium mb-1">How do you want to roll your stats?</h2>
                <p className="text-xs text-ink-faint mb-4">You can still edit any number by hand on the next step either way.</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setRollMethod('digital')}
                    className={`text-left p-4 rounded-lg border ${
                      rollMethod === 'digital' ? 'border-primary bg-panel2' : 'border-line hover:bg-panel2/50'
                    }`}
                  >
                    <p className="text-sm text-ink mb-1">Roll digitally</p>
                    <p className="text-[11px] text-ink-faint">Delve rolls 3d6 for each stat for you. Reroll all six anytime.</p>
                  </button>
                  <button
                    onClick={() => setRollMethod('physical')}
                    className={`text-left p-4 rounded-lg border ${
                      rollMethod === 'physical' ? 'border-primary bg-panel2' : 'border-line hover:bg-panel2/50'
                    }`}
                  >
                    <p className="text-sm text-ink mb-1">Physical dice</p>
                    <p className="text-[11px] text-ink-faint">Roll your own 3d6 and type each stat's total in on the next step.</p>
                  </button>
                </div>
              </div>
            )}

            {step === 1 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-ink text-sm font-medium">Roll your stats</h2>
                  {rollMethod === 'digital' && (
                    <button
                      onClick={rollAll}
                      className="text-xs border border-line rounded-md px-3 py-1 flex items-center gap-2 text-ink hover:bg-panel2"
                    >
                      <Dices size={13} /> Roll all
                    </button>
                  )}
                </div>
                <p className="text-xs text-ink-faint mb-4">
                  {rollMethod === 'digital'
                    ? '"Roll all" fills these in for you, or type in numbers straight off your own dice.'
                    : 'Roll 3d6 for each stat on your own dice, then type each total in below.'}
                </p>
                <div className="grid grid-cols-6 gap-2 mb-2">
                  {STAT_KEYS.map((k) => (
                    <div key={k} className="bg-bg rounded-md p-2 text-center">
                      <p className="text-[10px] text-ink-dim mb-1">{STAT_LABELS[k]}</p>
                      <input
                        type="number"
                        min="3"
                        max="18"
                        value={stats[k] ?? ''}
                        onChange={(e) => setStat(k, e.target.value)}
                        className="w-full bg-panel border border-line rounded text-center text-sm text-ink py-1"
                      />
                      <p className="text-[10px] text-ink-faint mt-1">
                        {stats[k] == null
                          ? '—'
                          : modifier(stats[k]) >= 0
                            ? `+${modifier(stats[k])}`
                            : modifier(stats[k])}
                      </p>
                    </div>
                  ))}
                </div>
                {!hasCompleteStatRolls && (
                  <p className="text-[11px] text-warning-text mt-2">
                    Record all six 3d6 results before continuing.
                  </p>
                )}
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 className="text-ink text-sm font-medium mb-3">Pick your ancestry</h2>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {ANCESTRIES.map((a) => (
                    <button
                      key={a.name}
                      onClick={() => setAncestry(a.name)}
                      className={`text-xs py-2 rounded-md border ${
                        ancestry === a.name
                          ? 'bg-panel2 border-primary text-ink'
                          : 'border-line text-ink hover:bg-panel2'
                      }`}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-ink-dim">
                  <span className="text-ink-dim">{selectedAncestry.traitName}.</span> {selectedAncestry.trait}
                  <span className="block text-ink-faint mt-1">Languages: {selectedAncestry.languages}</span>
                </p>
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 className="text-ink text-sm font-medium mb-3">Pick your class</h2>
                {classesBySource().map((group) => (
                  <div key={group.label} className="mb-3">
                    <p className="text-[10px] uppercase tracking-wide text-ink-faint mb-2">{group.label}</p>
                    <div className="grid grid-cols-4 gap-2">
                      {group.classes.map((c) => (
                        <button
                          key={c.name}
                          onClick={() => setCharClass(c.name)}
                          className={`text-xs py-2 rounded-md border ${
                            charClass === c.name
                              ? 'bg-panel2 border-primary text-ink'
                              : 'border-line text-ink hover:bg-panel2'
                          }`}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-ink-dim mb-2 mt-2">
                  {charClass} &middot; 1d{selectedClass.hitDie} hit points per level. {selectedClass.blurb}
                </p>
                <div className="bg-bg rounded-md p-3 mb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-ink-dim">Starting HP roll</p>
                      <p className="text-[11px] text-ink-faint">
                        Roll 1d{selectedClass.hitDie}
                        {selectedAncestry?.hpRollAdvantage ? ' with advantage' : ''}; Constitution and ancestry modifiers are applied automatically.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max={selectedClass.hitDie}
                        value={hpRoll ?? ''}
                        onChange={(e) => recordHitDie(e.target.value)}
                        placeholder={`1-${selectedClass.hitDie}`}
                        className="w-16 bg-panel border border-line rounded-md px-2 py-1 text-sm text-ink text-center"
                      />
                      <button
                        onClick={rollHitDie}
                        className="text-xs border border-line rounded-md px-3 py-2 flex items-center gap-2 text-ink hover:bg-panel2"
                      >
                        <Dices size={13} /> Roll{selectedAncestry?.hpRollAdvantage ? ' twice' : ''}
                      </button>
                    </div>
                  </div>
                  {hpRoll != null && (
                    <p className={`text-[11px] mt-2 ${hasValidHpRoll ? 'text-ink-dim' : 'text-danger-text'}`}>
                      {hasValidHpRoll
                        ? `${hpRollDice.length > 1 ? `${hpRollDice.join(' and ')} rolled; ${hpRoll} kept` : `${hpRoll} rolled`}${conMod ? ` ${conMod >= 0 ? '+' : ''}${conMod} CON` : ''}${hpBonus ? ` +${hpBonus} ancestry` : ''} = ${computedHp} HP`
                        : `Enter a result from 1 to ${selectedClass.hitDie}.`}
                    </p>
                  )}
                </div>
                <ul className="mb-3">
                  {selectedClass.features.map((f) => (
                    <li key={f.name} className="text-[11px] text-ink-dim bg-bg rounded-md px-3 py-2 mb-1">
                      <span className="text-ink-dim">{f.name}.</span> {f.description}
                    </li>
                  ))}
                </ul>

                {charClass === 'Fighter' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[11px] text-ink-dim mb-1">Grit stat</p>
                      <select
                        value={gritStat}
                        onChange={(e) => setGritStat(e.target.value)}
                        className="w-full text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
                      >
                        <option>Strength</option>
                        <option>Dexterity</option>
                      </select>
                    </div>
                    <div>
                      <p className="text-[11px] text-ink-dim mb-1">Weapon Mastery</p>
                      <select
                        value={masteryWeapon}
                        onChange={(e) => setMasteryWeapon(e.target.value)}
                        className="w-full text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
                      >
                        {classWeapons.map((w) => (
                          <option key={w}>{w}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                {charClass === 'Priest' && (
                  <div>
                    <p className="text-[11px] text-ink-dim mb-1">Deity (optional)</p>
                    <input
                      value={deity}
                      onChange={(e) => setDeity(e.target.value)}
                      placeholder="Name of the god you serve"
                      className="w-full text-xs bg-bg border border-line rounded-md px-3 py-2 text-ink"
                    />
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
              <div>
                <h2 className="text-ink text-sm font-medium mb-3">Alignment &amp; background</h2>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {ALIGNMENTS.map((a) => (
                    <button
                      key={a}
                      onClick={() => setAlignment(a)}
                      className={`text-xs py-2 rounded-md border ${
                        alignment === a
                          ? 'bg-panel2 border-primary text-ink'
                          : 'border-line text-ink hover:bg-panel2'
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mb-4">
                  <input
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                    placeholder="Background (e.g. Urchin, Soldier, Scholar)"
                    className="flex-1 min-w-0 bg-bg border border-line rounded-md px-3 py-2 text-sm text-ink"
                  />
                  <button
                    onClick={rollBackground}
                    className="text-xs border border-line rounded-md px-3 py-1 flex items-center gap-2 text-ink hover:bg-panel2 shrink-0"
                  >
                    <Dices size={13} /> Roll (d20)
                  </button>
                </div>

                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-ink-dim">Talents ({charClass} table, 2d6)</p>
                  <span className="text-[10px] text-ink-faint">Rolled once · result stands</span>
                </div>
                <ul>
                  {talents.map((t, i) => (
                    <li key={i} className="text-[11px] text-ink-dim bg-bg rounded-md px-3 py-2 mb-1">
                      ({t.formula}: {t.roll}) {t.description}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {step === 5 && (
              <div>
                <h2 className="text-ink text-sm font-medium mb-3">Weapon &amp; armor</h2>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <select
                    value={weaponChoice}
                    onChange={(e) => setWeaponChoice(e.target.value)}
                    className="text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
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
                      className="text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
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
                    <p className="text-[11px] text-ink-faint self-center">No armor allowed for this class.</p>
                  )}
                </div>
                {selectedClass.shieldAllowed && (
                  <label className="flex items-center gap-2 text-[11px] text-ink-dim mb-2">
                    <input type="checkbox" checked={shieldChoice} onChange={(e) => setShieldChoice(e.target.checked)} />
                    Carry a shield (+2 AC, 1 slot, occupies one hand)
                  </label>
                )}
                <p className="text-[11px] text-ink-faint">
                  Starting kit (every class): backpack, 2 torches, 3 rations, flint and steel, 60' rope.
                </p>
              </div>
            )}

            {step === 6 && (
              <div>
                <h2 className="text-ink text-sm font-medium mb-3">Review</h2>
                <div className="bg-bg rounded-md px-4 py-3 mb-3">
                  <p className="text-sm font-medium text-ink">
                    {name.trim() || `${ancestry} ${charClass.toLowerCase()}`}
                  </p>
                  <p className="text-[11px] text-ink-dim mt-1">
                    {ancestry} {charClass.toLowerCase()} &middot; level 1 &middot; {alignment}
                    {background ? ` · ${background.split(' -- ')[0]}` : ''}
                  </p>
                  <p className="text-[11px] text-ink-dim mt-1">
                    {computedHp ?? 'unrolled'} hp (1d{selectedClass.hitDie}: {hpRoll ?? '—'}{hpBonus ? ` + ${hpBonus} stout` : ''}
                    {conMod ? ` ${conMod >= 0 ? '+' : ''}${conMod} con` : ''}) &middot; ac {computedAc} &middot; {coin} gp
                  </p>
                  <p className="text-[11px] text-ink-faint mt-1">
                    {weaponChoice}
                    {armorChoice ? `, ${armorChoice}` : ''}
                    {shieldChoice && selectedClass.shieldAllowed ? ', shield' : ''}, backpack &amp; adventuring kit
                  </p>
                </div>
                <p className="text-xs text-ink-dim mb-2">Talents</p>
                <ul className="mb-3">
                  {talents.map((t, i) => (
                    <li key={i} className="text-[11px] text-ink-dim bg-bg rounded-md px-3 py-2 mb-1">
                      ({t.formula}: {t.roll}) {t.description}
                    </li>
                  ))}
                </ul>
                {error && (
                  <div className="flex items-center gap-2 text-danger-text">
                    <AlertCircle size={12} />
                    <p className="text-[11px]">{error}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {sidebar}
        </div>
      </div>

      <Footer className="px-6 py-3">
        <div className="max-w-5xl mx-auto grid grid-cols-[1fr_260px] gap-4">
          <div className="flex items-center justify-between">
            <button
              onClick={goBack}
              disabled={step === 0}
              className="text-sm border border-line rounded-md px-3 py-2 flex items-center gap-2 text-ink hover:bg-panel2 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={14} /> Back
            </button>
            <span className="text-xs text-ink-faint">
              Step {step + 1} of {STEPS.length} &middot; {STEPS[step]}
            </span>
            {step < STEPS.length - 1 ? (
              <button
                onClick={goNext}
                disabled={(step === 1 && !hasCompleteStatRolls) || (step === 3 && !hasValidHpRoll)}
                className="text-sm bg-primary hover:bg-primary/90 disabled:opacity-50 text-ink rounded-md px-4 py-2 flex items-center gap-2"
              >
                Continue <ChevronRight size={14} />
              </button>
            ) : (
              <button
                onClick={start}
                disabled={saving || !hasValidHpRoll}
                className="text-sm bg-primary hover:bg-primary/90 disabled:opacity-50 text-ink rounded-md px-4 py-2"
              >
                {saving ? 'Saving...' : 'Start playing'}
              </button>
            )}
          </div>
          <div className="hidden md:block" />
        </div>
      </Footer>
    </div>
  )
}
