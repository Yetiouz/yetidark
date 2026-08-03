import { useState } from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Crown, Bot, X as XIcon } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import ToggleSwitch from './ui/ToggleSwitch.jsx'
import Footer from './ui/Footer.jsx'
import Stepper from './ui/Stepper.jsx'

function randomJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I ambiguity
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return `${code.slice(0, 3)}-${code.slice(3)}`
}

// Paraphrased, generic descriptions -- same approach as CampaignSettings.jsx
// -- not the rulebook's own wording.
const MODES_OF_PLAY = [
  { key: 'hunter', label: 'Hunter', description: 'Resources run out faster -- rations, torches, and ammo are scarcer.' },
  { key: 'momentum', label: 'Momentum', description: 'Keeps the pace brisk -- shorter rests, less downtime between scenes.' },
  { key: 'pulp', label: 'Pulp', description: 'Leans heroic and forgiving -- characters shrug off death more easily.' },
  { key: 'blitz', label: 'Blitz', description: 'Combat moves fast -- streamlined turns, less bookkeeping mid-fight.' },
  { key: 'chaos', label: 'Chaos', description: 'Embraces the unpredictable -- random tables and wild swings come up more.' },
  { key: 'deadly', label: 'Deadly', description: 'Danger is real -- fights are riskier and death comes easier.' },
  { key: 'fatality', label: 'Fatality', description: 'Death is final -- no fudging, no walking it back.' },
  { key: 'grinder', label: 'Grinder', description: 'Attrition matters more over a long dungeon crawl.' },
]

const TONES = [
  { key: 'grim', label: 'Grim', description: 'Danger feels constant, victories are hard-won.' },
  { key: 'balanced', label: 'Balanced', description: 'Danger is real, with room for humor and dramatic moments.' },
  { key: 'heroic', label: 'Heroic', description: 'Leans pulpy and cinematic -- the party is the main event.' },
]
const RULES_STYLES = [
  { key: 'strict', label: 'Strict', description: 'Rules as written, minimal interpretation.' },
  { key: 'flexible', label: 'Flexible', description: 'Favors fun and pace over exact wording.' },
  { key: 'guided', label: 'Guided', description: 'Explains unfamiliar rules and asks before major rulings.' },
]
const AUTONOMY = [
  { key: 'ask_major', label: 'Ask before major consequences', description: 'Checks in before anything that changes the story in a big way.' },
  { key: 'ask_every', label: 'Ask before every resolution', description: 'Confirms with you before resolving most checks and actions.' },
  { key: 'auto', label: 'Run automatically', description: "Keeps the scene moving without pausing for confirmation." },
]

const STEPS = ['Basics', 'Game Master', 'Rules', 'Review']

