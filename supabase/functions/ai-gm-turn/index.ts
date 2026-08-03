// Delve — AI GM turn (chunk 9 of the GM-brain integration; switched to
// Gemini in a follow-up so it's usable on Google's free tier while you
// don't have Anthropic API billing set up).
//
// Invoked when anyone in an AI-GM campaign hits "Continue": compiles what's
// happened in the shared scene log since the AI's last turn, hands it to
// Gemini along with the campaign's house rules, NPCs, factions, and party
// roster, and posts the response back into the same scene log everyone
// already reads (as a new 'ai_gm' entry -- see 011_ai_gm.sql).
//
// Reads run under the caller's JWT and RLS. After membership and AI-campaign
// checks pass, only AI-authored dice/log writes use Supabase's built-in
// service-role secret so public clients cannot forge those entries. The
// project-specific secret this function needs is GEMINI_API_KEY, added as an
// Edge Function secret (never handled by the app or sent through chat).
//
// Ported from the file-based GM system's Core GM Commitment #1: "real
// dice, always -- every GM-side check, attack, damage roll, and random-
// table lookup is rolled through dice.py, not narrated or asserted." The
// model gets a roll_dice tool instead of being trusted to just assert a
// fair outcome -- every GM-side roll it wants to make actually happens
// here, server-side, with a real RNG, and is logged to dice_rolls exactly
// like a human GM's rolls are.
//
// Tool surface (Decision Queue #31 -- 2026-08-03): beyond roll_dice, the
// model gets spawn_monster/damage_monster/remove_monster (part 1), which
// write directly to encounter_monsters via the same service-role `writer`
// client dice_rolls already uses -- no new RPC needed, this is the
// identical direct-table-CRUD shape GmDashboard.jsx's own addMonster/
// adjustHp/deleteMonster already use for a human GM. It also gets
// resolve_morale_check/resolve_stabilize_check/resolve_dying_turn (part 2),
// which call the same combat-resolution RPCs a human GM's UI calls. Those
// three are SECURITY DEFINER RPCs that originally checked is_campaign_gm()/
// is_campaign_member() -- both of which read auth.uid(), which is null for
// this service-role `writer` client, so they'd always have rejected it.
// Fixed at the source (migration allow_service_role_through_gm_and_member_
// checks) by widening both predicate functions to also accept auth.role()
// = 'service_role' -- safe, since service_role already bypasses RLS on
// every table these touch regardless of what the predicate returns, so the
// widening only removes a redundant explicit check these SECURITY DEFINER
// functions layer on top of RLS, without changing who can reach them.
// Still not wired: adjust_character_resource, roll_initiative/advance_turn,
// advance_clock, reveal/light control, write_gm_note/update_npc/
// update_faction (rest of #31).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_MODEL = 'gemini-3.6-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const MAX_TOOL_ROUNDS = 14
const TRANSCRIPT_LIMIT = 60
const GEMINI_MAX_RETRIES = 1 // retries on 429 (rate limit) before giving up on this turn

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MODES_OF_PLAY = {
  hunter: 'Hunter -- resources run out faster (rations, torches, ammo scarcer).',
  momentum: 'Momentum -- brisk pace, shorter rests, less downtime between scenes.',
  pulp: 'Pulp -- heroic and forgiving, characters shrug off death more easily.',
  blitz: 'Blitz -- combat moves fast, streamlined turns, less bookkeeping mid-fight.',
  chaos: 'Chaos -- embraces the unpredictable, random tables and wild swings come up more.',
  deadly: 'Deadly -- danger is real, fights are riskier and death comes easier.',
  fatality: 'Fatality -- death is final, no fudging, no walking it back.',
  grinder: 'Grinder -- attrition matters more over a long dungeon crawl.',
}

// Per-campaign AI GM preferences, captured by the campaign creation wizard
// (015_campaign_wizard_fields.sql) but not previously read by this
// function -- the columns existed, this is what actually wires them into
// the prompt. Every map falls back to the wizard's own default (balanced /
// guided / ask_major) so older campaigns created before this migration,
// or a campaign with an unset field, still get sane behavior.
const GM_TONE = {
  grim: 'Grim -- danger feels constant, victories are hard-won.',
  balanced: 'Balanced -- danger is real, with room for humor and dramatic moments.',
  heroic: 'Heroic -- leans pulpy and cinematic, the party is the main event.',
}

