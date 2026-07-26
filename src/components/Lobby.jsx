import { useState, useEffect, useCallback } from 'react'
import { Swords, Key, Plus, Crown, Bot, Users, LogOut, AlertCircle, Settings } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

function randomJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I ambiguity
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return `${code.slice(0, 3)}-${code.slice(3)}`
}

export default function Lobby({ session, onEnterCampaign, onSignOut, onOpenProfile }) {
  const user = session?.user
  const [joinCode, setJoinCode] = useState('')
  const [showJoin, setShowJoin] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGmType, setNewGmType] = useState('human')
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

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

    const withCounts = await Promise.all(
      rows.map(async (m) => {
        const c = m.campaigns
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

        return { ...c, myRole: m.role, playerCount: count || 0, gmName }
      })
    )

    setCampaigns(withCounts)
    setLoading(false)
  }, [user])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  const joinWithCode = async () => {
    if (!joinCode.trim() || !user) return
    setBusy(true)
    setError(null)

    const { data: campaign, error: lookupError } = await supabase
      .from('campaigns')
      .select('id')
      .eq('join_code', joinCode.trim().toUpperCase())
      .maybeSingle()

    if (lookupError || !campaign) {
      setError("No campaign found with that code.")
      setBusy(false)
      return
    }

    const { error: joinError } = await supabase
      .from('campaign_members')
      .upsert(
        { campaign_id: campaign.id, user_id: user.id, role: 'player' },
        { onConflict: 'campaign_id,user_id', ignoreDuplicates: true }
      )

    setBusy(false)
    if (joinError) {
      setError(joinError.message)
      return
    }

    setJoinCode('')
    setShowJoin(false)
    loadCampaigns()
  }

  const createCampaign = async () => {
    if (!newName.trim() || !user) return
    setBusy(true)
    setError(null)

    const { data: campaign, error: createError } = await supabase
      .from('campaigns')
      .insert({
        name: newName.trim(),
        system: 'Shadowdark',
        gm_type: newGmType,
        gm_user_id: newGmType === 'human' ? user.id : null,
        join_code: randomJoinCode(),
      })
      .select()
      .single()

    if (createError) {
      setError(createError.message)
      setBusy(false)
      return
    }

    // A DB trigger already adds the creator as a member the moment the
    // campaign row is inserted (see on_campaign_created in schema.sql) --
    // this upsert just makes sure it's there without erroring if it is.
    const { error: memberError } = await supabase
      .from('campaign_members')
      .upsert(
        { campaign_id: campaign.id, user_id: user.id, role: newGmType === 'human' ? 'gm' : 'player' },
        { onConflict: 'campaign_id,user_id', ignoreDuplicates: true }
      )

    setBusy(false)
    if (memberError) {
      setError(memberError.message)
      return
    }

    setNewName('')
    setShowCreate(false)
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
            onClick={() => {
              setShowJoin((s) => !s)
              setShowCreate(false)
            }}
            className="text-sm border border-neutral-700 rounded-md px-3 py-1.5 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800"
          >
            <Key size={15} /> Join with code
          </button>
          <button
            onClick={() => {
              setShowCreate((s) => !s)
              setShowJoin(false)
            }}
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
        <div className="mb-4 flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
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
      )}

      {showCreate && (
        <div className="mb-4 bg-neutral-900 border border-neutral-800 rounded-xl p-3 flex flex-col gap-2.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Campaign name"
            className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setNewGmType('human')}
              className={`flex-1 text-xs py-1.5 rounded-md border ${
                newGmType === 'human' ? 'bg-neutral-800 border-blue-500 text-white' : 'border-neutral-700 text-neutral-300'
              }`}
            >
              I'll be GM
            </button>
            <button
              onClick={() => setNewGmType('ai')}
              className={`flex-1 text-xs py-1.5 rounded-md border ${
                newGmType === 'ai' ? 'bg-neutral-800 border-blue-500 text-white' : 'border-neutral-700 text-neutral-300'
              }`}
            >
              AI is GM
            </button>
          </div>
          <button
            onClick={createCampaign}
            disabled={busy}
            className="text-sm border border-neutral-700 rounded-md py-2 text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
          >
            Create
          </button>
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

      <div className="mt-6 pt-4 border-t border-neutral-800">
        <p className="text-xs text-neutral-500">
          Invite friends by sharing a campaign's join code from inside the session.
        </p>
      </div>
    </div>
  )
}