// Campaign creation, rebuilt as a step-by-step wizard matching the
// character-creation wizard's shell (same stepper/sidebar/nav pattern) --
// replaces the small inline expandable panel that used to live directly in
// Lobby.jsx. Basics/access reuse the existing campaigns columns and
// set_campaign_privacy() RPC exactly as before; the Game Master step's AI
// preferences (tone/rules style/lethality/autonomy) are new columns added
// alongside this chunk -- they're captured and stored here but the
// ai-gm-turn edge function doesn't read them yet, that's a follow-up.
// "Adventure" (the mockup's 4th step) isn't built -- there's no adventure
// catalog in the data model yet, so it's left out of this pass rather than
// faked.
export default function CampaignBuilder({ session, onComplete, onCancel }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [startingLevel, setStartingLevel] = useState(1)
  const [minPlayers, setMinPlayers] = useState(1)
  const [maxPlayers, setMaxPlayers] = useState(5)
  const [isPublic, setIsPublic] = useState(true)
  const [password, setPassword] = useState('')
  const [gmType, setGmType] = useState('ai')
  const [aiTone, setAiTone] = useState('balanced')
  const [aiRulesStyle, setAiRulesStyle] = useState('guided')
  const [aiLethality, setAiLethality] = useState(70)
  const [aiAutonomy, setAiAutonomy] = useState('ask_major')
  const [houseRules, setHouseRules] = useState('')
  const [modes, setModes] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const toggleMode = (key) => {
    setModes((m) => (m.includes(key) ? m.filter((k) => k !== key) : [...m, key]))
  }

  // Clear any stale RPC error when navigating steps -- without this, a failed
  // create() attempt (e.g. missing password on the Private-access path) leaves
  // its error banner visible on Review even after the user goes back and fixes
  // the underlying field, which reads as if the fix didn't take.
  const goNext = () => { setError(null); setStep((s) => Math.min(STEPS.length - 1, s + 1)) }
  const goBack = () => { setError(null); setStep((s) => Math.max(0, s - 1)) }

  const create = async () => {
    if (!session?.user) return

    // Fail fast, before writing anything: set_campaign_privacy rejects an
    // empty password for a brand-new private campaign, and by the time that
    // RPC runs the campaigns + campaign_members rows below are already
    // committed with no way for the client to roll them back (no DELETE
    // policy on campaigns) -- so a failure there previously left a live,
    // public-by-default orphan campaign behind instead of the private one
    // the user asked for. Catching it here avoids that entirely for the
    // common case.
    if (!isPublic && !password.trim()) {
      setError('A password is required to make this campaign private.')
      return
    }

    setSaving(true)
    setError(null)

    // Generated client-side, same reasoning as the old Lobby.jsx flow: the
    // insert's own RETURNING can't pass the is_campaign_member() SELECT
    // policy until the on_campaign_created trigger's membership row exists,
    // so there's nothing to safely .select() back -- we already know every
    // field we just wrote.
    const id = crypto.randomUUID()
    const finalName = name.trim() || 'Untitled campaign'

    const { error: createError } = await supabase.from('campaigns').insert({
      id,
      name: finalName,
      system: 'Shadowdark',
      gm_type: gmType,
      // Decision Queue #30 (resolved 2026-08-03): the campaign creator holds
      // the GM seat regardless of gm_type -- an AI-GM campaign's human
      // organizer still owns the table (design spec Section 4.17/4.22), the
      // AI narrates through the ai-gm-turn edge function's own service-role
      // access, not through this row. Always the creator now, not just for
      // gm_type='human'.
      gm_user_id: session.user.id,
      join_code: randomJoinCode(),
      starting_level: startingLevel,
      min_players: minPlayers,
      max_players: maxPlayers,
      house_rules: houseRules,
      modes_of_play: modes,
      ai_gm_tone: gmType === 'ai' ? aiTone : null,
      ai_gm_rules_style: gmType === 'ai' ? aiRulesStyle : null,
      ai_gm_lethality: gmType === 'ai' ? aiLethality : null,
      ai_gm_autonomy: gmType === 'ai' ? aiAutonomy : null,
    })

    if (createError) {
      setSaving(false)
      setError(createError.message)
      return
    }

    // The trigger already adds the creator as 'gm' (Decision Queue #30) --
    // this just makes sure it's there without erroring if it is (same as
    // before).
    await supabase
      .from('campaign_members')
      .upsert(
        { campaign_id: id, user_id: session.user.id, role: 'gm' },
        { onConflict: 'campaign_id,user_id', ignoreDuplicates: true }
      )

    if (!isPublic) {
      const { error: privacyError } = await supabase.rpc('set_campaign_privacy', {
        p_campaign_id: id,
        p_is_public: false,
        p_password: password || null,
      })
      if (privacyError) {
        setSaving(false)
        setError(privacyError.message)
        return
      }
    }

    setSaving(false)
    onComplete && onComplete({ id, name: finalName })
  }

  const stepper = (
    <Stepper
      steps={STEPS.map((label, i) => ({ label, state: i < step ? 'done' : i === step ? 'active' : 'upcoming' }))}
      onStepClick={setStep}
    />
  )

  const sidebar = (
    <div className="bg-panel rounded-lg p-4 h-fit md:sticky md:top-6">
      <p className="text-xs text-ink-dim mb-1">Campaign preview</p>
      <p className="text-ink text-base font-medium mb-3">{name.trim() || 'Untitled campaign'}</p>
      <div className="flex flex-col gap-2 text-[11px] pb-3 mb-3 border-b border-line-soft">
        <div className="flex justify-between">
          <span className="text-ink-faint">System</span>
          <span className="text-ink">Shadowdark</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-faint">Game Master</span>
          <span className="text-ink">{gmType === 'ai' ? 'AI GM' : 'Human GM'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-faint">Access</span>
          <span className="text-ink">{isPublic ? 'Public' : 'Private'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-faint">Starting level</span>
          <span className="text-ink">{startingLevel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-faint">Players</span>
          <span className="text-ink">{minPlayers}–{maxPlayers}</span>
        </div>
      </div>
      <p className="text-[11px] text-ink-faint">Nothing is created until you finish the review step.</p>
    </div>
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="shrink-0 border-b border-line-soft px-6 py-4 flex items-center justify-between gap-4">
        <h1 className="text-ink font-medium shrink-0">Create a campaign</h1>
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
                <h2 className="text-ink text-sm font-medium mb-3">Basics</h2>
                <p className="text-[11px] text-ink-dim mb-1">Campaign name</p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. The Lost Citadel"
                  className="w-full bg-bg border border-line rounded-md px-3 py-2 text-sm text-ink mb-4"
                />

                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div>
                    <p className="text-[11px] text-ink-dim mb-1">Starting level</p>
                    <select
                      value={startingLevel}
                      onChange={(e) => setStartingLevel(parseInt(e.target.value, 10))}
                      className="w-full text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
                    >
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="text-[11px] text-ink-dim mb-1">Min players</p>
                    <input
                      type="number"
                      min={1}
                      value={minPlayers}
                      onChange={(e) => setMinPlayers(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] text-ink-dim mb-1">Max players</p>
                    <input
                      type="number"
                      min={minPlayers}
                      value={maxPlayers}
                      onChange={(e) => setMaxPlayers(Math.max(minPlayers, parseInt(e.target.value, 10) || minPlayers))}
                      className="w-full text-xs bg-bg border border-line rounded-md px-2 py-2 text-ink"
                    />
                  </div>
                </div>

                <p className="text-[11px] text-ink-dim mb-2">Access</p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    onClick={() => setIsPublic(true)}
                    className={`text-xs py-2 rounded-md border ${
                      isPublic ? 'bg-panel2 border-primary text-ink' : 'border-line text-ink-dim hover:bg-panel2'
                    }`}
                  >
                    Public
                  </button>
                  <button
                    onClick={() => setIsPublic(false)}
                    className={`text-xs py-2 rounded-md border ${
                      !isPublic ? 'bg-panel2 border-primary text-ink' : 'border-line text-ink-dim hover:bg-panel2'
                    }`}
                  >
                    Private
                  </button>
                </div>
                {!isPublic && (
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password to join"
                    className="w-full text-xs bg-bg border border-line rounded-md px-3 py-2 text-ink"
                  />
                )}
                <p className="text-[11px] text-ink-faint mt-2">
                  {isPublic
                    ? 'Anyone can find and request to join from the public campaign list.'
                    : 'Only people with the join code and password can join.'}
                </p>
              </div>
            )}

            {step === 1 && (
              <div>
                <h2 className="text-ink text-sm font-medium mb-1">Who will run the game?</h2>
                <p className="text-xs text-ink-faint mb-3">
                  Choose a human Game Master or let Delve run the campaign with AI.
                </p>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <button
                    onClick={() => setGmType('human')}
                    className={`text-left p-4 rounded-lg border ${
                      gmType === 'human' ? 'border-primary bg-panel2' : 'border-line hover:bg-panel2/50'
                    }`}
                  >
                    <Crown size={18} className="text-ink-dim mb-2" />
                    <p className="text-sm text-ink mb-1">Human GM</p>
                    <p className="text-[11px] text-ink-faint">A person prepares the adventure, controls the world, and makes rulings.</p>
                  </button>
                  <button
                    onClick={() => setGmType('ai')}
                    className={`text-left p-4 rounded-lg border ${
                      gmType === 'ai' ? 'border-primary bg-panel2' : 'border-line hover:bg-panel2/50'
                    }`}
                  >
                    <Bot size={18} className="text-ink-dim mb-2" />
                    <p className="text-sm text-ink mb-1">AI GM</p>
                    <p className="text-[11px] text-ink-faint">Delve narrates the world, runs encounters, and maintains campaign state.</p>
                  </button>
                </div>

                {gmType === 'ai' && (
                  <div className="border-t border-line-soft pt-3">
                    <p className="text-xs text-ink-dim mb-2">AI GM preferences</p>
                    <p className="text-[11px] text-ink-faint mb-1">Tone</p>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {TONES.map((t) => (
                        <button
                          key={t.key}
                          onClick={() => setAiTone(t.key)}
                          title={t.description}
                          className={`text-xs py-2 rounded-md border ${
                            aiTone === t.key ? 'bg-panel2 border-primary text-ink' : 'border-line text-ink-dim hover:bg-panel2'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-ink-faint mb-1">Rules style</p>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {RULES_STYLES.map((r) => (
                        <button
                          key={r.key}
                          onClick={() => setAiRulesStyle(r.key)}
                          title={r.description}
                          className={`text-xs py-2 rounded-md border ${
                            aiRulesStyle === r.key ? 'bg-panel2 border-primary text-ink' : 'border-line text-ink-dim hover:bg-panel2'
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-ink-faint mb-1">
                      Lethality &middot; {aiLethality < 34 ? 'Forgiving' : aiLethality < 67 ? 'Balanced' : 'Rules as written'}
                    </p>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={aiLethality}
                      onChange={(e) => setAiLethality(parseInt(e.target.value, 10))}
                      className="w-full mb-3"
                    />
                    <p className="text-[11px] text-ink-faint mb-1">Autonomy</p>
                    <div className="flex flex-col gap-2">
                      {AUTONOMY.map((a) => (
                        <button
                          key={a.key}
                          onClick={() => setAiAutonomy(a.key)}
                          className={`text-left text-xs py-2 px-3 rounded-md border ${
                            aiAutonomy === a.key ? 'bg-panel2 border-primary text-ink' : 'border-line text-ink-dim hover:bg-panel2'
                          }`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 className="text-ink text-sm font-medium mb-3">Rules</h2>
                <p className="text-xs text-ink-dim mb-2">Modes of play</p>
                <div className="flex flex-col gap-2 mb-4">
                  {MODES_OF_PLAY.map((mode) => (
                    <label key={mode.key} className="flex items-start gap-2 text-xs">
                      <ToggleSwitch
                        checked={modes.includes(mode.key)}
                        onChange={() => toggleMode(mode.key)}
                        label={mode.label}
                      />
                      <span>
                        <span className={`font-medium ${modes.includes(mode.key) ? 'text-ink' : 'text-ink-faint'}`}>{mode.label}</span>
                        <span className="text-ink-faint"> -- {mode.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-ink-dim mb-2">House rules (optional)</p>
                <textarea
                  value={houseRules}
                  onChange={(e) => setHouseRules(e.target.value)}
                  placeholder="Anything the table has agreed on beyond the core rules..."
                  rows={5}
                  className="w-full text-sm bg-bg border border-line rounded-md px-3 py-2 text-ink resize-y"
                />
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 className="text-ink text-sm font-medium mb-3">Review</h2>
                <div className="bg-bg rounded-md px-4 py-3 mb-3">
                  <p className="text-sm font-medium text-ink">{name.trim() || 'Untitled campaign'}</p>
                  <p className="text-[11px] text-ink-dim mt-1">
                    Shadowdark &middot; {gmType === 'ai' ? 'AI GM' : 'Human GM'} &middot; {isPublic ? 'Public' : 'Private'}
                  </p>
                  <p className="text-[11px] text-ink-dim mt-1">
                    Starting level {startingLevel} &middot; {minPlayers}–{maxPlayers} players
                  </p>
                  {gmType === 'ai' && (
                    <p className="text-[11px] text-ink-faint mt-1">
                      {TONES.find((t) => t.key === aiTone)?.label}, {RULES_STYLES.find((r) => r.key === aiRulesStyle)?.label} rules,{' '}
                      {AUTONOMY.find((a) => a.key === aiAutonomy)?.label.toLowerCase()}
                    </p>
                  )}
                  {modes.length > 0 && (
                    <p className="text-[11px] text-ink-faint mt-1">Modes: {modes.join(', ')}</p>
                  )}
                </div>
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
                className="text-sm bg-primary hover:bg-primary/90 text-ink rounded-md px-4 py-2 flex items-center gap-2"
              >
                Continue <ChevronRight size={14} />
              </button>
            ) : (
              <button
                onClick={create}
                disabled={saving}
                className="text-sm bg-primary hover:bg-primary/90 disabled:opacity-50 text-ink rounded-md px-4 py-2"
              >
                {saving ? 'Creating...' : 'Create campaign'}
              </button>
            )}
          </div>
          <div className="hidden md:block" />
        </div>
      </Footer>
    </div>
  )
}