const GM_RULES_STYLE = {
  strict: 'Strict -- rules as written, minimal GM fiat.',
  flexible: 'Flexible -- rule of cool over rules as written when it makes the scene better.',
  guided: 'Guided -- rules as written by default, with GM judgment calls when it clearly serves the story.',
}

const GM_AUTONOMY = {
  ask_major:
    "Ask before major, hard-to-reverse story decisions (a PC's death, a campaign-altering twist) -- present the moment and the stakes, then let the table weigh in, rather than resolving it unilaterally in this turn's narration. Everything else, just run it.",
  ask_every:
    'Check in with the table before significant choices more often, even some mid-scene ones -- lean toward presenting options rather than deciding for the party.',
  auto: "Full autonomy -- run the campaign forward without pausing to check in, including major twists and PC death. Don't hold back waiting for permission.",
}

function lethalityLabel(n: number | null | undefined): string {
  if (n == null) return 'Default -- moderate danger, no thumb on the scale either way.'
  if (n <= 20) return `${n}/100 -- very forgiving. Bad rolls rarely end in death; look for plausible ways characters survive close calls.`
  if (n <= 40) return `${n}/100 -- forgiving. Death is possible but lean toward giving characters an out when the dice allow it.`
  if (n <= 60) return `${n}/100 -- moderate. Play it straight -- consequences land exactly as rolled.`
  if (n <= 80) return `${n}/100 -- dangerous. Bad rolls and bad decisions have real teeth; don't pull punches.`
  return `${n}/100 -- lethal, rules as written. Death is on the table constantly and should never be softened.`
}

const PERSONA = `You are the Game Master for a Shadowdark RPG campaign, running an async text game.

CORE COMMITMENTS (non-negotiable):
1. Real dice, always. Every GM-side check, attack, damage roll, and random-table lookup goes through the roll_dice tool -- never narrate or assert an outcome you didn't actually roll. A player's own rolls for their own character belong to them; only roll for NPCs, monsters, and the environment. When you can already foresee needing several rolls for the same beat (an attack roll plus its damage roll, three monsters reacting at once, a loot table plus a specific-item lookup), call roll_dice for all of them in the same turn instead of one at a time across several turns -- this API has a tight per-minute rate limit and every extra round-trip spends part of it.
2. Ground rulings in the campaign's actual house rules and context provided below, not invented rules.
3. Consequences stick. No retroactive softening of a bad outcome, including PC death, to protect the story.
4. If a table is aimless or stuck, actively nudge -- resurface a lead, frame explicit choices -- rather than leaving it fully open with no momentum (guided sandbox, not railroad).
5. Monsters and other mechanical combatants are real tracked things, not just prose. Use spawn_monster the moment one becomes a real combatant in the scene, damage_monster for every hit that actually lands (after rolling damage with roll_dice), and remove_monster once it's truly dead or gone for good -- don't leave a monster's HP only described in narration without updating it here too.
6. A character shown as STATUS: DYING in the PARTY list needs a real death check every round they stay dying on their turn -- call resolve_dying_turn for them, don't just narrate whether they cling on. If another character at Close range is trying to save them, call resolve_stabilize_check instead of narrating a rescue. When a group of monsters or NPCs takes heavy losses, loses its leader, or otherwise has real reason to break, call resolve_morale_check rather than deciding unilaterally whether they flee.

VOICE: Grimdark with real humor -- "Dungeon Crawler Carl" register. Stakes are genuinely dark (death is permanent, monsters are horrific) but it should also be funny -- dark comedy, snark, absurd/gonzo details, theatrical flair. A funny death is still a real, permanent death.

PACING: Cinematic default. Narration is punchy and vivid, not overwritten. Travel and downtime move fast (a sentence or two). The dungeon-crawl itself -- searching, traps, puzzles, tense standoffs -- gets real detail. Combat and dramatic reveals are allowed to breathe.

NPC VOICE: Recurring NPCs, quest-givers, villains, and anyone with a real role get a distinct, memorable voice. One-off transactional NPCs (a shopkeeper selling rope) stay quick and functional.

CONTENT: No pre-set hard lines -- mature themes, cursing, dark content are fair game, fitting the grimdark tone.

FORMAT: Write your response as the GM's narration for this turn -- what happens as a result of what the party just did, in-scene, addressed to the table. Keep it tight: a few tight paragraphs, not a wall of text, unless a dramatic beat genuinely earns more room. If nothing has happened yet (this is the very first turn), open the scene with a strong hook and 2-3 plausible directions rather than waiting to be prompted.`

function corsResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  })
}

