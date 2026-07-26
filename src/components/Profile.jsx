import { useState, useEffect, useCallback } from 'react'
import { User, LogOut, Check, AlertCircle, Crown, Bot, Users as UsersIcon, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

export default function Profile({ session, onSignOut, onBack }) {
  const user = session?.user
  const [displayName, setDisplayName] = useState('')
  const [savedName, setSavedName] = useState('')
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const [characters, setCharacters] = useState([])
  const [loadingCharacters, setLoadingCharacters] = useState(true)

  const [memberships, setMemberships] = useState([])
  const [loadingMemberships, setLoadingMemberships] = useState(true)
  const [leavingId, setLeavingId] = useState(null)

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setDisplayName(data?.display_name || '')
        setSavedName(data?.display_name || '')
        setLoadingProfile(false)
      })
  }, [user])

  useEffect(() => {
    if (!user) return
    supabase
      .from('characters')
      .select('id, name, ancestry, class, level, campaign_id, campaigns (name)')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setCharacters(data || [])
        setLoadingCharacters(false)
      })
  }, [user])

  const loadMemberships = useCallback(() => {
    if (!user) return
    setLoadingMemberships(true)
    supabase
      .from('campaign_members')
      .select('campaign_id, role, campaigns (id, name, gm_type)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        setMemberships((data || []).filter((m) => m.campaigns))
        setLoadingMemberships(false)
      })
  }, [user])

  useEffect(() => {
    loadMemberships()
  }, [loadMemberships])

  const saveName = async () => {
    if (!user || !displayName.trim()) return
    setSaving(true)
    setError(null)
    setSaved(false)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ display_name: displayName.trim() })
      .eq('id', user.id)
    setSaving(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setSavedName(displayName.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const leaveCampaign = async (campaignId) => {
    if (!user) return
    setLeavingId(campaignId)
    await supabase
      .from('campaign_members')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('user_id', user.id)
    setLeavingId(null)
    loadMemberships()
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <User size={16} className="text-blue-400" />
          </div>
          <h1 className="text-white text-lg font-medium">Your profile</h1>
        </div>
        {onBack && (
          <button
            onClick={onBack}
            className="text-xs border border-neutral-700 rounded-md px-2.5 py-1 text-neutral-300 hover:bg-neutral-800"
          >
            Back to lobby
          </button>
        )}
      </div>

      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 mb-4">
        <p className="text-xs text-neutral-400 mb-1.5">Display name</p>
        {loadingProfile ? (
          <p className="text-sm text-neutral-500">Loading...</p>
        ) : (
          <div className="flex gap-2">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="flex-1 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white"
            />
            <button
              onClick={saveName}
              disabled={saving || displayName.trim() === savedName}
              className="text-sm border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 hover:bg-neutral-800 disabled:opacity-40 flex items-center gap-1.5"
            >
              {saved ? <Check size={14} className="text-green-400" /> : null}
              {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
            </button>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-1.5 text-red-400 mt-2">
            <AlertCircle size={12} />
            <p className="text-xs">{error}</p>
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-neutral-800 flex items-center justify-between">
          <div>
            <p className="text-xs text-neutral-400">Email</p>
            <p className="text-sm text-neutral-200">{user?.email}</p>
          </div>
          {onSignOut && (
            <button
              onClick={onSignOut}
              className="text-xs border border-neutral-700 rounded-md px-2.5 py-1.5 flex items-center gap-1.5 text-neutral-300 hover:bg-neutral-800"
            >
              <LogOut size={13} /> Sign out
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-neutral-400 mb-2">Your campaigns</p>
      <div className="flex flex-col gap-1.5 mb-4">
        {loadingMemberships ? (
          <p className="text-sm text-neutral-500">Loading...</p>
        ) : memberships.length === 0 ? (
          <p className="text-sm text-neutral-500">Not in any campaigns yet.</p>
        ) : (
          memberships.map((m) => (
            <div key={m.campaign_id} className="flex items-center gap-2.5 bg-neutral-900 rounded-md px-3 py-2">
              {m.campaigns.gm_type === 'ai' ? (
                <Bot size={14} className="text-purple-300 flex-shrink-0" />
              ) : (
                <Crown size={14} className="text-neutral-400 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className="text-sm text-white">{m.campaigns.name}</p>
                <p className="text-xs text-neutral-400">
                  {m.role === 'gm' ? 'You are GM' : 'Player'}
                </p>
              </div>
              <button
                onClick={() => leaveCampaign(m.campaign_id)}
                disabled={leavingId === m.campaign_id}
                title="Leave campaign"
                className="text-xs border border-neutral-700 rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-red-400 disabled:opacity-40 flex items-center gap-1"
              >
                <X size={12} /> {leavingId === m.campaign_id ? 'Leaving...' : 'Leave'}
              </button>
            </div>
          ))
        )}
      </div>

      <p className="text-xs text-neutral-400 mb-2">Your characters</p>
      <div className="flex flex-col gap-1.5">
        {loadingCharacters ? (
          <p className="text-sm text-neutral-500">Loading...</p>
        ) : characters.length === 0 ? (
          <p className="text-sm text-neutral-500">No characters yet.</p>
        ) : (
          characters.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 bg-neutral-900 rounded-md px-3 py-2">
              <UsersIcon size={14} className="text-neutral-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-white">{c.name}</p>
                <p className="text-xs text-neutral-400">
                  {c.ancestry} {c.class} &middot; lvl {c.level} &middot; {c.campaigns?.name || 'unknown campaign'}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
