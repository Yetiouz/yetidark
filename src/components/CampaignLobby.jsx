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
  // Once a session is already live, rejoining shouldn't be blocked by a
  // late joiner's missing character -- those readiness checks only gate
  // the very first start.
  const blockReason = !canStart
    ? 'Only the GM can start the session.'
    : campaign?.session_active
      ? null
      : !hasMinPlayers
        ? `Waiting for ${minPlayers - members.length} more player${minPlayers - members.length === 1 ? '' : 's'}`
        : missingCharacters.length > 0
          ? `Waiting for ${missingCharacters.map((m) => m.displayName).join(', ')}`
          : null

  const startSession = async () => {
    if (!canStart || starting) return
    setStarting(true)
    setStartError(null)
    const { error: startErr } = await supabase.from('campaigns').update({ session_active: true }).eq('id', campaignId)
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
        <p className="text-xs text-neutral-500">Loading lobby...</p>
      </div>
    )
  }

  if (error || !campaign) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <p className="text-sm text-red-400">{error || 'Campaign not found.'}</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-white text-xl font-semibold">{campaign.name}</h1>
          <p className="text-sm text-neutral-400">
            {campaign.system} &middot;{' '}
            {campaign.session_active
              ? `Session ${campaign.session_number} is live`
              : `Session ${campaign.session_number} has not started`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onOpenSettings}
            className="text-sm border border-neutral-700 rounded-md px-3 py-1.5 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800"
          >
            <Settings size={14} /> Campaign settings
          </button>
          <div className="relative group">
            <button
              onClick={startSession}
              disabled={!canStart || starting || !!blockReason}
              className="text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 rounded-md px-4 py-1.5 flex items-center gap-1.5 text-white font-medium"
            >
              <Rocket size={14} />
              {starting ? 'Starting...' : campaign.session_active ? 'Rejoin session' : 'Start session'}
            </button>
            {blockReason && (
              <div className="absolute right-0 top-full mt-1.5 whitespace-nowrap text-xs bg-neutral-800 border border-neutral-700 rounded-md px-2.5 py-1.5 text-neutral-300 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                {blockReason}
              </div>
            )}
          </div>
        </div>
      </div>

      {startError && <p className="text-xs text-red-400 mb-4">{startError}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
          <p className="text-sm font-medium text-white mb-3">
            Players &middot; {members.length} / {maxPlayers}
          </p>

          <div className="flex flex-col gap-3">
            {members.map((m) => (
              <div key={m.userId} className="border border-neutral-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-medium text-blue-300">
                      {m.displayName[0].toUpperCase()}
                    </div>
                    <p className="text-sm text-white">{m.displayName}</p>
                    {m.role === 'gm' && (
                      <span className="text-[11px] text-neutral-400 flex items-center gap-1">
                        <Crown size={12} /> GM
                      </span>
                    )}
                  </div>
                  {m.character ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">Ready</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">Needs character</span>
                  )}
                </div>

                {m.character ? (
                  <div className="flex items-center justify-between bg-neutral-950 rounded-md px-3 py-2 mt-1.5">
                    <div>
                      <p className="text-sm text-white">{m.character.name}</p>
                      <p className="text-xs text-neutral-400">
                        Level {m.character.level} &middot; {m.character.ancestry} {m.character.class} &middot; HP{' '}
                        {m.character.hp} &middot; AC {m.character.ac}
                      </p>
                    </div>
                    <button
                      onClick={() => onOpenCharacterSheet && onOpenCharacterSheet(m.character.id)}
                      className="text-xs border border-neutral-700 rounded-md px-2.5 py-1 text-neutral-200 hover:bg-neutral-800 shrink-0"
                    >
                      View character
                    </button>
                  </div>
                ) : m.userId === user?.id ? (
                  <div className="flex gap-2 mt-1.5">
                    <button
                      onClick={onCreateCharacter}
                      className="flex-1 text-sm bg-blue-600 hover:bg-blue-500 rounded-md py-1.5 text-white font-medium"
                    >
                      Create character
                    </button>
                    <button
                      onClick={onChooseCharacter}
                      className="flex-1 text-sm border border-neutral-700 rounded-md py-1.5 text-neutral-200 hover:bg-neutral-800"
                    >
                      Choose existing
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <button
            onClick={inviteAnotherPlayer}
            className="w-full mt-3 text-sm border border-dashed border-neutral-700 rounded-lg py-2.5 flex items-center justify-center gap-1.5 text-neutral-300 hover:bg-neutral-800"
          >
            <UserPlus size={14} /> {copiedInvite ? 'Join code copied' : 'Invite another player'}
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
            <p className="text-sm font-medium text-white mb-3">Ready to begin?</p>
            <div className="flex flex-col gap-2 mb-3">
              {checks.map((c) => (
                <div key={c.key} className="flex items-start gap-2 text-xs">
                  {c.done ? (
                    <CheckCircle2 size={14} className="text-green-400 mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                  )}
                  <div>
                    <p className={c.done ? 'text-neutral-200' : 'text-amber-300'}>{c.label}</p>
                    {c.detail && <p className="text-neutral-500 mt-0.5">{c.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-neutral-500 mb-1.5">
              {checksComplete} of {checks.length} checks complete
            </p>
            <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${(checksComplete / checks.length) * 100}%` }}
              />
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
            <p className="text-sm font-medium text-white mb-3">Invite players</p>
            <div className="flex items-center justify-between text-xs mb-2.5">
              <span className="text-neutral-400 flex items-center gap-1.5">
                <Key size={13} /> Join code
              </span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-white tracking-wide">{campaign.join_code}</span>
                <button
                  onClick={copyJoinCode}
                  className="text-[11px] px-2 py-0.5 border border-neutral-700 rounded text-neutral-300 hover:bg-neutral-800 flex items-center gap-1"
                >
                  {copiedCode ? <Check size={11} /> : <Copy size={11} />} {copiedCode ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs mb-3">
              <span className="text-neutral-400">Campaign access</span>
              <span className="text-neutral-200">{campaign.is_public ? 'Public' : 'Private'}</span>
            </div>
            <button
              onClick={copyInviteLink}
              className="w-full text-sm border border-neutral-700 rounded-md py-2 flex items-center justify-center gap-1.5 text-neutral-100 hover:bg-neutral-800"
            >
              <Copy size={13} /> {copiedLink ? 'Link copied' : 'Copy invite link'}
            </button>
            <p className="text-[11px] text-neutral-500 mt-2">
              {campaign.is_public
                ? 'Anyone with the link can join directly.'
                : campaign.join_password_hash
                  ? 'Anyone with the code and campaign password can request to join.'
                  : 'Anyone with the code can request to join.'}
            </p>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
            <p className="text-sm font-medium text-white mb-3">Campaign rules</p>
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">GM</span>
                {campaign.gm_type === 'ai' ? (
                  <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 flex items-center gap-1">
                    <Bot size={11} /> AI GM
                  </span>
                ) : (
                  <span className="text-neutral-200 flex items-center gap-1">
                    <Crown size={11} /> Human GM
                  </span>
                )}
              </div>
              {campaign.gm_type === 'ai' && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Tone</span>
                    <span className="text-neutral-200">{TONE_LABELS[campaign.ai_gm_tone] || 'Balanced'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Rules</span>
                    <span className="text-neutral-200">{RULES_STYLE_LABELS[campaign.ai_gm_rules_style] || 'Guided'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Lethality</span>
                    <span className="text-neutral-200">{campaign.ai_gm_lethality ?? 50}/100</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Autonomy</span>
                    <span className="text-neutral-200">{AUTONOMY_LABELS[campaign.ai_gm_autonomy] || AUTONOMY_LABELS.ask_major}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Starting level</span>
                <span className="text-neutral-200">{campaign.starting_level ?? 1}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Players</span>
                <span className="text-neutral-200">
                  {minPlayers}&ndash;{maxPlayers}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">House rules</span>
                <span className="text-neutral-200">{campaign.house_rules?.trim() ? 'Set' : 'None set'}</span>
              </div>
              <div>
                <span className="text-neutral-400 block mb-1">Modes of play</span>
                {campaign.modes_of_play?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {campaign.modes_of_play.map((k) => (
                      <span key={k} className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">
                        {MODE_LABELS[k] || k}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-neutral-500">None active</span>
                )}
              </div>
            </div>
            <button
              onClick={onOpenSettings}
              className="text-xs text-blue-400 hover:text-blue-300 mt-3"
            >
              View all rules &amp; house rules
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
