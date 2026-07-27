// Delve — AI GM turn (chunk 9 of the GM-brain integration).
//
// Invoked when anyone in an AI-GM campaign hits "Continue": compiles what's
// happened in the shared scene log since the AI's last turn, hands it to
// Claude along with the campaign's house rules, NPCs, factions, and party
// roster, and posts the response back into the same scene log everyone
// already reads (as a new 'ai_gm' entry -- see 011_ai_gm.sql).
//
// Runs entirely under the calling user's own JWT (passed through from the
// client's Authorization header), so every read/write here goes through
// the exact same RLS policies as the rest of the app -- no service-role
// key needed. The only secret this function needs is ANTHROPIC_API_KEY,
// added as a Supabase Edge Function secret (never handled by the app or
// sent through chat).
//
// Ported from the file-based GM system's Core GM Commitment #1: "real
// dice, always -- every GM-side check, attack, damage roll, and random-
// table lookup is rolled through dice.py, not narrated or asserted." The
// model gets a roll_dice tool instead of being trusted to just assert a
// fair outcome -- every GM-side roll it wants to make actually happens
// here, server-side, with a real RNG, and is logged to dice_rolls exactly
// like a human GM's rolls are.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-5'
const MAX_TOOL_ROUNDS = 6
const TRANSCRIPT_LIMIT = 60

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

// Condensed from GM_PERSONA.md -- the file-based system's "how the game
// gets run" doc. Dynamic per-campaign specifics (house rules, modes of
// play, NPCs, factions, party) get appended below at call time.
const PERSONA = `You are the Game Master for a Shadowdark RPG campaign, running an async text game.

CORE COMMITMENTS (non-negotiable):
1. Real dice, always. Every GM-side check, attack, damage roll, and random-table lookup goes through the roll_dice tool -- never narrate or assert an outcome you didn't actually roll. A player's own rolls for their own character belong to them; only roll for NPCs, monsters, and the environment.
2. Ground rulings in the campaign's actual house rules and context provided below, not invented rules.
3. Consequences stick. No retroactive softening of a bad outcome, including PC death, to protect the story.
4. If a table is aimless or stuck, actively nudge -- resurface a lead, frame explicit choices -- rather than leaving it fully open with no momentum (guided sandbox, not railroad).

VOICE: Grimdark with real humor -- "Dungeon Crawler Carl" register. Stakes are genuinely dark (death is permanent, monsters are horrific) but it should also be funny -- dark comedy, snark, absurd/gonzo details, theatrical flair. A funny death is still a real, permanent death.

PACING: Cinematic default. Narration is punchy and vivid, not overwritten. Travel and downtime move fast (a sentence or two). The dungeon-crawl itself -- searching, traps, puzzles, tense standoffs -- gets real detail. Combat and dramatic reveals are allowed to breathe.

NPC VOICE: Recurring NPCs, quest-givers, villains, and anyone with a real role get a distinct, memorable voice. One-off transactional NPCs (a shopkeeper selling rope) stay quick and functional.

CONTENT: No pre-set hard lines -- mature themes, cursing, dark content are fair game, fitting the grimdark tone.

FORMAT: Write your response as the GM's narration for this turn -- what happens as a result of what the party just did, in-scene, addressed to the table. Keep it tight: a few tight paragraphs, not a wall of text, unless a dramatic beat genuinely earns more room. If nothing has happened yet (this is the very first turn), open the scene with a strong hook and 2-3 plausible directions rather than waiting to be prompted.`

function corsResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Small, faithful-enough port of the same dice engine src/lib/dice.js
// already uses client-side: "NdM+K" notation, advantage/disadvantage on a
// lone d20, crit/fumble flagging on a lone d20's raw roll.
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

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) {
    return corsResponse(
      { error: "AI GM isn't set up yet -- add an ANTHROPIC_API_KEY secret in Supabase (Project Settings > Edge Functions > Secrets) to enable it." },
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

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return corsResponse({ error: 'Not signed in.' }, 401)

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, name, system, gm_type, house_rules, modes_of_play, session_number')
    .eq('id', campaignId)
    .maybeSingle()

  if (campaignError || !campaign) return corsResponse({ error: 'Campaign not found, or you are not a member.' }, 404)
  if (campaign.gm_type !== 'ai') return corsResponse({ error: 'This campaign has a human GM.' }, 400)

  const [{ data: party }, { data: npcs }, { data: factions }, { data: log }] = await Promise.all([
    supabase.from('characters').select('name, ancestry, class, level, hp, max_hp, ac').eq('campaign_id', campaignId),
    supabase.from('campaign_npcs').select('name, ancestry, role, location, attitude, status, notes').eq('campaign_id', campaignId),
    supabase.from('campaign_factions').select('name, type, leader, territory, disposition, status_clock, notes').eq('campaign_id', campaignId),
    supabase
      .from('scene_log')
      .select('id, type, sender_name, text, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(TRANSCRIPT_LIMIT),
  ])

  const transcript = (log || []).slice().reverse()
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

PARTY:
${(party || []).map((c) => `- ${c.name}, ${c.ancestry} ${c.class} (lvl ${c.level}), ${c.hp}/${c.max_hp} hp, ac ${c.ac}`).join('\n') || '(no characters yet)'}

KNOWN NPCs:
${(npcs || []).map((n) => `- ${n.name} (${n.ancestry || '?'}, ${n.role || '?'}, ${n.location || '?'}) -- ${n.status}, attitude: ${n.attitude || 'unknown'}${n.notes ? `. ${n.notes}` : ''}`).join('\n') || '(none logged yet)'}

KNOWN FACTIONS:
${(factions || []).map((f) => `- ${f.name} (${f.type || '?'}), led by ${f.leader || 'unknown'}, based at ${f.territory || 'unknown'} -- disposition: ${f.disposition || 'unknown'}${f.status_clock ? `, status: ${f.status_clock}` : ''}${f.notes ? `. ${f.notes}` : ''}`).join('\n') || '(none logged yet)'}

TRANSCRIPT:
${transcriptText}
`.trim()

  const tools = [
    {
      name: 'roll_dice',
      description:
        "Roll real dice for any GM-side check, attack, damage, or random lookup. Never narrate a roll's outcome without calling this first.",
      input_schema: {
        type: 'object',
        properties: {
          notation: { type: 'string', description: 'Dice notation, e.g. "1d20+3", "2d6".' },
          mode: { type: 'string', enum: ['flat', 'advantage', 'disadvantage'], description: 'Only meaningful for a lone d20 check.' },
          reason: { type: 'string', description: 'What this roll is for, e.g. "goblin attack vs Bjorn".' },
          roller_name: { type: 'string', description: 'Who/what is rolling, e.g. "Goblin Scout".' },
        },
        required: ['notation', 'reason', 'roller_name'],
      },
    },
  ]

  const messages: Array<Record<string, unknown>> = [{ role: 'user', content: context }]

  const callClaude = async () => {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: PERSONA,
        tools,
        messages,
      }),
    })
    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`Claude API error (${resp.status}): ${errText.slice(0, 500)}`)
    }
    return resp.json()
  }

  let finalText = ''
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await callClaude()
      messages.push({ role: 'assistant', content: result.content })

      const toolUses = (result.content || []).filter((b: { type: string }) => b.type === 'tool_use')
      if (toolUses.length === 0) {
        finalText = (result.content || [])
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text)
          .join('\n')
          .trim()
        break
      }

      const toolResults = []
      for (const tu of toolUses) {
        try {
          const { notation, mode, reason, roller_name } = tu.input as {
            notation: string
            mode?: string
            reason: string
            roller_name: string
          }
          const roll = rollNotation(notation, mode || 'flat')
          const { data: diceRow } = await supabase
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

          await supabase.from('scene_log').insert({
            campaign_id: campaignId,
            type: 'roll',
            sender_name: roller_name,
            text: `rolled ${notation}${mode && mode !== 'flat' ? ` (${mode})` : ''}: ${roll.total}${roll.isCrit ? ' — CRITICAL!' : roll.isFumble ? ' — fumble!' : ''} — ${reason}`,
            roll_source: 'app',
            dice_roll_id: diceRow?.id,
          })

          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: `Rolled ${notation}${mode && mode !== 'flat' ? ` with ${mode}` : ''}: total ${roll.total} (${roll.breakdown})${roll.isCrit ? ' -- CRITICAL' : ''}${roll.isFumble ? ' -- FUMBLE' : ''}.`,
          })
        } catch (e) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: `Error: ${e instanceof Error ? e.message : 'roll failed'}`,
            is_error: true,
          })
        }
      }
      messages.push({ role: 'user', content: toolResults })
    }
  } catch (e) {
    return corsResponse({ error: e instanceof Error ? e.message : 'AI GM call failed.' }, 500)
  }

  if (!finalText) {
    return corsResponse({ error: 'The GM used too many tool calls without wrapping up. Try Continue again.' }, 500)
  }

  const { error: insertError } = await supabase.from('scene_log').insert({
    campaign_id: campaignId,
    type: 'ai_gm',
    sender_name: `${campaign.name} — AI GM`,
    text: finalText,
  })
  if (insertError) return corsResponse({ error: insertError.message }, 500)

  return corsResponse({ success: true })
})
