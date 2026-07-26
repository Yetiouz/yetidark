// Placeholder data so the UI is fully clickable before real accounts / a
// database are wired up. Swap this file out first when connecting Supabase.

export const currentUser = { name: 'Yeti', initial: 'Y' }

export const campaigns = [
  {
    id: 'sunken-keep',
    name: 'The sunken keep',
    system: 'Shadowdark',
    session: 6,
    status: 'live',
    gm: { type: 'human', name: 'Marcus' },
    playerCount: 4,
  },
  {
    id: 'barrowfield',
    name: 'Barrowfield',
    system: 'Shadowdark',
    session: 2,
    status: 'ai-gm',
    gm: { type: 'ai', name: 'AI' },
    playerCount: 3,
  },
]

export const myCharacters = [
  {
    id: 'yeti-priest',
    name: "Yeti's priest",
    className: 'Human priest',
    level: 3,
    campaign: 'The sunken keep',
    initial: 'Y',
    color: 'blue',
  },
  {
    id: 'rendil',
    name: 'Rendil the bold',
    className: 'Dwarf fighter',
    level: 1,
    campaign: 'Barrowfield',
    initial: 'R',
    color: 'amber',
  },
]

export const party = [
  {
    id: 'marcus',
    name: 'Marcus',
    className: 'Halfling thief',
    level: 3,
    hp: 14,
    maxHp: 20,
    ac: 13,
  },
  {
    id: 'yeti',
    name: 'Yeti',
    className: 'Human priest',
    level: 3,
    hp: 9,
    maxHp: 20,
    ac: 15,
  },
  {
    id: 'jordan',
    name: 'Jordan',
    className: 'Elf wizard',
    level: 2,
    hp: 12,
    maxHp: 12,
    ac: 11,
  },
]

export const turnOrder = [
  { id: 'marcus', name: 'Marcus', status: 'acting' },
  { id: 'rats', name: 'Giant rat x2', status: '2 hp' },
  { id: 'yeti', name: 'Yeti', status: 'up next' },
  { id: 'jordan', name: 'Jordan', status: 'up next' },
]

export const initialSceneLog = [
  { type: 'narration', text: "The iron door groans open. Cold air rolls out, carrying the smell of stagnant water." },
  { type: 'chat', name: 'Marcus', text: 'I light a torch and step in first.' },
  { type: 'gm', name: 'GM', text: 'Roll a d20 for perception as you cross the threshold.' },
  { type: 'roll', name: 'Yeti', text: 'rolled a 17 (d20)', source: 'app' },
  { type: 'roll', name: 'Jordan', text: 'rolled a 14 (d20)', source: 'self' },
]

export const encounter = [
  { id: 'rat1', name: 'Giant rat', ac: 12, hp: 2, maxHp: 3, hidden: false },
  { id: 'rat2', name: 'Giant rat', ac: 12, hp: 3, maxHp: 3, hidden: false },
  { id: 'hag', name: 'Bog hag', ac: 14, hp: 18, maxHp: 18, hidden: true },
]

export const gmNotes = [
  { id: 1, text: 'The bog hag offers a trade before attacking if approached without weapons drawn.', revealed: false },
  { id: 2, text: "Vault key is sewn into the drowned monk's robe, not on the altar.", revealed: false },
]

// Hex grid: 4 rows x 6 cols. state: 'fog' | 'explored' | 'party'
// terrain only matters once a hex is explored.
export const initialHexGrid = [
  [
    { terrain: 'forest', state: 'explored' },
    { terrain: 'forest', state: 'explored' },
    { terrain: 'fog', state: 'fog' },
    { terrain: 'fog', state: 'fog' },
    { terrain: 'fog', state: 'fog' },
    { terrain: 'fog', state: 'fog' },
  ],
  [
    { terrain: 'water', state: 'explored' },
    { terrain: 'plain', state: 'party' },
    { terrain: 'fog', state: 'fog' },
    { terrain: 'fog', state: 'fog' },
    { terrain: 'fog', state: 'fog' },
  ],
  [
    { terrain: 'fog', state: 'fog' },
    { terrain: 'rock', state: 'explored' },
    { terrain: 'fog', state: 'fog' },
    { terrain: 'fog', state: 'fog' },
    { terrain: 'fog', state: 'fog' },
    { terrain: 'fog', state: 'fog' },
  ],
  [
    { terrain: 'fog', state: 'fog' },
    { terrain: 'fog', state: 'fog' },
    { terrain: 'fog', state: 'fog' },
    { terrain: 'fog', state: 'fog' },
    { terrain: 'fog', state: 'fog' },
  ],
]
