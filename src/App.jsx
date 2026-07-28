import { useState, useEffect } from 'react'
import { supabase } from './lib/supabaseClient.js'
import SignIn from './components/SignIn.jsx'
import Lobby from './components/Lobby.jsx'
import CampaignBuilder from './components/CampaignBuilder.jsx'
import CharacterPicker from './components/CharacterPicker.jsx'
import CharacterBuilder from './components/CharacterBuilder.jsx'
import CharacterSheet from './components/CharacterSheet.jsx'
import CampaignSettings from './components/CampaignSettings.jsx'
import CampaignLog from './components/CampaignLog.jsx'
import RulesLibrary from './components/RulesLibrary.jsx'
import CampaignTracker from './components/CampaignTracker.jsx'
import GameTable from './components/GameTable.jsx'
import GmDashboard from './components/GmDashboard.jsx'
import Profile from './components/Profile.jsx'

// Everything is real Supabase now: auth, lobby, characters, profile, the
// map, scene log, dice, turn order, votes, and the GM's encounter/notes
// trackers. mockData.js is no longer used anywhere.
export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading, null = signed out
  const [view, setView] = useState('lobby') // 'lobby' | 'campaign-builder' | 'characters' | 'builder' | 'table' | 'gm' | 'profile' | 'sheet' | 'settings' | 'log' | 'library' | 'tracker'
  const [activeCampaign, setActiveCampaign] = useState(null) // real campaign row from Supabase
  const [activeCharacter, setActiveCharacter] = useState(null) // real character row from Supabase
  const [viewingCharacterId, setViewingCharacterId] = useState(null) // which character's full sheet is open
  const [sheetReturnView, setSheetReturnView] = useState('table') // where "Back" on the sheet should go
  const [settingsReturnView, setSettingsReturnView] = useState('table') // where "Back" on campaign settings should go
  const [logReturnView, setLogReturnView] = useState('table') // where "Back" on the campaign log should go
  const [libraryReturnView, setLibraryReturnView] = useState('table') // where "Back" on the rules library should go
  const [trackerReturnView, setTrackerReturnView] = useState('table') // where "Back" on the NPC/faction/treasure tracker should go

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

  // Opens a character's full sheet from wherever the player or GM clicked
  // it (a party card on the table or the GM dashboard) -- "Back" returns
  // to whichever view triggered it.
  const openCharacterSheet = (characterId, fromView) => {
    setViewingCharacterId(characterId)
    setSheetReturnView(fromView)
    setView('sheet')
  }

  // Same "remember where you came from" pattern as the character sheet --
  // the gear icon lives on both GameTable and GmDashboard, so "Back" needs
  // to return to whichever one opened it.
  const openCampaignSettings = (fromView) => {
    setSettingsReturnView(fromView)
    setView('settings')
  }

  // Same pattern again for the campaign log (threads/clocks/timeline).
  const openCampaignLog = (fromView) => {
    setLogReturnView(fromView)
    setView('log')
  }

  // Same pattern again for the rules library.
  const openRulesLibrary = (fromView) => {
    setLibraryReturnView(fromView)
    setView('library')
  }

  // Same pattern again for the NPC/faction/treasure tracker.
  const openTracker = (fromView) => {
    setTrackerReturnView(fromView)
    setView('tracker')
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
          onCreateCampaign={() => setView('campaign-builder')}
          onSignOut={signOut}
          onOpenProfile={() => setView('profile')}
        />
      )}
      {view === 'campaign-builder' && (
        <CampaignBuilder session={session} onComplete={enterCampaign} onCancel={() => setView('lobby')} />
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
        <GameTable
          campaignId={activeCampaign?.id}
          session={session}
          campaignName={campaignName}
          onOpenGmView={() => setView('gm')}
          onOpenCharacterSheet={(characterId) => openCharacterSheet(characterId, 'table')}
          onOpenSettings={() => openCampaignSettings('table')}
          onOpenLog={() => openCampaignLog('table')}
          onOpenLibrary={() => openRulesLibrary('table')}
          onOpenTracker={() => openTracker('table')}
        />
      )}
      {view === 'gm' && (
        <GmDashboard
          campaignId={activeCampaign?.id}
          session={session}
          campaignName={campaignName}
          onSwitchToPlayerView={() => setView('table')}
          onOpenCharacterSheet={(characterId) => openCharacterSheet(characterId, 'gm')}
          onOpenSettings={() => openCampaignSettings('gm')}
          onOpenLog={() => openCampaignLog('gm')}
          onOpenLibrary={() => openRulesLibrary('gm')}
          onOpenTracker={() => openTracker('gm')}
        />
      )}
      {view === 'sheet' && (
        <CharacterSheet
          characterId={viewingCharacterId}
          session={session}
          onBack={() => setView(sheetReturnView)}
        />
      )}
      {view === 'settings' && (
        <CampaignSettings
          campaignId={activeCampaign?.id}
          session={session}
          campaignName={campaignName}
          onBack={() => setView(settingsReturnView)}
        />
      )}
      {view === 'log' && (
        <CampaignLog
          campaignId={activeCampaign?.id}
          session={session}
          campaignName={campaignName}
          onBack={() => setView(logReturnView)}
        />
      )}
      {view === 'library' && (
        <RulesLibrary
          campaignId={activeCampaign?.id}
          session={session}
          campaignName={campaignName}
          onBack={() => setView(libraryReturnView)}
        />
      )}
      {view === 'tracker' && (
        <CampaignTracker
          campaignId={activeCampaign?.id}
          session={session}
          campaignName={campaignName}
          onBack={() => setView(trackerReturnView)}
        />
      )}
      {view !== 'lobby' && view !== 'campaign-builder' && (
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
