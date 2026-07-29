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

  // Idempotency guard: the client auto-triggers a turn after a debounce
  // window of silence, and every connected client independently starts
  // its own timer -- so near-simultaneous auto-triggers (or a stray
  // double-click on Continue) are expected, not a bug. If the AI has
  // already answered everything currently in the transcript, no-op
  // instead of spending a second Gemini call and posting a duplicate turn.
  if (transcript.length && transcript[transcript.length - 1].type === 'ai_gm') {
    return corsResponse({ success: true, skipped: true })
  }

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

          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              response: {
                name: call.name,
                content: `Rolled ${notation}${mode && mode !== 'flat' ? ` with ${mode}` : ''}: total ${roll.total} (${roll.breakdown})${roll.isCrit ? ' -- CRITICAL' : ''}${roll.isFumble ? ' -- FUMBLE' : ''}.`,
              },
            },
          })
        } catch (e) {
          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              response: { name: call.name, content: `Error: ${e instanceof Error ? e.message : 'roll failed'}` },
            },
          })
        }
      }
      contents.push({ role: 'function', parts: functionResponseParts })
    }
  } catch (e) {
    return corsResponse({ error: e instanceof Error ? e.message : 'AI GM call failed.' }, 500)
  }

  if (!finalText) {
    return corsResponse({ error: 'The GM used too many tool calls without wrapping up. Try Continue again.' }, 500)
  }

  const { error: insertError } = await writer.from('scene_log').insert({
    campaign_id: campaignId,
    type: 'ai_gm',
    sender_name: `${campaign.name} — AI GM`,
    text: finalText,
  })
  if (insertError) return corsResponse({ error: insertError.message }, 500)

  return corsResponse({ success: true })
})
