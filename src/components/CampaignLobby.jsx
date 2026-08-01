import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Crown,
  Bot,
  Users,
  Key,
  Copy,
  Check,
  Settings,
  UserPlus,
  CheckCircle2,
  AlertTriangle,
  Circle,
  Rocket,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { getCampaignEntryBlockReason } from '../app/campaignEntry.js'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import Card from './ui/Card.jsx'

// Paraphrased labels for the Modes of Play chips -- same keys as
// CampaignSettings.jsx's MODES_OF_PLAY, just the short label without the
// full description (this card is a summary, not the editor).
const MODE_LABELS = {
  hunter: 'Hunter',
  momentum: 'Momentum',
  pulp: 'Pulp',
  blitz: 'Blitz',
  chaos: 'Chaos',
  deadly: 'Deadly',
  fatality: 'Fatality',
  grinder: 'Grinder',
}

const TONE_LABELS = { grim: 'Grim', balanced: 'Balanced', heroic: 'Heroic' }
const RULES_STYLE_LABELS = { strict: 'Strict', flexible: 'Flexible', guided: 'Guided' }
const AUTONOMY_LABELS = { ask_major: 'Ask before major decisions', ask_every: 'Ask before every resolution', auto: 'Runs automatically' }

// The per-campaign staging screen between "jump in from the dashboard" and
// actually entering play -- coordinates who's joined, whether everyone has
// a character, and surfaces the invite code and campaign rules before the
// group commits to starting session 1 (or rejoins a session already in
// progress). This sits between Lobby.jsx (the multi-campaign dashboard --
// despite the filename, that one is really a campaign list) and
// GameTable/GmDashboard in the flow.
export default function CampaignLobby({
  campaignId,
  session,
  onOpenCharacterSheet,
  onCreateCharacter,
  onChooseCharacter,
  onStartSession,
  onOpenSettings,
}) {
  const user = session?.user
  const [campaign, setCampaign] = useState(null)
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedInvite, setCopiedInvite] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(null)
  const myRoleRef = useRef(null)

  const load = useCallback(async () => {
    if (!campaignId) return
    setError(null)

    const [{ data: campaignRow, error: campaignError }, { data: memberRows }, { data: characterRows }] =
      await Promise.all([
        supabase.from('campaigns').select('*').eq('id', campaignId).maybeSingle(),
        supabase
          .from('campaign_members')
          .select('user_id, role, joined_at, profiles (display_name)')
          .eq('campaign_id', campaignId),
        supabase
          .from('characters')
          .select('id, owner_user_id, name, ancestry, class, level, hp, max_hp, ac')
          .eq('campaign_id', campaignId)
          .eq('is_active', true),
      ])

    if (campaignError) {
      setError(campaignError.message)
      setLoading(false)
      return
    }

    const charactersByOwner = new Map((characterRows || []).map((c) => [c.owner_user_id, c]))
    const merged = (memberRows || [])
      .map((m) => ({
        userId: m.user_id,
        role: m.role,
        joinedAt: m.joined_at,
        displayName: m.profiles?.display_name || 'Unnamed adventurer',
        character: charactersByOwner.get(m.user_id) || null,
      }))
      .sort((a, b) => {
        if (a.role === 'gm' && b.role !== 'gm') return -1
        if (b.role === 'gm' && a.role !== 'gm') return 1
        return new Date(a.joinedAt) - new Date(b.joinedAt)
      })

    setCampaign(campaignRow)
    setMembers(merged)
    myRoleRef.current = merged.find((m) => m.userId === user?.id)?.role || null
    setLoading(false)
  }, [campaignId, user])

  useEffect(() => {
    load()
  }, [load])

  // Everyone in the lobby needs to see joins, character creation, and
  // privacy/session-state changes live -- three related tables, so on any
  // change just reload the merged view rather than patching each field.
  useEffect(() => {
    if (!campaignId) return
    const channel = supabase
      .channel(`campaign-lobby-${campaignId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_members', filter: `campaign_id=eq.${campaignId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'characters', filter: `campaign_id=eq.${campaignId}` }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${campaignId}` }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [campaignId, load])

  const me = members.find((m) => m.userId === user?.id)
  const myRole = me?.role || null
  const missingCharacters = members.filter((m) => !m.character)
  const minPlayers = campaign?.min_players ?? 1
  const maxPlayers = campaign?.max_players ?? 5
  const hasMinPlayers = members.length >= minPlayers

  const checks = [
    {
      key: 'players',
      done: hasMinPlayers,
      label: 'Minimum players joined',
      detail: hasMinPlayers
        ? null
        : `Waiting for ${minPlayers - members.length} more player${minPlayers - members.length === 1 ? '' : 's'}.`,
    },
    {
      key: 'characters',
      done: missingCharacters.length === 0,
      label: 'All players have characters',
      detail:
        missingCharacters.length > 0
          ? `${missingCharacters.map((m) => m.displayName).join(', ')} must create or select a character.`
          : null,
    },
  ]
  const checksComplete = checks.filter((c) => c.done).length

  const copyJoinCode = () => {
    if (!campaign?.join_code) return
    navigator.clipboard?.writeText(campaign.join_code)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 1500)
  }

  const copyInviteLink = () => {
    if (!campaign?.join_code) return
    const link = `${window.location.origin}${window.location.pathname}?join=${campaign.join_code}`
    navigator.clipboard?.writeText(link)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 1500)
  }

  const inviteAnotherPlayer = () => {
    if (!campaign?.join_code) return
    navigator.clipboard?.writeText(campaign.join_code)
    setCopiedInvite(true)
    setTimeout(() => setCopiedInvite(false), 1500)
  }

  // Human-GM campaigns: only the GM starts the table. AI-GM campaigns have
  // no distinguished human GM (see handle_new_campaign in schema.sql --
  // every member is role='player'), so anyone at the table can kick things
  // off once the group is ready.
  const isHumanGm = campaign?.gm_type === 'human'
  const canStart = !isHumanGm || myRole === 'gm'
  const blockReason = getCampaignEntryBlockReason({
    sessionActive: campaign?.session_active,
    hasCharacter: Boolean(me?.character),
    canStart,
    hasMinPlayers,
    minPlayers,
    memberCount: members.length,
    missingCharacterNames: missingCharacters.map((m) => m.displayName),
  })

  const startSession = async () => {
    if (blockReason || starting) return
    if (campaign?.session_active) {
      onStartSession && onStartSession(myRole)
      return
    }
    setStarting(true)
    setStartError(null)
    const { error: startErr } = await supabase.rpc('set_campaign_session_active', {
      p_campaign_id: campaignId,
      p_active: true,
    })
    setStarting(false)
    if (startErr) {
      setStartError(startErr.message)
      return
    }
    onStartSession && onStartSession(myRole)
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <p className="text-xs text-ink-faint">Loading lobby...</p>
      </div>
    )
  }

  if (error || !campaign) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <p className="text-sm text-danger-text">{error || 'Campaign not found.'}</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-ink text-xl font-semibold">{campaign.name}</h1>
          <p className="text-sm text-ink-dim">
            {campaign.system} &middot;{' '}
            {campaign.session_active
              ? `Session ${campaign.session_number} is live`
              : `Session ${campaign.session_number} has not started`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" icon={Settings} onClick={onOpenSettings}>
            Campaign settings
          </Button>
          <Button
            variant="primary"
            icon={Rocket}
            onClick={startSession}
            disabled={starting || !!blockReason}
            tooltip={blockReason}
            className="px-4"
          >
            {starting ? 'Starting...' : campaign.session_active ? 'Enter session' : 'Start session'}
          </Button>
        </div>
      </div>

      {startError && <p className="text-xs text-danger-text mb-4">{startError}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <Card title={`Players · ${members.length} / ${maxPlayers}`}>
          <div className="flex flex-col gap-3">
            {members.map((m) => (
              <div key={m.userId} className="border border-line-soft rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary-bg flex items-center justify-center text-xs font-medium text-primary-text">
                      {m.displayName[0].toUpperCase()}
                    </div>
                    <p className="text-sm text-ink">{m.displayName}</p>
                    {m.role === 'gm' && (
                      <span className="text-[11px] text-ink-dim flex items-center gap-1">
                        <Crown size={12} /> GM
                      </span>
                    )}
                  </div>
                  {m.character ? (
                    <Badge tone="green">Ready</Badge>
                  ) : (
                    <Badge tone="amber">Needs character</Badge>
                  )}
                </div>

                {m.character ? (
                  <div className="flex items-center justify-between bg-bg rounded-md px-3 py-2 mt-1.5">
                    <div>
                      <p className="text-sm text-ink">{m.character.name}</p>
                      <p className="text-xs text-ink-dim">
                        Level {m.character.level} &middot; {m.character.ancestry} {m.character.class} &middot; HP{' '}
                        {m.character.hp} &middot; AC {m.character.ac}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => onOpenCharacterSheet && onOpenCharacterSheet(m.character.id)}
                      className="text-xs px-2.5 py-1 shrink-0"
                    >
                      View character
                    </Button>
                  </div>
                ) : m.userId === user?.id ? (
                  <div className="flex gap-2 mt-1.5">
                    <Button variant="primary" onClick={onCreateCharacter} className="flex-1">
                      Create character
                    </Button>
                    <Button variant="outline" onClick={onChooseCharacter} className="flex-1">
                      Choose existing
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <button
            onClick={inviteAnotherPlayer}
            className="w-full mt-3 text-sm border border-dashed border-line rounded-lg py-2.5 flex items-center justify-center gap-1.5 text-ink-dim hover:bg-panel2"
          >
            <UserPlus size={14} /> {copiedInvite ? 'Join code copied' : 'Invite another player'}
          </button>
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Ready to begin?">
            <div className="flex flex-col gap-2 mb-3">
              {checks.map((c) => (
                <div key={c.key} className="flex items-start gap-2 text-xs">
                  {c.done ? (
                    <CheckCircle2 size={14} className="text-positive-text mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle size={14} className="text-warning-text mt-0.5 shrink-0" />
                  )}
                  <div>
                    <p className={c.done ? 'text-ink' : 'text-warning-text'}>{c.label}</p>
                    {c.detail && <p className="text-ink-faint mt-0.5">{c.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-ink-faint mb-1.5">
              {checksComplete} of {checks.length} checks complete
            </p>
            <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
              <div
                className="h-full bg-positive rounded-full transition-all"
                style={{ width: `${(checksComplete / checks.length) * 100}%` }}
              />
            </div>
          </Card>

          <Card title="Invite players">
            <div className="flex items-center justify-between text-xs mb-2.5">
              <span className="text-ink-dim flex items-center gap-1.5">
                <Key size={13} /> Join code
              </span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-ink tracking-wide">{campaign.join_code}</span>
                <button
                  onClick={copyJoinCode}
                  className="text-[11px] px-2 py-0.5 border border-line rounded text-ink-dim hover:bg-panel2 flex items-center gap-1"
                >
                  {copiedCode ? <Check size={11} /> : <Copy size={11} />} {copiedCode ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs mb-3">
              <span className="text-ink-dim">Campaign access</span>
              <span className="text-ink">{campaign.is_public ? 'Public' : 'Private'}</span>
            </div>
            <Button variant="outline" icon={Copy} onClick={copyInviteLink} className="w-full py-2">
              {copiedLink ? 'Link copied' : 'Copy invite link'}
            </Button>
            <p className="text-[11px] text-ink-faint mt-2">
              {campaign.is_public
                ? 'Anyone with the link can join directly.'
                : campaign.join_password_hash
                  ? 'Anyone with the code and campaign password can request to join.'
                  : 'Anyone with the code can request to join.'}
            </p>
          </Card>

          <Card title="Campaign rules">
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-ink-dim">GM</span>
                {campaign.gm_type === 'ai' ? (
                  <span className="px-2 py-0.5 rounded bg-ai-bg text-ai-text flex items-center gap-1">
                    <Bot size={11} /> AI GM
                  </span>
                ) : (
                  <span className="text-ink flex items-center gap-1">
                    <Crown size={11} /> Human GM
                  </span>
                )}
              </div>
              {campaign.gm_type === 'ai' && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-dim">Tone</span>
                    <span className="text-ink">{TONE_LABELS[campaign.ai_gm_tone] || 'Balanced'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-dim">Rules</span>
                    <span className="text-ink">{RULES_STYLE_LABELS[campaign.ai_gm_rules_style] || 'Guided'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-dim">Lethality</span>
                    <span className="text-ink">{campaign.ai_gm_lethality ?? 50}/100</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-dim">Autonomy</span>
                    <span className="text-ink">{AUTONOMY_LABELS[campaign.ai_gm_autonomy] || AUTONOMY_LABELS.ask_major}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-ink-dim">Starting level</span>
                <span className="text-ink">{campaign.starting_level ?? 1}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-dim">Players</span>
                <span className="text-ink">
                  {minPlayers}&ndash;{maxPlayers}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-dim">House rules</span>
                <span className="text-ink">{campaign.house_rules?.trim() ? 'Set' : 'None set'}</span>
              </div>
              <div>
                <span className="text-ink-dim block mb-1">Modes of play</span>
                {campaign.modes_of_play?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {campaign.modes_of_play.map((k) => (
                      <span key={k} className="px-1.5 py-0.5 rounded bg-panel2 text-ink-dim">
                        {MODE_LABELS[k] || k}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-ink-faint">None active</span>
                )}
              </div>
            </div>
            <button
              onClick={onOpenSettings}
              className="text-xs text-primary-text hover:text-primary-text mt-3"
            >
              View all rules &amp; house rules
            </button>
          </Card>
        </div>
      </div>
    </div>
  )
}
