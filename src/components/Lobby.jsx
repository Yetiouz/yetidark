import { useState, useEffect, useCallback } from 'react'
import { Swords, Key, Plus, Crown, Bot, Users, LogOut, AlertCircle, Settings } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

// Campaign creation moved out to CampaignBuilder.jsx (a full step-by-step
// wizard) -- onCreateCampaign just switches App.jsx to that view instead
// of this component managing an inline create panel/form itself.
export default function Lobby({ session, onEnterCampaign, onCreateCampaign, onSignOut, onOpenProfile }) {
  const user = session?.user
  const [joinCode, setJoinCode] = useState('')
  const [joinPassword, setJoinPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [campaigns, setCampaigns] = useState([])
  const [publicCampaigns, setPublicCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Fills in the shared display fields (player count, GM display name) for
  // a raw campaign row -- used for both "your campaigns" and the public
  // list below.
  const withDisplayInfo = async (c) => {
    const { count } = await supabase
      .from('campaign_members')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', c.id)

    let gmName = null
    if (c.gm_type === 'human' && c.gm_user_id) {
      const { data: gmProfile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', c.gm_user_id)
        .maybeSingle()
      gmName = gmProfile?.display_name || null
    }

    return { ...c, playerCount: count || 0, gmName }
  }

  const loadCampaigns = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    const { data: memberships, error: memberError } = await supabase
      .from('campaign_members')
      .select('role, campaigns (id, name, system, gm_type, gm_user_id, session_number, status, join_code)')
      .eq('user_id', user.id)

    if (memberError) {
      setError(memberError.message)
      setLoading(false)
      return
    }

    const rows = (memberships || []).filter((m) => m.campaigns)
    const myIds = new Set(rows.map((m) => m.campaigns.id))

    const withCounts = await Promise.all(
      rows.map(async (m) => ({ ...(await withDisplayInfo(m.campaigns)), myRole: m.role }))
    )

    setCampaigns(withCounts)

    // Public campaigns anyone signed in can browse and join with one
    // click -- RLS lets any authenticated user read is_public rows
    // regardless of membership (see 008_campaign_privacy.sql), so this is
    // a second, simpler query rather than merging it into the
    // membership-scoped one above.
    const { data: publicRows } = await supabase
      .from('campaigns')
      .select('id, name, system, gm_type, gm_user_id, session_number, status')
      .eq('is_public', true)

    const publicWithCounts = await Promise.all(
      (publicRows || []).filter((c) => !myIds.has(c.id)).map((c) => withDisplayInfo(c))
    )

    setPublicCampaigns(publicWithCounts)
    setLoading(false)
  }, [user])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  // Joining a private campaign has to go through this RPC -- it checks
  // the password server-side (never exposed to the client) before adding
  // the member row. It also handles public campaigns via code (skips the
  // password check), so this stays the one path for code-based joins.
  const joinWithCode = async () => {
    if (!joinCode.trim() || !user) return
    setBusy(true)
    setError(null)

    const { error: rpcError } = await supabase.rpc('join_campaign_by_code', {
      p_code: joinCode.trim().toUpperCase(),
      p_password: joinPassword.trim() || null,
    })

    setBusy(false)
    if (rpcError) {
      if (rpcError.message.toLowerCase().includes('password')) {
        setNeedsPassword(true)
      }
      setError(rpcError.message)
      return
    }

    setJoinCode('')
    setJoinPassword('')
    setNeedsPassword(false)
    setShowJoin(false)
    loadCampaigns()
  }

  // Public campaigns skip the code/password flow entirely -- but this goes
  // through an RPC rather than a direct client-side upsert. A raw upsert
  // from here gets sent by PostgREST as an INSERT ... SELECT ... FROM
  // json_to_record() (that's how it builds every insert/upsert), and that
  // specific query shape was silently breaking the RLS policy's auth.uid()
  // check -- every join failed with "new row violates row-level security
  // policy" even though the same check passes for a plain VALUES insert.
  // The RPC does that plain insert server-side instead, sidestepping it.
  const joinPublicCampaign = async (campaignId) => {
    if (!user) return
    setBusy(true)
    setError(null)

    const { error: joinError } = await supabase.rpc('join_public_campaign', {
      p_campaign_id: campaignId,
    })

    setBusy(false)
    if (joinError) {
      setError(joinError.message)
      return
    }

    loadCampaigns()
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Swords size={18} className="text-blue-400" />
          </div>
          <span className="text-white font-medium">Delve</span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-sm text-neutral-400">{user?.email}</span>
          <button
            onClick={onOpenProfile}
            title="Profile"
            className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-medium text-blue-300 hover:bg-blue-500/30"
          >
            {(user?.email || '?')[0].toUpperCase()}
          </button>
          {onOpenProfile && (
            <button
              onClick={onOpenProfile}
              title="Profile settings"
              className="w-7 h-7 rounded-md border border-neutral-700 flex items-center justify-center text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              <Settings size={13} />
            </button>
          )}
          {onSignOut && (
            <button
              onClick={onSignOut}
              title="Sign out"
              className="w-7 h-7 rounded-md border border-neutral-700 flex items-center justify-center text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              <LogOut size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h1 className="text-white text-lg font-medium">Your campaigns</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowJoin((s) => !s)}
            className="text-sm border border-neutral-700 rounded-md px-3 py-1.5 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800"
          >
            <Key size={15} /> Join with code
          </button>
          <button
            onClick={onCreateCampaign}
            className="text-sm border border-neutral-700 rounded-md px-3 py-1.5 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800"
          >
            <Plus size={15} /> New campaign
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 text-red-400 text-xs">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {showJoin && (
        <div className="mb-4 flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && joinWithCode()}
              placeholder="Enter join code"
              className="flex-1 bg-neutral-900 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white"
            />
            <button
              onClick={joinWithCode}
              disabled={busy}
              className="text-sm border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
            >
              Join
            </button>
          </div>
          {needsPassword && (
            <input
              type="password"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && joinWithCode()}
              placeholder="Campaign password"
              className="flex-1 bg-neutral-900 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white"
            />
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading campaigns...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {campaigns.map((c) => (
            <div key={c.id} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-white font-medium">{c.name}</p>
                {c.gm_type === 'ai' ? (
                  <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">AI GM</span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">
                    {c.status === 'active' ? 'Live now' : c.status}
                  </span>
                )}
              </div>
              <p className="text-sm text-neutral-400 mb-3">
                {c.system} &middot; session {c.session_number}
              </p>
              <div className="flex items-center justify-between text-xs text-neutral-400 mb-3">
                <span className="flex items-center gap-1.5">
                  {c.gm_type === 'human' ? <Crown size={14} /> : <Bot size={14} />}
                  {c.gm_type === 'human'
                    ? c.gmName
                      ? `${c.gmName} is GM`
                      : 'Human GM'
                    : 'AI is running this one'}
                </span>
                <span className="flex items-center gap-1">
                  <Users size={14} /> {c.playerCount}
                </span>
              </div>
              <button
                onClick={() => onEnterCampaign(c)}
                className="w-full text-sm border border-neutral-700 rounded-md py-2 text-neutral-100 hover:bg-neutral-800"
              >
                Jump in
              </button>
            </div>
          ))}

          {campaigns.length === 0 && (
            <p className="text-sm text-neutral-500 sm:col-span-2">
              No campaigns yet -- join one with a code or start your own.
            </p>
          )}
        </div>
      )}

      {!loading && publicCampaigns.length > 0 && (
        <div className="mt-8">
          <h2 className="text-white text-base font-medium mb-3">Public campaigns</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {publicCampaigns.map((c) => (
              <div key={c.id} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-white font-medium">{c.name}</p>
                  {c.gm_type === 'ai' ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">AI GM</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">Public</span>
                  )}
                </div>
                <p className="text-sm text-neutral-400 mb-3">
                  {c.system} &middot; session {c.session_number}
                </p>
                <div className="flex items-center justify-between text-xs text-neutral-400 mb-3">
                  <span className="flex items-center gap-1.5">
                    {c.gm_type === 'human' ? <Crown size={14} /> : <Bot size={14} />}
                    {c.gm_type === 'human'
                      ? c.gmName
                        ? `${c.gmName} is GM`
                        : 'Human GM'
                      : 'AI is running this one'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={14} /> {c.playerCount}
                  </span>
                </div>
                <button
                  onClick={() => joinPublicCampaign(c.id)}
                  disabled={busy}
                  className="w-full text-sm border border-neutral-700 rounded-md py-2 text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
                >
                  Join
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-neutral-800">
        <p className="text-xs text-neutral-500">
          Public campaigns show up above automatically for anyone signed in. Invite friends to a private
          campaign by sharing its join code and password from inside the session (campaign settings).
        </p>
      </div>
    </div>
  )
}
