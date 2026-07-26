import { useState, useEffect } from 'react'
import { supabase } from './lib/supabaseClient.js'
import SignIn from './components/SignIn.jsx'
import Lobby from './components/Lobby.jsx'
import CharacterPicker from './components/CharacterPicker.jsx'
import CharacterBuilder from './components/CharacterBuilder.jsx'
import GameTable from './components/GameTable.jsx'
import GmDashboard from './components/GmDashboard.jsx'
import Profile from './components/Profile.jsx'

// Everything is real Supabase now: auth, lobby, characters, profile, the
// map, scene log, dice, turn order, votes, and the GM's encounter/notes
// trackers. mockData.js is no longer used anywhere.
export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading, null = signed out
  const [view, setView] = useState('lobby') // 'lobby' | 'characters' | 'builder' | 'table' | 'gm' | 'profile'
  const [activeCampaign, setActiveCampaign] = useState(null) // real campaign row from Supabase
  const [activeCharacter, setActiveCharacter] = useState(null) // real character row from Supabase

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const signOut = () => supabase.auth.signOut()

  const enterCampaign = (campaign) => {
    setActiveCampaign(campaign)
    setView('characters')
  }

  const chooseCharacter = async ({ mode, characterId } = {}) => {
    if (mode === 'create') {
      setView('builder')
      return
    }
    if (characterId) {
      const { data } = await supabase.from('characters').select('*').eq('id', characterId).maybeSingle()
      setActiveCharacter(data || null)
    }
    setView('table')
  }

  const finishBuilding = (character) => {
    setActiveCharacter(character)
    setView('table')
  }

  const campaignName = activeCampaign?.name || ''

  // Still resolving whether a session exists -- avoid flashing the sign-in
  // screen for a returning, already-authenticated user.
  if (session === undefined) {
    return <div className="min-h-screen bg-neutral-950" />
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-neutral-950">
        <SignIn />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      {view === 'lobby' && (
        <Lobby
          session={session}
          onEnterCampaign={enterCampaign}
          onSignOut={signOut}
          onOpenProfile={() => setView('profile')}
        />
      )}
      {view === 'profile' && (
        <Profile session={session} onSignOut={signOut} onBack={() => setView('lobby')} />
      )}
      {view === 'characters' && (
        <CharacterPicker
          campaignId={activeCampaign?.id}
          session={session}
          campaignName={campaignName}
          onChooseCharacter={chooseCharacter}
        />
      )}
      {view === 'builder' && (
        <CharacterBuilder
          campaignId={activeCampaign?.id}
          session={session}
          campaignName={campaignName}
          onComplete={finishBuilding}
        />
      )}
      {view === 'table' && (
        <GameTable campaignId={activeCampaign?.id} session={session} campaignName={campaignName} onOpenGmView={() => setView('gm')} />
      )}
      {view === 'gm' && (
        <GmDashboard campaignId={activeCampaign?.id} campaignName={campaignName} onSwitchToPlayerView={() => setView('table')} />
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