function rollNotation(notation: string, mode: string): {
  total: number
  breakdown: string
  rawD20: number | null
  isCrit: boolean
  isFumble: boolean
} {
  const match = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(notation.trim())
  if (!match) throw new Error(`Invalid dice notation: "${notation}". Use a format like "1d20+3".`)
  const count = parseInt(match[1], 10)
  const sides = parseInt(match[2], 10)
  const modifier = match[3] ? parseInt(match[3], 10) : 0
  if (count < 1 || count > 100 || sides < 2 || sides > 1000) {
    throw new Error(`Dice notation out of range: "${notation}".`)
  }

  const rollOne = () => Math.floor(Math.random() * sides) + 1

  if (count === 1 && sides === 20 && (mode === 'advantage' || mode === 'disadvantage')) {
    const a = rollOne()
    const b = rollOne()
    const raw = mode === 'advantage' ? Math.max(a, b) : Math.min(a, b)
    const total = raw + modifier
    return {
      total,
      breakdown: `${mode} (${a}, ${b} -> ${raw})${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`,
      rawD20: raw,
      isCrit: raw === 20,
      isFumble: raw === 1,
    }
  }

  const rolls: number[] = []
  for (let i = 0; i < count; i++) rolls.push(rollOne())
  const sum = rolls.reduce((a, b) => a + b, 0)
  const total = sum + modifier
  const rawD20 = count === 1 && sides === 20 ? rolls[0] : null
  return {
    total,
    breakdown: `[${rolls.join(', ')}]${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`,
    rawD20,
    isCrit: rawD20 === 20,
    isFumble: rawD20 === 1,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  if (!geminiKey) {
    return corsResponse(
      { error: "AI GM isn't set up yet -- add a GEMINI_API_KEY secret in Supabase (Project Settings > Edge Functions > Secrets). Get a free key at aistudio.google.com (no card required)." },
      500
    )
  }

  let campaignId: string
  try {
    const body = await req.json()
    campaignId = body.campaignId
    if (!campaignId) throw new Error('missing campaignId')
  } catch {
    return corsResponse({ error: 'Request must include { campaignId }.' }, 400)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return corsResponse({ error: 'Not signed in.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceRoleKey) return corsResponse({ error: 'AI GM server access is not configured.' }, 500)

  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return corsResponse({ error: 'Not signed in.' }, 401)

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, name, system, gm_type, house_rules, modes_of_play, session_number, ai_gm_tone, ai_gm_rules_style, ai_gm_lethality, ai_gm_autonomy')
    .eq('id', campaignId)
    .maybeSingle()

  if (campaignError || !campaign) return corsResponse({ error: 'Campaign not found, or you are not a member.' }, 404)
  if (campaign.gm_type !== 'ai') return corsResponse({ error: 'This campaign has a human GM.' }, 400)

  // All reads above and below use the caller's JWT and RLS. Only after the
  // caller and AI campaign are validated do writes use service_role, keeping
  // AI-authored entries impossible to forge through the public data API.
  const writer = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: claim, error: claimError } = await supabase.rpc('claim_ai_gm_turn', {
    p_campaign_id: campaignId,
  })
  if (claimError) return corsResponse({ error: claimError.message }, 400)

  if (claim?.status === 'skipped') {
    return corsResponse({ success: true, skipped: true })
  }
  if (claim?.status === 'busy') {
    return corsResponse(
      { success: true, skipped: true, busy: true },
      202,
      { 'Retry-After': String(claim.retry_after_seconds || 1) }
    )
  }
  if (claim?.status === 'rate_limited') {
    const retryAfter = claim.retry_after_seconds || 60
    return corsResponse(
      { error: `The AI GM is receiving too many turn requests. Try again in ${retryAfter} seconds.` },
      429,
      { 'Retry-After': String(retryAfter) }
    )
  }
  if (claim?.status !== 'claimed' || !claim.claim_token) {
    return corsResponse({ error: 'Could not reserve the AI GM turn.' }, 500)
  }

  const claimToken = claim.claim_token as string
  const releaseClaim = async () => {
    await writer.rpc('release_ai_gm_turn', {
      p_campaign_id: campaignId,
      p_claim_token: claimToken,
    })
  }

  const [{ data: party }, { data: npcs }, { data: factions }, { data: log }, { data: encounterMonsters }] = await Promise.all([
    supabase.from('characters').select('id, name, ancestry, class, level, hp, max_hp, ac, status, death_timer, zone').eq('campaign_id', campaignId),
    supabase.from('campaign_npcs').select('id, name, ancestry, role, location, attitude, status').eq('campaign_id', campaignId),
    supabase.from('campaign_factions').select('id, name, type, leader, territory, disposition, status_clock').eq('campaign_id', campaignId),
    supabase
      .from('scene_log')
      .select('id, type, sender_name, text, created_at')
      .eq('campaign_id', campaignId)
      .lte('created_at', claim.claimed_at)
      .order('created_at', { ascending: false })
      .limit(TRANSCRIPT_LIMIT),
    // writer (service-role), not the caller's RLS-scoped `supabase` client --
    // the AI is acting as this campaign's GM, so it needs to see hidden
    // monsters too, same as a human GM's own dashboard does.
    writer.from('encounter_monsters').select('id, name, ac, hp, max_hp, dex_mod, zone, hidden').eq('campaign_id', campaignId),
  ])

  // Mutable working copy: spawn_monster/damage_monster/remove_monster below
  // update this in place so a later tool call in the same turn (e.g. damage
  // a monster spawned earlier this same turn) resolves by name correctly
  // without needing a fresh DB round-trip.
  const currentMonsters: Array<{ id: string; name: string; ac: number; hp: number; max_hp: number; dex_mod: number; zone: string; hidden: boolean }> =
    encounterMonsters ? [...encounterMonsters] : []

  // Mutable working copy for the party too: resolve_dying_turn/
  // resolve_stabilize_check below update status/death_timer in place so a
  // later tool call in the same turn (e.g. a second death check on the same
  // character) sees the current state without a fresh DB round-trip.
  const currentParty: Array<{ id: string; name: string; ancestry: string; class: string; level: number; hp: number; max_hp: number; ac: number; status: string; death_timer: number | null; zone: string | null }> =
    party ? [...party] : []

  const transcript = (log || []).slice().reverse()
  const [{ data: npcSecrets }, { data: factionSecrets }] = await Promise.all([
    (npcs || []).length
      ? writer.from('campaign_npc_secrets').select('npc_id, notes').in('npc_id', (npcs || []).map((npc) => npc.id))
      : Promise.resolve({ data: [] }),
    (factions || []).length
      ? writer.from('campaign_faction_secrets').select('faction_id, goal, notes').in('faction_id', (factions || []).map((faction) => faction.id))
      : Promise.resolve({ data: [] }),
  ])
  const npcSecretById = new Map((npcSecrets || []).map((secret) => [secret.npc_id, secret]))
  const factionSecretById = new Map((factionSecrets || []).map((secret) => [secret.faction_id, secret]))

  const lastAiIndex = [...transcript].map((e) => e.type).lastIndexOf('ai_gm')

  const lines: string[] = []
  transcript.forEach((entry, i) => {
    if (i === lastAiIndex + 1 && lastAiIndex !== -1) {
      lines.push('--- everything below is new since your last turn -- respond to this ---')
    }
    const label = entry.type === 'ai_gm' ? 'GM (you)' : entry.type === 'gm' ? 'GM' : entry.type === 'roll' ? 'Roll' : entry.sender_name
    lines.push(`${label}: ${entry.text}`)
  })
  const transcriptText = lines.length
    ? lines.join('\n')
    : "(Nothing has happened yet -- this is the very first turn. Open the scene.)"

  const modesActive = (campaign.modes_of_play || [])
    .map((k: string) => MODES_OF_PLAY[k as keyof typeof MODES_OF_PLAY])
    .filter(Boolean)

  const context = `
CAMPAIGN: ${campaign.name} (${campaign.system}), session ${campaign.session_number}

HOUSE RULES:
${campaign.house_rules?.trim() || '(none set)'}

ACTIVE MODES OF PLAY:
${modesActive.length ? modesActive.join('\n') : '(none active -- play it straight, RAW)'}

GM STYLE PREFERENCES (set by the campaign's creator, follow these):
Tone: ${GM_TONE[campaign.ai_gm_tone as keyof typeof GM_TONE] || GM_TONE.balanced}
Rules style: ${GM_RULES_STYLE[campaign.ai_gm_rules_style as keyof typeof GM_RULES_STYLE] || GM_RULES_STYLE.guided}
Lethality: ${lethalityLabel(campaign.ai_gm_lethality)}
Autonomy: ${GM_AUTONOMY[campaign.ai_gm_autonomy as keyof typeof GM_AUTONOMY] || GM_AUTONOMY.ask_major}

PARTY (refer to these by name with resolve_dying_turn/resolve_stabilize_check; "zone" is where each stands relative to the action -- stabilizing requires the healer's target to be at Close range):
${currentParty.map((c) => `- ${c.name}, ${c.ancestry} ${c.class} (lvl ${c.level}), ${c.hp}/${c.max_hp} hp, ac ${c.ac}, zone ${c.zone || 'near'}${c.status !== 'alive' ? `, STATUS: ${c.status.toUpperCase()}${c.status === 'dying' ? ` (death timer: ${c.death_timer ?? '?'} round${c.death_timer === 1 ? '' : 's'} left)` : ''}` : ''}`).join('\n') || '(no characters yet)'}

KNOWN NPCs:
${(npcs || []).map((n) => {
  const secret = npcSecretById.get(n.id)
  return `- ${n.name} (${n.ancestry || '?'}, ${n.role || '?'}, ${n.location || '?'}) -- ${n.status}, attitude: ${n.attitude || 'unknown'}${secret?.notes ? `. GM notes: ${secret.notes}` : ''}`
}).join('\n') || '(none logged yet)'}

KNOWN FACTIONS:
${(factions || []).map((f) => {
  const secret = factionSecretById.get(f.id)
  return `- ${f.name} (${f.type || '?'}), led by ${f.leader || 'unknown'}, based at ${f.territory || 'unknown'} -- disposition: ${f.disposition || 'unknown'}${f.status_clock ? `, status: ${f.status_clock}` : ''}${secret?.goal ? `. Secret goal: ${secret.goal}` : ''}${secret?.notes ? `. GM notes: ${secret.notes}` : ''}`
}).join('\n') || '(none logged yet)'}

CURRENT ENCOUNTER (monsters/combatants on the board right now -- refer to these by name with damage_monster/remove_monster; empty means no active encounter):
${currentMonsters.length ? currentMonsters.map((m) => `- ${m.name}: ${m.hp}/${m.max_hp} hp, ac ${m.ac}, dex mod ${m.dex_mod >= 0 ? '+' : ''}${m.dex_mod}, zone ${m.zone}${m.hidden ? ' (hidden from the party)' : ''}`).join('\n') : '(none)'}

TRANSCRIPT:
${transcriptText}
`.trim()

  const tools = [
    {
      functionDeclarations: [
        {
          name: 'roll_dice',
          description:
            "Roll real dice for any GM-side check, attack, damage, or random lookup. Never narrate a roll's outcome without calling this first. If you already know you'll need more than one roll for this beat, call this multiple times in the same turn rather than one at a time.",
          parameters: {
            type: 'OBJECT',
            properties: {
              notation: { type: 'STRING', description: 'Dice notation, e.g. "1d20+3", "2d6".' },
              mode: { type: 'STRING', enum: ['flat', 'advantage', 'disadvantage'], description: 'Only meaningful for a lone d20 check.' },
              reason: { type: 'STRING', description: 'What this roll is for, e.g. "goblin attack vs Bjorn".' },
              roller_name: { type: 'STRING', description: 'Who/what is rolling, e.g. "Goblin Scout".' },
            },
            required: ['notation', 'reason', 'roller_name'],
          },
        },
        {
          name: 'spawn_monster',
          description:
            "Add a monster or other mechanical combatant (something with real HP/AC that can be attacked or can attack) to the current encounter -- it immediately shows up on the party's map and the GM dashboard. Narrate its entrance in your response text as usual; this is what makes it a real, trackable thing at the table rather than just prose.",
          parameters: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING', description: 'Display name, e.g. "Goblin Scout", or "Goblin Scout 2" if one by that name already exists in the CURRENT ENCOUNTER list.' },
              ac: { type: 'NUMBER', description: 'Armor Class.' },
              hp: { type: 'NUMBER', description: 'Starting and maximum hit points.' },
              dex_mod: { type: 'NUMBER', description: 'DEX modifier. Defaults to 0 if omitted.' },
              zone: { type: 'STRING', enum: ['close', 'near', 'far'], description: 'Where it starts relative to the party. Defaults to "near".' },
              hidden: { type: 'BOOLEAN', description: "True if the party hasn't spotted it yet (an ambush, something lurking unseen) -- it stays off their map until revealed. Defaults to false." },
            },
            required: ['name', 'ac', 'hp'],
          },
        },
        {
          name: 'damage_monster',
          description:
            "Change a monster's current HP -- positive amount damages it, negative amount heals it (clamped between 0 and its max HP). Use this for every hit that actually lands, after rolling the damage with roll_dice -- never just narrate a monster taking damage without updating its real HP here too.",
          parameters: {
            type: 'OBJECT',
            properties: {
              monster_name: { type: 'STRING', description: 'The exact name as it appears in the CURRENT ENCOUNTER list.' },
              amount: { type: 'NUMBER', description: 'Positive to damage, negative to heal.' },
            },
            required: ['monster_name', 'amount'],
          },
        },
        {
          name: 'remove_monster',
          description:
            "Remove a monster from the encounter entirely -- it died, fled the scene for good, or is otherwise fully resolved. Don't use this for a monster that's merely unconscious or might still matter later this scene; only when it's truly gone.",
          parameters: {
            type: 'OBJECT',
            properties: {
              monster_name: { type: 'STRING', description: 'The exact name as it appears in the CURRENT ENCOUNTER list.' },
            },
            required: ['monster_name'],
          },
        },
        {
          name: 'resolve_dying_turn',
          description:
            "Roll a death check for a character shown as STATUS: DYING in the PARTY list -- call this on their turn every round they remain dying. A natural 20 claws them back to 1 HP; otherwise their death timer ticks down, and hitting 0 kills them for good. This IS the roll -- don't also call roll_dice for it.",
          parameters: {
            type: 'OBJECT',
            properties: {
              character_name: { type: 'STRING', description: 'The exact name as it appears in the PARTY list.' },
            },
            required: ['character_name'],
          },
        },
        {
          name: 'resolve_stabilize_check',
          description:
            "Attempt to stabilize a dying character. The healer must be at the dying character's side, and the target must be at Close range (check the PARTY list's zone) -- if they aren't, narrate closing the distance first instead of calling this. Success sets the target to stable (safe from further death checks, though still unconscious). This IS the roll -- don't also call roll_dice for it.",
          parameters: {
            type: 'OBJECT',
            properties: {
              healer_name: { type: 'STRING', description: 'Who is attempting to stabilize them (a party member or NPC name).' },
              target_name: { type: 'STRING', description: 'The exact name of the dying character, as it appears in the PARTY list.' },
              int_notation: { type: 'STRING', description: 'INT check notation, e.g. "1d20+2" to add a modifier. Defaults to "1d20".' },
            },
            required: ['healer_name', 'target_name'],
          },
        },
        {
          name: 'resolve_morale_check',
          description:
            "Roll a morale check for a group of monsters or NPCs (not player characters) -- call this when they've taken heavy losses, lost their leader, or otherwise have real reason to break rather than fight on. Success means they hold; failure means they break and flee. This IS the roll -- don't also call roll_dice for it.",
          parameters: {
            type: 'OBJECT',
            properties: {
              group_label: { type: 'STRING', description: 'Who is checking morale, e.g. "the goblin raiders".' },
              wis_notation: { type: 'STRING', description: 'WIS check notation, e.g. "1d20+1" to add a modifier. Defaults to "1d20".' },
            },
            required: ['group_label'],
          },
        },
      ],
    },
  ]

  const contents: Array<Record<string, unknown>> = [{ role: 'user', parts: [{ text: context }] }]

  // Free-tier Gemini caps requests per minute, and a single busy turn
  // (several tool-call rounds in a row) can burn through that budget on
  // its own. Google's 429 body includes its own suggested wait (e.g.
  // "Please retry in 48.5s") -- honor that instead of guessing, retry
  // once, and only then give up with a message that tells the player
  // what actually happened instead of a raw API error dump.
  const callGemini = async () => {
    let lastErrText = ''
    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
      const resp = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: {
          'x-goog-api-key': geminiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: PERSONA }] },
          contents,
          tools,
          generationConfig: { maxOutputTokens: 1500 },
        }),
      })
      if (resp.ok) return resp.json()

      const errText = await resp.text()
      lastErrText = errText

      if (resp.status === 429 && attempt < GEMINI_MAX_RETRIES) {
        const match = /retry in (\d+(?:\.\d+)?)s/i.exec(errText)
        const waitMs = match ? Math.ceil(parseFloat(match[1]) * 1000) + 500 : (attempt + 1) * 3000
        await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 25000)))
        continue
      }

      if (resp.status === 429) {
        throw new Error(
          "Gemini's free-tier rate limit is maxed out right now (busy turns with lots of rolls can do this). Wait about a minute, then hit Continue again."
        )
      }
      throw new Error(`Gemini API error (${resp.status}): ${errText.slice(0, 500)}`)
    }
    throw new Error(`Gemini API error: ${lastErrText.slice(0, 500)}`)
  }

  let finalText = ''
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await callGemini()
      const candidate = result.candidates?.[0]
      if (!candidate) {
        const blockReason = result.promptFeedback?.blockReason
        throw new Error(blockReason ? `Gemini blocked the response (${blockReason}).` : 'Gemini returned no response.')
      }

      const parts = candidate.content?.parts || []
      contents.push({ role: 'model', parts })

      const functionCalls = parts.filter((p: Record<string, unknown>) => p.functionCall)
      if (functionCalls.length === 0) {
        finalText = parts
          .filter((p: Record<string, unknown>) => typeof p.text === 'string')
          .map((p: { text: string }) => p.text)
          .join('\n')
          .trim()
        break
      }

      const functionResponseParts = []
      for (const p of functionCalls) {
        const call = p.functionCall as { name: string; args: Record<string, unknown> }
        try {
          let responseContent: string

          if (call.name === 'roll_dice') {
            const { notation, mode, reason, roller_name } = call.args as {
              notation: string
              mode?: string
              reason: string
              roller_name: string
            }
            const roll = rollNotation(notation, mode || 'flat')
            const { data: diceRow } = await writer
              .from('dice_rolls')
              .insert({
                campaign_id: campaignId,
                roller_name: roller_name,
                notation,
                mode: mode || 'flat',
                reason,
                breakdown: roll.breakdown,
                total: roll.total,
                raw_d20: roll.rawD20,
                is_crit: roll.isCrit,
                is_fumble: roll.isFumble,
              })
              .select()
              .single()

            await writer.from('scene_log').insert({
              campaign_id: campaignId,
              type: 'roll',
              sender_name: roller_name,
              text: `rolled ${notation}${mode && mode !== 'flat' ? ` (${mode})` : ''}: ${roll.total}${roll.isCrit ? ' — CRITICAL!' : roll.isFumble ? ' — fumble!' : ''} — ${reason}`,
              roll_source: 'app',
              dice_roll_id: diceRow?.id,
            })

            responseContent = `Rolled ${notation}${mode && mode !== 'flat' ? ` with ${mode}` : ''}: total ${roll.total} (${roll.breakdown})${roll.isCrit ? ' -- CRITICAL' : ''}${roll.isFumble ? ' -- FUMBLE' : ''}.`
          } else if (call.name === 'spawn_monster') {
            const { name, ac, hp, dex_mod, zone, hidden } = call.args as {
              name: string
              ac: number
              hp: number
              dex_mod?: number
              zone?: string
              hidden?: boolean
            }
            const safeHp = Math.max(1, Math.round(hp))
            const safeZone = ['close', 'near', 'far'].includes(zone || '') ? (zone as string) : 'near'
            const { data: spawned, error: spawnError } = await writer
              .from('encounter_monsters')
              .insert({
                campaign_id: campaignId,
                name,
                ac: Math.round(ac),
                hp: safeHp,
                max_hp: safeHp,
                dex_mod: Math.round(dex_mod || 0),
                zone: safeZone,
                hidden: Boolean(hidden),
                hp_visible: false,
              })
              .select('id, name, ac, hp, max_hp, dex_mod, zone, hidden')
              .single()
            if (spawnError || !spawned) throw new Error(spawnError?.message || 'Could not spawn monster.')
            currentMonsters.push(spawned)
            responseContent = `Spawned ${spawned.name}: ${spawned.hp}/${spawned.max_hp} hp, ac ${spawned.ac}, zone ${spawned.zone}${spawned.hidden ? ' (hidden from the party)' : ''}.`
          } else if (call.name === 'damage_monster') {
            const { monster_name, amount } = call.args as { monster_name: string; amount: number }
            const monster = currentMonsters.find((m) => m.name.toLowerCase() === String(monster_name).toLowerCase())
            if (!monster) throw new Error(`No monster named "${monster_name}" in the current encounter. Check the CURRENT ENCOUNTER list, or spawn_monster first.`)
            const nextHp = Math.max(0, Math.min(monster.max_hp, monster.hp - Math.round(amount)))
            const { error: dmgError } = await writer.from('encounter_monsters').update({ hp: nextHp }).eq('id', monster.id)
            if (dmgError) throw new Error(dmgError.message)
            monster.hp = nextHp
            responseContent = `${monster.name} is now at ${nextHp}/${monster.max_hp} hp${nextHp === 0 ? " -- down, but still on the board until you remove_monster if it's truly dead or gone" : ''}.`
          } else if (call.name === 'remove_monster') {
            const { monster_name } = call.args as { monster_name: string }
            const idx = currentMonsters.findIndex((m) => m.name.toLowerCase() === String(monster_name).toLowerCase())
            if (idx === -1) throw new Error(`No monster named "${monster_name}" in the current encounter.`)
            const monster = currentMonsters[idx]
            const { error: removeError } = await writer.from('encounter_monsters').delete().eq('id', monster.id)
            if (removeError) throw new Error(removeError.message)
            currentMonsters.splice(idx, 1)
            responseContent = `${monster.name} removed from the encounter.`
          } else if (call.name === 'resolve_dying_turn') {
            const { character_name } = call.args as { character_name: string }
            const target = currentParty.find((c) => c.name.toLowerCase() === String(character_name).toLowerCase())
            if (!target) throw new Error(`No character named "${character_name}" in the party. Check the PARTY list.`)
            const { data: dyingResult, error: dyingError } = await writer.rpc('resolve_dying_turn', {
              p_campaign_id: campaignId,
              p_character_id: target.id,
            })
            if (dyingError || !dyingResult) throw new Error(dyingError?.message || 'Could not resolve the death check.')
            target.status = dyingResult.status
            target.death_timer = dyingResult.death_timer
            responseContent = dyingResult.nat20
              ? `${target.name} rolled a natural 20 on their death check and claws back to consciousness with 1 HP!`
              : dyingResult.status === 'dead'
              ? `${target.name}'s death timer ran out -- they have perished.`
              : `${target.name} is still dying. Death timer: ${dyingResult.death_timer} round(s) remaining.`
          } else if (call.name === 'resolve_stabilize_check') {
            const { healer_name, target_name, int_notation } = call.args as {
              healer_name: string
              target_name: string
              int_notation?: string
            }
            const target = currentParty.find((c) => c.name.toLowerCase() === String(target_name).toLowerCase())
            if (!target) throw new Error(`No character named "${target_name}" in the party. Check the PARTY list.`)
            const { data: stabilizeResult, error: stabilizeError } = await writer.rpc('resolve_stabilize_check', {
              p_campaign_id: campaignId,
              p_healer_name: healer_name,
              p_target_character_id: target.id,
              p_int_notation: int_notation || '1d20',
            })
            if (stabilizeError || !stabilizeResult) throw new Error(stabilizeError?.message || 'Could not resolve the stabilize check.')
            target.status = stabilizeResult.target_status
            if (stabilizeResult.target_status === 'stable') target.death_timer = null
            responseContent = `${healer_name} attempts to stabilize ${target.name}: total ${stabilizeResult.total} vs DC 15 -- ${stabilizeResult.success ? `success, ${target.name} is now stable.` : 'failure.'}`
          } else if (call.name === 'resolve_morale_check') {
            const { group_label, wis_notation } = call.args as { group_label: string; wis_notation?: string }
            const { data: moraleResult, error: moraleError } = await writer.rpc('resolve_morale_check', {
              p_campaign_id: campaignId,
              p_group_label: group_label,
              p_wis_notation: wis_notation || '1d20',
            })
            if (moraleError || !moraleResult) throw new Error(moraleError?.message || 'Could not resolve the morale check.')
            responseContent = `${group_label} morale check: total ${moraleResult.total} vs DC 15 -- ${moraleResult.success ? 'holds.' : 'breaks and flees!'}`
          } else {
            throw new Error(`Unknown tool "${call.name}".`)
          }

          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              response: { name: call.name, content: responseContent },
            },
          })
        } catch (e) {
          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              response: { name: call.name, content: `Error: ${e instanceof Error ? e.message : 'tool call failed'}` },
            },
          })
        }
      }
      contents.push({ role: 'function', parts: functionResponseParts })
    }
  } catch (e) {
    await releaseClaim()
    return corsResponse({ error: e instanceof Error ? e.message : 'AI GM call failed.' }, 500)
  }

  if (!finalText) {
    await releaseClaim()
    return corsResponse({ error: 'The GM used too many tool calls without wrapping up. Try Continue again.' }, 500)
  }

  const { data: completed, error: completeError } = await writer.rpc('complete_ai_gm_turn', {
    p_campaign_id: campaignId,
    p_claim_token: claimToken,
    p_sender_name: `${campaign.name} — AI GM`,
    p_text: finalText,
  })
  if (completeError || !completed) {
    await releaseClaim()
    return corsResponse({ error: completeError?.message || 'The AI GM turn lease expired before completion.' }, 500)
  }

  return corsResponse({ success: true })
})
