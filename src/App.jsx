import { useState } from 'react'
import SignIn from './components/SignIn.jsx'
import Lobby from './components/Lobby.jsx'
import CharacterPicker from './components/CharacterPicker.jsx'
import GameTable from './components/GameTable.jsx'
import GmDashboard from './components/GmDashboard.jsx'

// No routing library or real auth yet on purpose -- this is a click-through
// prototype with mock data. Swap this for real routing + Supabase auth/state
// once the screens are locked in.
export default function App() {
  const [view, setView] = useState('signin') // 'signin' | 'lobby' | 'characters' | 'table' | 'gm'
  const [activeCampaign, setActiveCampaign] = useState(null)

  const signedIn = () => setView('lobby')

  const enterCampaign = (id) => {
    setActiveCampaign(id)
    setView('characters')
  }

  const chooseCharacter = () => {
    setView('table')
  }

  const campaignName = activeCampaign === 'barrowfield' ? 'Barrowfield' : 'The sunken keep'

  return (
    <div className="min-h-screen bg-neutral-950">
      {view === 'signin' && <SignIn onSignedIn={signedIn} />}
      {view === 'lobby' && <Lobby onEnterCampaign={enterCampaign} />}
      {view === 'characters' && (
        <CharacterPicker campaignName={campaignName} onChooseCharacter={chooseCharacter} />
      )}
      {view === 'table' && (
        <GameTable campaignName={campaignName} onOpenGmView={() => setView('gm')} />
      )}
      {view === 'gm' && (
        <GmDashboard campaignName={campaignName} onSwitchToPlayerView={() => setView('table')} />
      )}

      {view !== 'signin' && view !== 'lobby' && (
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
