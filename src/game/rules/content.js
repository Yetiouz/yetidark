// Shadowdark RPG static rules content -- ancestries, weapons, armor,
// classes (with talent tables and features), starting kit, and
// backgrounds. Extracted from CharacterBuilder.jsx (2026-08-03) so other
// consumers -- Character Advancement (needs the talent tables to resolve
// levels 3/5/7/9), an in-app quick reference, the AI GM -- don't have to
// duplicate or reach into a character-creation-only component. Pure data,
// no logic; versioned alongside the computation helpers in
// character.js's SHADOWDARK_RULESET (same ruleset, same book sources, no
// content changed by this split).
//
// Real core-rulebook data (Shadowdark RPG, The Arcane Library) -- ancestries,
// classes, weapons, armor, talent tables, and backgrounds transcribed from
// the corebook rather than the earlier placeholder set, per the Shadowdark
// RPG Third-Party License (real names/mechanics, not verbatim book layout
// or art). Cursed Scroll ancestries/classes are a separate follow-on chunk.
export const ANCESTRIES = [
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
export const WEAPONS = [
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
export const CURSED_SCROLL_WEAPONS = [
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
export const ARMOR = [
  { name: 'Leather armor', cost: '10 gp', slots: 1, baseAc: 11, dexApplies: true, properties: '-' },
  { name: 'Chainmail', cost: '60 gp', slots: 2, baseAc: 13, dexApplies: true, properties: 'Disadvantage on stealth, swim' },
  { name: 'Plate mail', cost: '130 gp', slots: 3, baseAc: 15, dexApplies: false, properties: 'No swim, disadvantage on stealth' },
]
export const SHIELD = { name: 'Shield', cost: '10 gp', slots: 1, acBonus: 2, properties: 'Occupies one hand' }

export const CLASSES = [
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
export const MELEE_PLUS_CROSSBOW = WEAPONS.map((w) => w.name).filter((n) => !['Longbow', 'Shortbow'].includes(n))

export const CURSED_SCROLL_CLASSES = [
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

export const STARTING_KIT = [
  { name: 'Backpack', slots: 0 },
  { name: 'Torch', slots: 1, quantity: 2 },
  { name: 'Rations', slots: 1, quantity: 3 },
  { name: 'Flint and steel', slots: 1 },
  { name: "Rope, 60'", slots: 1 },
]

// Background, pg. 26 -- roll a d20 or just pick one that fits.
export const BACKGROUNDS = [
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

// Standard difficulty classes, pg. 81 ("Making Checks"). The GM calls for a
// check when the action has a negative consequence for failure, requires
// skill, or there's time pressure -- these four DCs are the entire
// difficulty scale used for every ability check in the game.
export const STANDARD_DCS = [
  { label: 'Easy', dc: 9, examples: 'Leaping a narrow chasm, sneaking up on an inattentive guard.' },
  { label: 'Normal', dc: 12, examples: 'Kicking open a stuck door, picking a poor lock.' },
  {
    label: 'Hard',
    dc: 15,
    examples: 'Swimming against a strong current, giving first aid to stop a character from dying.',
  },
  { label: 'Extreme', dc: 18, examples: 'Climbing a slippery cliff one-handed, restraining a frenzied lion.' },
]

// Distances and movement, pg. 85 ("Movement"). Distances are zones, not
// exact feet -- matches ZoneScene.jsx's Close/Near/Far ring model directly.
export const DISTANCES = [
  { label: 'Close', detail: '5 feet -- melee range.' },
  { label: 'Near', detail: 'Up to 30 feet.' },
  { label: 'Far', detail: 'Within sight during an encounter or scene.' },
]

export const MOVEMENT_RULES = [
  {
    name: 'Climbing',
    text: 'Strength or Dexterity check to climb half your speed. Fall if you fail the check by 5 or more.',
  },
  { name: 'Falling', text: 'Take 1d6 damage for every 10 feet you fall.' },
  { name: 'Moving through', text: 'Move freely through allies. Strength or Dexterity check to move through enemies.' },
  {
    name: 'Swimming',
    text:
      'Swim at half speed (Strength check in rough water). Hold your breath for a number of rounds equal to your ' +
      'Constitution modifier (minimum 1); after that, make a Constitution check each round or take 1d6 damage ' +
      'per round until you exit the hazard.',
  },
]

// Downtime carousing costs, pg. 92 ("Carousing"). Each participant pitches
// in the cost, then rolls 1d8 + the tier's bonus against the outcome table
// (resolved server-side in carouse_character() -- the exact 14-row outcome
// table lives in that RPC, not duplicated here, since it needs live coin/
// luck-token state to resolve XP/wealth/luck effects).
export const CAROUSING_COSTS = [
  { gp: 30, bonus: 0, label: 'A worthy night of drinking and festivity' },
  { gp: 100, bonus: 1, label: 'A full day and night of revelry, gambling, and recounting your exploits' },
  { gp: 300, bonus: 2, label: 'Two days of crawling dozens of taverns to sing, buy rounds, and celebrate' },
  { gp: 600, bonus: 3, label: 'A three-day voyage into the finest food, drink, and gambling you can find' },
  { gp: 900, bonus: 4, label: 'A hazy, weeklong bender that runs multiple well-known taverns dry' },
  {
    gp: 1200,
    bonus: 5,
    label: 'A spirited fete lasting ten days that attracts hordes of revelers and takes over an entire town or a city district',
  },
  {
    gp: 1800,
    bonus: 6,
    label: 'Two legendary weeks of drinking and debauchery widespread enough to take over a whole city',
  },
]
