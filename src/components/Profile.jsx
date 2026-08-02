import { useState, useEffect, useCallback } from 'react'
import { User, LogOut, Check, AlertCircle, Crown, Bot, Users as UsersIcon, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import Card from './ui/Card.jsx'
import Button from './ui/Button.jsx'
import ConfirmModal from './ui/ConfirmModal.jsx'
import Modal from './ui/Modal.jsx'

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
  const [leaveTarget, setLeaveTarget] = useState(null) // membership pending leave confirmation (players only)
  const [gmBlocked, setGmBlocked] = useState(null) // membership the user tried to leave while still its GM

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

  // Every campaign has exactly one GM (campaigns.gm_user_id, mirrored 1:1 by
  // this member row's own role -- confirmed live, no campaign in prod has
  // zero or multiple role='gm' members, so there's no co-GM model to account
  // for). A GM leaving would strand the campaign: every is_campaign_gm()-gated
  // table (monsters, turn order, clocks, NPCs, notes, map) becomes unwritable
  // by anyone. The DELETE RLS policy on campaign_members ("users can leave a
  // campaign") doesn't itself guard against this, so block it here instead.
  // No GM-transfer or campaign-delete feature exists in the app yet (checked
  // CampaignSettings.jsx and grepped the repo for both), so the block is
  // unconditional for now rather than pointing at a feature that isn't built.
  const requestLeaveCampaign = (membership) => {
    if (membership.role === 'gm') {
      setGmBlocked(membership)
      return
    }
    setLeaveTarget(membership)
  }

  const confirmLeaveCampaign = async () => {
    if (!leaveTarget || !user) return
    const campaignId = leaveTarget.campaign_id
    setLeavingId(campaignId)
    await supabase
      .from('campaign_members')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('user_id', user.id)
    setLeavingId(null)
    setLeaveTarget(null)
    loadMemberships()
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary-bg flex items-center justify-center">
            <User size={16} className="text-primary-text" />
          </div>
          <h1 className="text-ink text-lg font-medium">Your profile</h1>
        </div>
        {onBack && (
          <Button className="text-xs px-3 py-1" onClick={onBack}>
            Back to lobby
          </Button>
        )}
      </div>

      <Card className="mb-4">
        <p className="text-xs text-ink-dim mb-2">Display name</p>
        {loadingProfile ? (
          <p className="text-sm text-ink-faint">Loading...</p>
        ) : (
          <div className="flex gap-2">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="flex-1 bg-bg border border-line rounded-md px-3 py-2 text-sm text-ink"
            />
            <Button onClick={saveName} disabled={saving || displayName.trim() === savedName}>
              {saved ? <Check size={14} className="text-positive-text" /> : null}
              {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
            </Button>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-danger-text mt-2">
            <AlertCircle size={12} />
            <p className="text-xs">{error}</p>
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-line-soft flex items-center justify-between">
          <div>
            <p className="text-xs text-ink-dim">Email</p>
            <p className="text-sm text-ink">{user?.email}</p>
          </div>
          {onSignOut && (
            <Button icon={LogOut} onClick={onSignOut}>
              Sign out
            </Button>
          )}
        </div>
      </Card>

      <p className="text-xs text-ink-dim mb-2">Your campaigns</p>
      <div className="flex flex-col gap-2 mb-4">
        {loadingMemberships ? (
          <p className="text-sm text-ink-faint">Loading...</p>
        ) : memberships.length === 0 ? (
          <p className="text-sm text-ink-faint">Not in any campaigns yet.</p>
        ) : (
          memberships.map((m) => (
            <div key={m.campaign_id} className="flex items-center gap-3 bg-panel rounded-md px-3 py-2">
              {m.campaigns.gm_type === 'ai' ? (
                <Bot size={14} className="text-ai-text flex-shrink-0" />
              ) : (
                <Crown size={14} className="text-ink-dim flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className="text-sm text-ink">{m.campaigns.name}</p>
                <p className="text-xs text-ink-dim">
                  {m.role === 'gm' ? 'You are GM' : 'Player'}
                </p>
              </div>
              {/* Raw <button>, not the shared Button: hover-only danger-text
                  cue with no persistent tint, same pattern GameTable.jsx's
                  Batch B pass deliberately kept raw since Button's danger
                  variant always carries a persistent bg-danger-bg tint this
                  one intentionally doesn't have. */}
              <button
                onClick={() => requestLeaveCampaign(m)}
                disabled={leavingId === m.campaign_id}
                title="Leave campaign"
                className="text-xs border border-line rounded-md px-2 py-1 text-ink-dim hover:bg-panel2 hover:text-danger-text disabled:opacity-40 flex items-center gap-1"
              >
                <X size={12} /> {leavingId === m.campaign_id ? 'Leaving...' : 'Leave'}
              </button>
            </div>
          ))
        )}
      </div>

      <p className="text-xs text-ink-dim mb-2">Your characters</p>
      <div className="flex flex-col gap-2">
        {loadingCharacters ? (
          <p className="text-sm text-ink-faint">Loading...</p>
        ) : characters.length === 0 ? (
          <p className="text-sm text-ink-faint">No characters yet.</p>
        ) : (
          characters.map((c) => (
            <div key={c.id} className="flex items-center gap-3 bg-panel rounded-md px-3 py-2">
              <UsersIcon size={14} className="text-ink-dim flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-ink">{c.name}</p>
                <p className="text-xs text-ink-dim">
                  {c.ancestry} {c.class} &middot; lvl {c.level} &middot; {c.campaigns?.name || 'unknown campaign'}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmModal
        open={!!leaveTarget}
        onClose={() => setLeaveTarget(null)}
        onConfirm={confirmLeaveCampaign}
        title="Leave campaign?"
        message={
          leaveTarget
            ? `You'll leave "${leaveTarget.campaigns.name}". You can rejoin later if it's public or you have the join code.`
            : ''
        }
        confirmLabel="Leave"
        confirmVariant="danger"
        confirming={!!leaveTarget && leavingId === leaveTarget.campaign_id}
      />

      <Modal open={!!gmBlocked} onClose={() => setGmBlocked(null)} title="You're the GM">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-dim">
            {gmBlocked
              ? `You're the GM of "${gmBlocked.campaigns.name}" -- leaving would strand it with no GM. There's no GM-transfer or campaign-delete option yet, so for now only players can leave.`
              : ''}
          </p>
          <div className="flex justify-end">
            <Button onClick={() => setGmBlocked(null)}>Got it</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
