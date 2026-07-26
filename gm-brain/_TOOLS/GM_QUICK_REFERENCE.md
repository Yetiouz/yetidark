# GM Quick Reference

Condensed, page-cited excerpts of the rules a GM needs constantly mid-session, pulled directly from the core rulebook (`_RULES/Shadowdark_RPG_-_V4-9.pdf`) so rulings are grounded in the actual text instead of memory. Page numbers below refer to that PDF. For anything not covered here, search the source directly rather than guessing.

## Turn order / initiative (pg. 83)

Everyone rolls 1d20 + DEX mod (GM adds the highest DEX mod of any monsters). Highest goes first, turn order moves clockwise. Freeform mode is allowed: loose round-robin, players decide order among themselves, GM adjudicates.

## Crawling rounds & light (pg. 84-85)

Characters need light to see; non-dark-adapted creatures have disadvantage on sight-based tasks in total darkness, and the GM checks for a random encounter every crawling round in total darkness. Light sources last ~1 hour real time. Climbing: STR/DEX check, half speed, fall if failed by 5+. Falling: 1d6 damage per 10 ft. Swimming: half speed, hold breath for CON mod rounds (min 1), then CON check or 1d6 damage/round.

## Resting (pg. 86)

8 hours sleep + consume a ration. Each stressful interruption (including combat) forces a DC 12 CON check — fail means the ration is consumed with no benefit. Success: full HP and stat damage recovery. In a dangerous environment, check for random encounters at the overland cadence (below) while resting.

## Stealth & surprise (pg. 87-88)

Hiding/sneaking: DEX check to stay undetected. Detecting: WIS check (unless looking in the exact right place, which auto-reveals). A creature that begins its turn undetected acts first (a full turn) before initiative is rolled, and has advantage on its attack.

## Combat (pg. 88-90)

**Actions:** melee attack (1d20 + STR mod + bonuses vs. AC), ranged attack (1d20 + DEX mod + bonuses vs. AC), cast a spell (1 action), improvise (GM sets DC/roll type), multitask (small parallel tasks, usually free).

**Damage:** roll weapon/spell dice + bonuses. Natural 20 = critical hit (double damage dice, or double one numerical spell effect).

**Terrain:** attacking a target hiding behind cover (half-body+) = disadvantage. Can't target what you can't see at all. Hampering terrain (ice, mud) halves movement through it.

**Morale:** enemies reduced to half their number (or half HP for a solo enemy) flee on a failed DC 15 WIS check. Large groups: one check using the leader's modifier.

**Death:** 0 HP = unconscious and dying. Death timer = 1d4 + CON mod (min 1) rounds; roll a d20 each subsequent turn, natural 20 = rise with 1 HP. Stabilize: DC 15 INT check at close range (target stays unconscious but stops dying). Perishing = character retired.

## Spellcasting checks (pg. 44-45)

Wizard spells: 1d20 + INT mod. Priest spells: 1d20 + WIS mod. DC = 10 + spell tier. Success = spell takes effect. Failure = spell fails, can't be recast until a rest. Natural 20 = double one numerical effect. Natural 1 = spell fails, can't recast until rest, and (wizard) roll on the Wizard Mishap table for that tier, or (priest) deity revokes the spell until penance + rest.

## Overland travel & random encounters (pg. 90, 112-113)

**Overland encounter cadence:** Unsafe = check every 3 hours. Risky = every 2 hours. Deadly = every hour.

**Crawling-round encounter cadence** (dungeons/perilous sites, not overland): Unsafe = every 3 rounds. Risky = every 2 rounds. Deadly = every round. Roll 1d6; encounter occurs on a 1.

**Starting distance (d6):** 1 = Close, 2-4 = Near, 5-6 = Far.

**Activity (2d6):** 2-4 Hunting, 5-6 Eating, 7-8 Building/nesting, 9-10 Socializing/playing, 11 Guarding, 12 Sleeping.

**Reaction check (2d6 + CHA mod of an interacting character):** 0-6 Hostile, 7-8 Suspicious, 9 Neutral, 10-11 Curious, 12+ Friendly. Some creatures (undead, etc.) are always hostile regardless of roll.

**Treasure presence:** 50% chance a random encounter has no treasure at all.

## Traps (pg. 114)

Should have a tell; searching a specific area/object auto-finds a trap. d12 trigger/effect table (roll or pick to match the scene):

1 Crossbow tripwire 1d6 · 2 Hail of needles (pressure plate) 1d6/sleep · 3 Toxic gas (opening a door) 1d6/paralyze · 4 Barbed net (switch/button) 1d6/blind · 5 Rolling boulder (false step) 2d8 · 6 Slicing blade (closing a door) 2d8/sleep · 7 Spiked pit (light beam broken) 2d8/paralyze · 8 Javelin (pulling a lever) 2d8/confuse · 9 Magical glyph (word spoken) 3d10 · 10 Blast of fire (hook on thread) 3d10/paralyze · 11 Falling block (removing object) 3d10/unconscious · 12 Cursed statue (casting a spell) 3d10/petrify

## Hazards (pg. 115)

Usually obvious, rarely disable-able. d12 by category — pick one from Movement / Damage / Weaken to combine into a threat:

Movement: quicksand, caltrops, loose debris, tar field, grasping vines, steep incline, slippery ice, rushing water, sticky webs, gale force wind, greased floor, illusory terrain.
Damage: acid pools, exploding rocks, icy water, lava, pummeling hail, steam vents, toxic mold, falling debris, acid rain, curtain of fire, electrified field, gravity flux.
Weaken: blinding smoke, magnetic field, exhausting runes, antimagic zone, snuffs light sources, disorienting sound, magical silence, numbing cold, sickening smell, sleep-inducing spores, confusing reflections, memory-stealing.

## Modes of Play — optional toggles (pg. 111)

Mix and match; note in `GM_PERSONA.md` or a campaign's `campaign-state.md` which are active for that table.

- **Hunter:** defeated monsters grant XP equal to half their level (round down).
- **Momentum:** advantage on repeating a failed action next turn; damage dice explode (max roll = roll again, add, no cap).
- **Pulp:** no cap on luck tokens; start each session with 1d4; spend one to turn a hit into a crit, take an extra action, or force a GM reroll.
- **Blitz:** light timers last 30 minutes instead of ~1 hour.
- **Chaos:** reroll initiative at the start of every combat round.
- **Deadly:** death timers are always exactly 1; DC 18 (not 15) to stabilize.
- **Fatality:** characters die outright at 0 HP — no death timer.
- **Grinder:** rests only recover 1 stat damage per stat + one hit-die roll of HP (dwarves roll with advantage); spellcasters regain only 1d4 lost spells per rest.
