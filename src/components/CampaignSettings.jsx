import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Save } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

// Paraphrased, generic descriptions of Shadowdark's optional Modes of
// Play toggles -- not the rulebook's own wording, same approach used
// throughout CharacterBuilder to avoid reproducing The Arcane Library's
// copyrighted text.
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

// House rules + Modes of Play + privacy, shared by the whole table. Only
// the GM can edit any of it; everyone else gets a read-only view -- same
// member-read / gm-write split the campaigns row already has for the map
// and other settings, so no new RLS was needed for house rules/modes.
// Privacy (public/private + password) goes through dedicated RPCs instead
// of a plain column update -- see 008_campaign_privacy.sql -- since the
// password has to be hashed server-side and never round-tripped as
// plaintext through the client.
export default function CampaignSettings({ campaignId, session, campaignName = 'The sunken keep', onBack }) {
  const user = session?.user
  const [isGm, setIsGm] = useState(false)
  const [houseRules, setHouseRules] = useState('')
  const [modes, setModes] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Mirrors isGm for the realtime handler below, which is set up once per
  // (campaignId, user) and would otherwise close over a stale isGm=false.
  const isGmRef = useRef(false)

  const [joinCode, setJoinCode] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [privacyPassword, setPrivacyPassword] = useState('')
  const [privacySaving, setPrivacySaving] = useState(false)
  const [privacyError, setPrivacyError] = useState(null)
  const [privacySaved, setPrivacySaved] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false

    supabase
      .from('campaigns')
      .select('house_rules, modes_of_play, join_code, is_public')
      .eq('id', campaignId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setHouseRules(data?.house_rules || '')
        setModes(data?.modes_of_play || [])
        setJoinCode(data?.join_code || '')
        setIsPublic(data?.is_public ?? true)
        setLoading(false)
      })

    if (user) {
      supabase
        .from('campaign_members')
        .select('role')
        .eq('campaign_id', campaignId)
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (cancelled) return
          const gm = data?.role === 'gm'
          isGmRef.current = gm
          setIsGm(gm)
        })
    }

    // Only apply incoming realtime updates for non-GM viewers. The
    // campaigns row changes constantly for unrelated reasons (party
    // marker moves, map uploads, grid resizes), and every one of those
    // broadcasts the last-*saved* house_rules/modes_of_play/is_public
    // alongside it -- applying that here mid-edit would silently revert
    // the GM's unsaved checkbox toggles. Players have nothing to lose by
    // staying live.
    const channel = supabase
      .channel(`campaign-settings-${campaignId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${campaignId}` },
        (payload) => {
          if (isGmRef.current) return
          setHouseRules(payload.new.house_rules || '')
          setModes(payload.new.modes_of_play || [])
          setJoinCode(payload.new.join_code || '')
          setIsPublic(payload.new.is_public ?? true)
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [campaignId, user])

  const toggleMode = (key) => {
    setModes((m) => (m.includes(key) ? m.filter((k) => k !== key) : [...m, key]))
  }

  const save = async () => {
    setSaving(true)
    await supabase.from('campaigns').update({ house_rules: houseRules, modes_of_play: modes }).eq('id', campaignId)
    setSaving(false)
  }

  const copyJoinCode = () => {
    navigator.clipboard?.writeText(joinCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const savePrivacy = async () => {
    setPrivacySaving(true)
    setPrivacyError(null)
    setPrivacySaved(false)
    const { error } = await supabase.rpc('set_campaign_privacy', {
      p_campaign_id: campaignId,
      p_is_public: isPublic,
      p_password: privacyPassword.trim() || null,
    })
    setPrivacySaving(false)
    if (error) {
      setPrivacyError(error.message)
      return
    }
    setPrivacyPassword('')
    setPrivacySaved(true)
  }

  if (loading) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <p className="text-xs text-ink-faint">Loading campaign settings…</p>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      {onBack && (
        <button onClick={onBack} className="text-xs text-ink-dim hover:text-ink flex items-center gap-1 mb-3">
          <ArrowLeft size={13} /> Back
        </button>
      )}

      <h1 className="text-ink text-lg font-medium mb-1">{campaignName}</h1>
      <p className="text-xs text-ink-dim mb-4">Campaign settings</p>

      {isGm && (
        <div className="bg-panel rounded-lg p-4 mb-4">
          <p className="text-xs text-ink-dim mb-2">Privacy</p>

          <div className="flex items-center justify-between mb-3 text-xs">
            <span className="text-ink-dim">Join code</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-ink tracking-wide">{joinCode}</span>
              <button
                onClick={copyJoinCode}
                className="text-[11px] px-2 py-0.5 border border-line rounded text-ink-dim hover:bg-panel2"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="flex gap-2 mb-2.5">
            <button
              onClick={() => setIsPublic(true)}
              className={`flex-1 text-xs py-1.5 rounded-md border ${
                isPublic ? 'bg-panel2 border-primary text-ink' : 'border-line text-ink-dim'
              }`}
            >
              Public
            </button>
            <button
              onClick={() => setIsPublic(false)}
              className={`flex-1 text-xs py-1.5 rounded-md border ${
                !isPublic ? 'bg-panel2 border-primary text-ink' : 'border-line text-ink-dim'
              }`}
            >
              Private
            </button>
          </div>
          <p className="text-[11px] text-ink-faint mb-2.5">
            {isPublic
              ? 'Anyone signed in can see and join this campaign from the lobby.'
              : 'Hidden from the public list -- joinable only with the code and password below.'}
          </p>

          {!isPublic && (
            <input
              type="password"
              value={privacyPassword}
              onChange={(e) => setPrivacyPassword(e.target.value)}
              placeholder="Set a new password (leave blank to keep the current one)"
              className="w-full text-xs bg-bg border border-line rounded-md px-2 py-1.5 text-ink mb-2.5"
            />
          )}

          {privacyError && <p className="text-xs text-danger-text mb-2">{privacyError}</p>}

          <button
            onClick={savePrivacy}
            disabled={privacySaving}
            className="text-xs border border-line rounded-md px-3 py-1.5 text-ink hover:bg-panel2 disabled:opacity-50"
          >
            {privacySaving ? 'Saving...' : privacySaved ? 'Saved' : 'Save privacy settings'}
          </button>
        </div>
      )}

      <div className="bg-panel rounded-lg p-4 mb-4">
        <p className="text-xs text-ink-dim mb-2">Modes of play</p>
        <div className="flex flex-col gap-1.5">
          {MODES_OF_PLAY.map((mode) => (
            <label key={mode.key} className="flex items-start gap-2 text-xs">
              {isGm ? (
                <input
                  type="checkbox"
                  checked={modes.includes(mode.key)}
                  onChange={() => toggleMode(mode.key)}
                  className="mt-0.5"
                />
              ) : (
                <span
                  className={`w-2 h-2 rounded-full inline-block mt-1 shrink-0 ${
                    modes.includes(mode.key) ? 'bg-primary' : 'bg-panel2'
                  }`}
                />
              )}
              <span>
                <span className={`font-medium ${modes.includes(mode.key) ? 'text-ink' : 'text-ink-faint'}`}>{mode.label}</span>
                <span className="text-ink-faint"> -- {mode.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="bg-panel rounded-lg p-4 mb-4">
        <p className="text-xs text-ink-dim mb-2">House rules</p>
        {isGm ? (
          <textarea
            value={houseRules}
            onChange={(e) => setHouseRules(e.target.value)}
            placeholder="Anything the table has agreed on beyond the core rules..."
            rows={6}
            className="w-full text-sm bg-bg border border-line rounded-md px-3 py-2 text-ink resize-y"
          />
        ) : houseRules ? (
          <p className="text-sm text-ink-dim whitespace-pre-wrap">{houseRules}</p>
        ) : (
          <p className="text-xs text-ink-faint">No house rules set yet.</p>
        )}
      </div>

      {isGm && (
        <button
          onClick={save}
          disabled={saving}
          className="text-xs border border-line rounded-md px-3 py-1.5 flex items-center gap-1.5 text-ink hover:bg-panel2 disabled:opacity-50"
        >
          <Save size={13} /> {saving ? 'Saving...' : 'Save settings'}
        </button>
      )}
    </div>
  )
}
