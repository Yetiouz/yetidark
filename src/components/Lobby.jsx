import { useState } from 'react'
import { Swords, Key, Plus, Crown, Bot, Users, LogOut } from 'lucide-react'
import { campaigns, currentUser } from '../mockData.js'

export default function Lobby({ onEnterCampaign, onSignOut }) {
  const [joinCode, setJoinCode] = useState('')
  const [showJoin, setShowJoin] = useState(false)

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
          <span className="text-sm text-neutral-400">{currentUser.name}</span>
          <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-medium text-blue-300">
            {currentUser.initial}
          </div>
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
          <button className="text-sm border border-neutral-700 rounded-md px-3 py-1.5 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800">
            <Plus size={15} /> New campaign
          </button>
        </div>
      </div>

      {showJoin && (
        <div className="mb-4 flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="Enter join code"
            className="flex-1 bg-neutral-900 border border-neutral-700 rounded-md px-3 py-2 text-sm text-white"
          />
          <button className="text-sm border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 hover:bg-neutral-800">
            Join
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {campaigns.map((c) => (
          <div key={c.id} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-white font-medium">{c.name}</p>
              {c.status === 'live' ? (
                <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">Live now</span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">AI GM</span>
              )}
            </div>
            <p className="text-sm text-neutral-400 mb-3">
              {c.system} &middot; session {c.session}
            </p>
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-3">
              <span className="flex items-center gap-1.5">
                {c.gm.type === 'human' ? <Crown size={14} /> : <Bot size={14} />}
                {c.gm.type === 'human' ? `${c.gm.name} is GM` : 'AI is running this one'}
              </span>
              <span className="flex items-center gap-1">
                <Users size={14} /> {c.playerCount}
              </span>
            </div>
            <button
              onClick={() => onEnterCampaign(c.id)}
              className="w-full text-sm border border-neutral-700 rounded-md py-2 text-neutral-100 hover:bg-neutral-800"
            >
              Jump in
            </button>
          </div>
        ))}

        <div className="border border-dashed border-neutral-700 rounded-xl p-4 flex flex-col items-center justify-center gap-2 min-h-[150px]">
          <Plus size={22} className="text-neutral-500" />
          <p className="text-sm text-neutral-400">Start a new campaign</p>
          <button className="text-sm border border-neutral-700 rounded-md px-3 py-1.5 text-neutral-200 hover:bg-neutral-800">
            Create
          </button>
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-neutral-800">
        <p className="text-xs text-neutral-500">
          Invite friends by sharing a campaign's join code from inside the session.
        </p>
      </div>
    </div>
  )
}
