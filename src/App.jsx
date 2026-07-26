import { useState } from 'react'
import Lobby from './components/Lobby.jsx'
import GameTable from './components/GameTable.jsx'
import GmDashboard from './components/GmDashboard.jsx'

// No routing library yet on purpose -- this is a click-through prototype
// with mock data. Swap this for real routing + Supabase auth/state once
// the screens are locked in.
export default function App() {
  const [view, setView] = useState('lobby') // 'lobby' | 'table' | 'gm'
  const [activeCampaign, setActiveCampaign] = useState(null)

  const enterCampaign = (id) => {
    setActiveCampaign(id)
    setView('table')
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      {view === 'lobby' && <Lobby onEnterCampaign={enterCampaign} />}
      {view === 'table' && (
        <GameTable
          campaignName={activeCampaign === 'barrowfield' ? 'Barrowfield' : 'The sunken keep'}
          onOpenGmView={() => setView('gm')}
        />
      )}
      {view === 'gm' && (
        <GmDashboard
          campaignName={activeCampaign === 'barrowfield' ? 'Barrowfield' : 'The sunken keep'}
          onSwitchToPlayerView={() => setView('table')}
        />
      )}

      {view !== 'lobby' && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2">
          <button
            onClick={() => setView('lobby')}
            className="text-xs bg-neutral-900 border border-neutral-700 rounded-full px-3 py-1.5 text-neutral-300 hover:bg-neutral-800"
          >
            Back to lobby
          </button>
        </div>
      )}
    </div>
  )
}
