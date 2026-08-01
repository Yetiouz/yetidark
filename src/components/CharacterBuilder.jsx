import { useState, useEffect, useRef } from 'react'
import { Dices, AlertCircle, User, Upload, Check, X as XIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import {
  SHADOWDARK_RULESET,
  abilityModifier,
  gearSlotCapacity,
  isValidAbilityScore,
  isValidHitDieRoll,
  resolveTalentRolls,
  startingHp,
} from '../game/rules/character.js'

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
    hpRollAdvantage: true,
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

// New weapons from Cursed Scroll 2 (Red Sands) and Cursed Scroll 3
// (Midnight Sun) -- appended separately from the core table so it's clear
// which book each comes from, but they live in the same WEAPONS list the
// picker reads from.
const CURSED_SCROLL_WEAPONS = [
  { name: 'Blowgun', cost: '5 gp', damage: '1', properties: 'Ranged, silent from hiding', slots: 1 },
  { name: 'Bolas', cost: '2 gp', damage: '-', properties: 'Ranged, entangles legs', slots: 1 },
  { name: 'Morningstar', cost: '5 gp', damage: '1d6/1d8', properties: 'Versatile', slots: 1 },
  { name: 'Pike', cost: '10 gp', damage: '1d10', properties: 'Two-handed, reach', slots: 2 },
  { name: 'Razor chain', cost: '12 gp', damage: '1d6', properties: 'Finesse, lash', slots: 1 },
  { name: 'Scimitar', cost: '8 gp', damage: '1d6', properties: 'Finesse', slots: 1 },
  { name: 'Shuriken', cost: '1 gp', damage: '1d4', properties: 'Ranged', slots: 1 },
  { name: 'Sling', cost: '5 sp', damage: '1d4', properties: '-', slots: 1 },
  { name: 'Whip', cost: '10 gp', damage: '1d4', properties: 'Finesse, lash', slots: 1 },
  { name: 'Handaxe', cost: '2 gp', damage: '1d6', properties: 'Finesse, thrown', slots: 1 },
  { name: 'Stave', cost: '2 gp', damage: '1d6', properties: 'Two-handed', slots: 1 },
]
WEAPONS.push(...CURSED_SCROLL_WEAPONS)

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
// Cursed Scroll classes -- Diablerie (CS1), Red Sands (CS2), Midnight Sun
// (CS3). No new ancestries in any of the three zines, only classes. Several
// of these reference subsystems the app doesn't model in full (Patron Boon
// tables, the Black Lotus Talents table, mounts, Old Gods) -- those live as
// plain-text feature descriptions the player/GM reads and self-manages,
// same approach as Priest/Wizard spellcasting pointing at the Spells
// section instead of an in-app spell picker.
const MELEE_PLUS_CROSSBOW = WEAPONS.map((w) => w.name).filter((n) => !['Longbow', 'Shortbow'].includes(n))

const CURSED_SCROLL_CLASSES = [
  {
    name: 'Knight of St. Ydris',
    source: 'Cursed Scroll 1: Diablerie',
    hitDie: 6,
    weaponsAllowed: MELEE_PLUS_CROSSBOW,
    armorAllowed: ARMOR.map((a) => a.name),
    shieldAllowed: true,
    blurb: 'All melee weapons, crossbow. All armor and shields.',
    features: [
      { name: 'Languages', description: 'You know Diabolic.' },
      {
        name: 'Demonic Possession',
        description:
          '3/day, gain a +1 bonus to your damage rolls that lasts 3 rounds, plus half your level added to the bonus (round down).',
        dailyUses: 3,
      },
      {
        name: 'Spellcasting',
        description:
          'You can cast witch spells you know (shared list with the Witch class) -- add them in the Spells section below.',
      },
    ],
    talentTable: [
      { min: 2, max: 2, text: 'Your Demonic Possession bonus increases by 1 point' },
      { min: 3, max: 6, text: '+1 to melee or ranged attacks' },
      { min: 7, max: 9, text: '+2 to Strength, Dexterity, or Constitution stat' },
      { min: 10, max: 11, text: '+2 to Charisma stat or +1 to witch spellcasting checks' },
      { min: 12, max: 12, text: 'Choose a talent or +2 points to distribute to stats' },
    ],
  },
  {
    name: 'Warlock',
    source: 'Cursed Scroll 1: Diablerie',
    hitDie: 6,
    weaponsAllowed: ['Club', 'Crossbow', 'Dagger', 'Mace', 'Longsword'],
    armorAllowed: ['Leather armor', 'Chainmail'],
    shieldAllowed: true,
    blurb: 'Club, crossbow, dagger, mace, longsword. Leather armor, chainmail, and shields.',
    features: [
      { name: 'Languages', description: 'You know one of Celestial, Diabolic, Draconic, Primordial, or Sylvan (your choice).' },
      {
        name: 'Patron',
        description:
          "Choose a patron to serve. Your patron is the source of your supernatural gifts and can choose to grant or withhold them at any time -- you can gain new Patron Boons (or lose them) as a result.",
      },
      {
        name: 'Patron Boon',
        description:
          'At 1st level you gain a random Patron Boon talent based on your chosen patron (see the Patron Boon tables in your rules library). Whenever you gain a new talent roll, you may roll on your Patron Boon table instead of the Warlock Talents table.',
      },
    ],
    talentTable: [
      { min: 2, max: 2, text: 'Roll a Patron Boon from any patron; an unexplained gift' },
      { min: 3, max: 6, text: 'Add +1 point to two different stats' },
      { min: 7, max: 9, text: '+1 to melee or ranged attacks' },
      { min: 10, max: 11, text: 'Roll two Patron Boons and choose one to keep' },
      { min: 12, max: 12, text: 'Choose a talent or +2 points to distribute to stats' },
    ],
  },
  {
    name: 'Witch',
    source: 'Cursed Scroll 1: Diablerie',
    hitDie: 4,
    weaponsAllowed: ['Dagger', 'Staff'],
    armorAllowed: ['Leather armor'],
    shieldAllowed: false,
    blurb: 'Dagger, staff. Leather armor only.',
    features: [
      { name: 'Languages', description: 'You know Diabolic, Primordial, and Sylvan.' },
      {
        name: 'Familiar',
        description:
          "You have a small animal familiar (raven, rat, frog, etc.) who serves you loyally and can speak Common. It can be the source of spells you cast -- treat it as though it were you for determining spell ranges. If it dies, you can restore it to life by permanently sacrificing 1d4 HP.",
      },
      {
        name: 'Spellcasting',
        description:
          'You can cast witch spells you know using Charisma. You know three tier 1 spells of your choice from the witch spell list -- add them in the Spells section below.',
      },
    ],
    talentTable: [
      { min: 2, max: 2, text: "1/day, teleport to your familiar's location as a move" },
      { min: 3, max: 7, text: '+2 to Charisma stat or +1 to witch spellcasting checks' },
      { min: 8, max: 9, text: 'Gain advantage on casting one spell you know' },
      { min: 10, max: 11, text: 'Learn an additional witch spell of any tier you can cast' },
      { min: 12, max: 12, text: 'Choose a talent or +2 points to distribute to stats' },
    ],
  },
  {
    name: 'Desert Rider',
    source: 'Cursed Scroll 2: Red Sands',
    hitDie: 8,
    weaponsAllowed: ['Club', 'Dagger', 'Javelin', 'Longsword', 'Pike', 'Shortbow', 'Scimitar', 'Spear', 'Whip'],
    armorAllowed: ['Leather armor'],
    shieldAllowed: true,
    blurb: 'Club, dagger, javelin, longsword, pike, shortbow, scimitar, spear, whip. Leather armor and shields.',
    features: [
      {
        name: 'Mount',
        description:
          'You have a common camel or horse mount that comes when called and never spooks. While riding, both you and your mount get a bonus to AC equal to half your level (round down), and your mount gains additional levels equal to half your level (round down). You can freely mount or dismount once per round.',
      },
      {
        name: 'Charge',
        description: '3/day, charge into combat by moving at least near before attacking -- that attack deals double melee damage.',
        dailyUses: 3,
      },
    ],
    talentTable: [
      { min: 2, max: 2, text: 'You can use any rider-bearing creature as your mount' },
      { min: 3, max: 6, text: '+1 to attacks or damage' },
      { min: 7, max: 9, text: '+2 to Strength or Dexterity stat, or +1 to melee attacks' },
      { min: 10, max: 11, text: 'Gain an additional use of your Charge talent each day' },
      { min: 12, max: 12, text: 'Choose a talent or +2 points to distribute to stats' },
    ],
  },
  {
    name: 'Pit Fighter',
    source: 'Cursed Scroll 2: Red Sands',
    hitDie: 8,
    weaponsAllowed: 'ALL',
    armorAllowed: ['Leather armor'],
    shieldAllowed: true,
    blurb: 'All weapons. Leather armor and shields.',
    features: [
      { name: 'Flourish', description: '3/day, regain 1d6 HP when you hit an enemy with a melee attack.', dailyUses: 3 },
      { name: 'Implacable', description: 'Advantage on Constitution checks to resist injury, poison, or endure extreme environments.' },
      { name: 'Last Stand', description: 'You get up from dying with 1 HP on a natural d20 roll of 18-20.' },
      {
        name: 'Relentless',
        description:
          "3/day, when you're reduced to 0 HP, make a DC 18 Constitution check (Implacable applies) -- on a success you go to 1 HP instead.",
        dailyUses: 3,
      },
    ],
    talentTable: [
      { min: 2, max: 2, text: '1/day, ignore all damage and effects from one attack' },
      { min: 3, max: 6, text: 'You gain +1 to melee weapon damage' },
      { min: 7, max: 9, text: '+2 to Strength or Constitution stat, or +1 to melee attacks' },
      { min: 10, max: 11, text: 'Increase the HP you gain from Flourish by 1d6' },
      { min: 12, max: 12, text: 'Choose a talent or +2 points to distribute to stats' },
    ],
  },
  {
    name: 'Ras-Godai',
    source: 'Cursed Scroll 2: Red Sands',
    hitDie: 6,
    weaponsAllowed: ['Blowgun', 'Bolas', 'Dagger', 'Razor chain', 'Scimitar', 'Shuriken', 'Spear'],
    armorAllowed: ['Leather armor'],
    shieldAllowed: false,
    blurb: 'Blowgun, bolas, dagger, razor chain, scimitar, shuriken, spear. Leather armor only.',
    features: [
      { name: 'Languages', description: 'You know Diabolic.' },
      {
        name: 'Assassin',
        description: 'Advantage on checks to sneak and hide. Your attacks deal double damage against targets unaware of your presence.',
      },
      {
        name: 'Smoke Step',
        description: "3/day, teleport to a location you can see within near range. Doesn't use your action.",
        dailyUses: 3,
      },
      {
        name: 'Black Lotus',
        description:
          'You survived eating a petal of the fabled black lotus flower. Roll one talent on the Black Lotus Talents table (d12, see your rules library) and record the result as a note on this sheet.',
      },
    ],
    talentTable: [
      { min: 2, max: 2, text: 'You are trained in the use of poisons' },
      { min: 3, max: 6, text: 'Roll an additional talent on the Black Lotus Talents table' },
      { min: 7, max: 9, text: '+2 to Strength or Dexterity stat, or +1 to melee attacks' },
      { min: 10, max: 11, text: 'Gain an additional use of your Smoke Step talent' },
      { min: 12, max: 12, text: 'Choose a talent or +2 points to distribute to stats' },
    ],
  },
  {
    name: 'Sea Wolf',
    source: 'Cursed Scroll 3: Midnight Sun',
    hitDie: 8,
    weaponsAllowed: ['Dagger', 'Greataxe', 'Handaxe', 'Longbow', 'Longsword', 'Spear'],
    armorAllowed: ['Leather armor', 'Chainmail'],
    shieldAllowed: true,
    blurb: 'Dagger, greataxe, handaxe, longbow, longsword, spear. Leather armor, chainmail, and shields.',
    features: [
      { name: 'Seafarer', description: 'Advantage on checks related to navigating and crewing boats.' },
      {
        name: 'Old Gods',
        description:
          "Each day after you complete a rest, choose one until your next rest: Odin (regain 1d4 HP whenever you kill an enemy), Freya (once a day, gain a luck token if you don't have one; using a luck token adds 1d6), or Loki (advantage on checks to lie, sneak, and hide).",
      },
      {
        name: 'Shield Wall',
        description: 'If wielding a shield, use your action to take a defensive stance -- your AC becomes 20 until the stance ends.',
      },
    ],
    talentTable: [
      { min: 2, max: 2, text: '1/day, go berserk: immune to damage for 3 rounds' },
      { min: 3, max: 6, text: 'Your attacks deal +1 damage' },
      { min: 7, max: 9, text: '+2 to Strength or Constitution stat, or +1 to attacks' },
      { min: 10, max: 11, text: 'Duality; choose two different Old Gods effects each day' },
      { min: 12, max: 12, text: 'Choose a talent or +2 points to distribute to stats' },
    ],
  },
  {
    name: 'Seer',
    source: 'Cursed Scroll 3: Midnight Sun',
    hitDie: 6,
    weaponsAllowed: ['Dagger', 'Spear', 'Stave'],
    armorAllowed: ['Leather armor'],
    shieldAllowed: false,
    blurb: 'Dagger, stave, spear. Leather armor only.',
    features: [
      { name: 'Destined', description: 'Whenever you use a luck token, add 1d6 to the roll.' },
      {
        name: 'Omen',
        description: "3/day, make a DC 9 WIS check -- on a success, gain a luck token (you can't have more than one at a time).",
        dailyUses: 3,
      },
      {
        name: 'Spellcasting',
        description:
          'You can cast seer spells you know using Wisdom. You know one tier 1 spell of your choice from the seer spell list -- add them in the Spells section below.',
      },
    ],
    talentTable: [
      { min: 2, max: 2, text: 'Learn an additional seer spell from any tier you can cast' },
      { min: 3, max: 6, text: 'Gain an additional use of your Omen talent each day' },
      { min: 7, max: 9, text: '+2 to WIS or CHA stat, or +1 to spellcasting checks' },
      { min: 10, max: 11, text: 'Increase the die category of your Destined talent by one' },
      { min: 12, max: 12, text: 'Choose a talent or +2 points to distribute to stats' },
    ],
  },
]
CLASSES.push(...CURSED_SCROLL_CLASSES)

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
    const gearRows = [
      ...STARTING_KIT.map((item) => ({
        name: item.name,
        slots: item.slots,
        quantity: item.quantity || 1,
        equipped: false,
      })),
      ...(weaponData
        ? [{ name: weaponData.name, slots: weaponData.slots, quantity: 1, equipped: true }]
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
            },
          ]
        : []),
      ...(shieldChoice && selectedClass.shieldAllowed
        ? [{ name: SHIELD.name, slots: SHIELD.slots, quantity: 1, equipped: true, is_shield: true }]
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
    <div className="hidden md:flex items-center gap-1.5 overflow-x-auto">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setStep(i)}
            className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] border shrink-0 ${
              i < step
                ? 'bg-positive-bg border-positive text-positive-text'
                : i === step
                  ? 'bg-primary border-primary text-ink'
                  : 'border-line text-ink-faint'
            }`}
          >
            {i < step ? <Check size={12} /> : i + 1}
          </button>
          <span className={`text-xs whitespace-nowrap ${i === step ? 'text-ink' : 'text-ink-faint'}`}>{label}</span>
          {i < STEPS.length - 1 && <span className="w-5 h-px bg-panel2 shrink-0" />}
        </div>
      ))}
    </div>
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
          className="w-16 h-16 rounded-full overflow-hidden bg-bg border border-line flex items-center justify-center hover:border-ink-faint mb-1.5"
        >
          {portraitPreview ? (
            <img src={portraitPreview} alt="Portrait preview" className="w-full h-full object-cover" />
          ) : (
            <User size={22} className="text-ink-faint" />
          )}
        </button>
        <button
          onClick={() => portraitInputRef.current?.click()}
          className="text-[11px] text-ink-faint hover:text-ink-dim flex items-center gap-1 mb-2.5"
        >
          <Upload size={11} /> {portraitPreview ? 'Replace portrait' : 'Add portrait'}
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Unnamed adventurer"
          className="w-full text-sm bg-bg border border-line rounded-md px-2.5 py-1.5 text-ink text-center"
        />
      </div>

      <div className="grid grid-cols-4 gap-1.5 text-center mb-3 pb-3 border-b border-line-soft">
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

      <p className="text-xs text-ink-dim mb-1.5">Current choices</p>
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
      <div className="shrink-0 border-b border-line-soft px-6 py-3.5 flex items-center justify-between gap-4">
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
                <div className="grid grid-cols-2 gap-2.5">
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
                      className="text-xs border border-line rounded-md px-2.5 py-1 flex items-center gap-1.5 text-ink hover:bg-panel2"
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
                <div className="grid grid-cols-6 gap-1.5 mb-1.5">
                  {STAT_KEYS.map((k) => (
                    <div key={k} className="bg-bg rounded-md p-1.5 text-center">
                      <p className="text-[10px] text-ink-dim mb-1">{STAT_LABELS[k]}</p>
                      <input
                        type="number"
                        min="3"
                        max="18"
                        value={stats[k] ?? ''}
                        onChange={(e) => setStat(k, e.target.value)}
                        className="w-full bg-panel border border-line rounded text-center text-sm text-ink py-0.5"
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
                <div className="grid grid-cols-3 gap-1.5 mb-1.5">
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
                  <span className="block text-ink-faint mt-0.5">Languages: {selectedAncestry.languages}</span>
                </p>
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 className="text-ink text-sm font-medium mb-3">Pick your class</h2>
                {classesBySource().map((group) => (
                  <div key={group.label} className="mb-3">
                    <p className="text-[10px] uppercase tracking-wide text-ink-faint mb-1.5">{group.label}</p>
                    <div className="grid grid-cols-4 gap-1.5">
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
                    <div className="flex items-center gap-1.5">
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
                        className="text-xs border border-line rounded-md px-2.5 py-1.5 flex items-center gap-1.5 text-ink hover:bg-panel2"
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
                    <li key={f.name} className="text-[11px] text-ink-dim bg-bg rounded-md px-2.5 py-1.5 mb-1">
                      <span className="text-ink-dim">{f.name}.</span> {f.description}
                    </li>
                  ))}
                </ul>

                {charClass === 'Fighter' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <p className="text-[11px] text-ink-dim mb-1">Grit stat</p>
                      <select
                        value={gritStat}
                        onChange={(e) => setGritStat(e.target.value)}
                        className="w-full text-xs bg-bg border border-line rounded-md px-2 py-1.5 text-ink"
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
                        className="w-full text-xs bg-bg border border-line rounded-md px-2 py-1.5 text-ink"
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
                      className="w-full text-xs bg-bg border border-line rounded-md px-2.5 py-1.5 text-ink"
                    />
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
              <div>
                <h2 className="text-ink text-sm font-medium mb-3">Alignment &amp; background</h2>
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  {ALIGNMENTS.map((a) => (
                    <button
                      key={a}
                      onClick={() => setAlignment(a)}
                      className={`text-xs py-1.5 rounded-md border ${
                        alignment === a
                          ? 'bg-panel2 border-primary text-ink'
                          : 'border-line text-ink hover:bg-panel2'
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
                    className="flex-1 min-w-0 bg-bg border border-line rounded-md px-3 py-2 text-sm text-ink"
                  />
                  <button
                    onClick={rollBackground}
                    className="text-xs border border-line rounded-md px-2.5 py-1 flex items-center gap-1.5 text-ink hover:bg-panel2 shrink-0"
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
                    <li key={i} className="text-[11px] text-ink-dim bg-bg rounded-md px-2.5 py-1.5 mb-1">
                      ({t.formula}: {t.roll}) {t.description}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {step === 5 && (
              <div>
                <h2 className="text-ink text-sm font-medium mb-3">Weapon &amp; armor</h2>
                <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                  <select
                    value={weaponChoice}
                    onChange={(e) => setWeaponChoice(e.target.value)}
                    className="text-xs bg-bg border border-line rounded-md px-2 py-1.5 text-ink"
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
                      className="text-xs bg-bg border border-line rounded-md px-2 py-1.5 text-ink"
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
                  <label className="flex items-center gap-1.5 text-[11px] text-ink-dim mb-2">
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
                <div className="bg-bg rounded-md px-3.5 py-3 mb-3">
                  <p className="text-sm font-medium text-ink">
                    {name.trim() || `${ancestry} ${charClass.toLowerCase()}`}
                  </p>
                  <p className="text-[11px] text-ink-dim mt-0.5">
                    {ancestry} {charClass.toLowerCase()} &middot; level 1 &middot; {alignment}
                    {background ? ` · ${background.split(' -- ')[0]}` : ''}
                  </p>
                  <p className="text-[11px] text-ink-dim mt-0.5">
                    {computedHp ?? 'unrolled'} hp (1d{selectedClass.hitDie}: {hpRoll ?? '—'}{hpBonus ? ` + ${hpBonus} stout` : ''}
                    {conMod ? ` ${conMod >= 0 ? '+' : ''}${conMod} con` : ''}) &middot; ac {computedAc} &middot; {coin} gp
                  </p>
                  <p className="text-[11px] text-ink-faint mt-0.5">
                    {weaponChoice}
                    {armorChoice ? `, ${armorChoice}` : ''}
                    {shieldChoice && selectedClass.shieldAllowed ? ', shield' : ''}, backpack &amp; adventuring kit
                  </p>
                </div>
                <p className="text-xs text-ink-dim mb-1.5">Talents</p>
                <ul className="mb-3">
                  {talents.map((t, i) => (
                    <li key={i} className="text-[11px] text-ink-dim bg-bg rounded-md px-2.5 py-1.5 mb-1">
                      ({t.formula}: {t.roll}) {t.description}
                    </li>
                  ))}
                </ul>
                {error && (
                  <div className="flex items-center gap-1.5 text-danger-text">
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

      <div className="shrink-0 border-t border-line-soft px-6 py-3">
        <div className="max-w-5xl mx-auto grid grid-cols-[1fr_260px] gap-4">
          <div className="flex items-center justify-between">
            <button
              onClick={goBack}
              disabled={step === 0}
              className="text-sm border border-line rounded-md px-3 py-1.5 flex items-center gap-1.5 text-ink hover:bg-panel2 disabled:opacity-40 disabled:hover:bg-transparent"
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
                className="text-sm bg-primary hover:bg-primary/90 disabled:opacity-50 text-ink rounded-md px-3.5 py-1.5 flex items-center gap-1.5"
              >
                Continue <ChevronRight size={14} />
              </button>
            ) : (
              <button
                onClick={start}
                disabled={saving || !hasValidHpRoll}
                className="text-sm bg-primary hover:bg-primary/90 disabled:opacity-50 text-ink rounded-md px-3.5 py-1.5"
              >
                {saving ? 'Saving...' : 'Start playing'}
              </button>
            )}
          </div>
          <div className="hidden md:block" />
        </div>
      </div>
    </div>
  )
}
