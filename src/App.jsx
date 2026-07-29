import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabaseClient.js'
import { parseAppPath, pathForView, routeNeedsCampaign } from './app/routes.js'
import SignIn from './components/SignIn.jsx'
import Lobby from './components/Lobby.jsx'
import CampaignBuilder from './components/CampaignBuilder.jsx'
import CampaignLobby from './components/CampaignLobby.jsx'
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

const initialRoute = parseAppPath(window.location.pathname)

// Everything is real Supabase data. Navigation is also reflected in the URL,
// so campaign and character context survives refreshes and browser history.
export default function App() {
  const [session, setSession] = useState(undefined)
  const [view, setView] = useState(initialRoute.view)
  const [routeCampaignId, setRouteCampaignId] = useState(initialRoute.campaignId)
  const [activeCampaign, setActiveCampaign] = useState(null)
  const [activeCharacter, setActiveCharacter] = useState(null)
  const [viewingCharacterId, setViewingCharacterId] = useState(initialRoute.characterId)
  const [routeLoading, setRouteLoading] = useState(routeNeedsCampaign(initialRoute.view))
  const [sheetReturnView, setSheetReturnView] = useState('campaign-lobby')
  const [settingsReturnView, setSettingsReturnView] = useState('campaign-lobby')
  const [logReturnView, setLogReturnView] = useState('table')
  const [libraryReturnView, setLibraryReturnView] = useState('table')
  const [trackerReturnView, setTrackerReturnView] = useState('table')
  const historyIndexRef = useRef(0)

  const applyRoute = useCallback((route) => {
    setView(route.view)
    setRouteCampaignId(route.campaignId)
    setViewingCharacterId(route.characterId)
    setRouteLoading(routeNeedsCampaign(route.view))
    if (!route.campaignId) {
      setActiveCampaign(null)
      setActiveCharacter(null)
    }
  }, [])

  const navigateTo = useCallback((nextView, {
    campaignId,
    characterId,
    replace = false,
  } = {}) => {
    const nextCampaignId = campaignId ?? activeCampaign?.id ?? routeCampaignId
    const nextCharacterId = characterId ?? (nextView === 'sheet' ? viewingCharacterId : null)
    const route = {
      view: nextView,
      campaignId: routeNeedsCampaign(nextView) ? nextCampaignId : null,
      characterId: nextView === 'sheet' ? nextCharacterId : null,
    }
    const path = pathForView(nextView, route)
    const currentIndex = historyIndexRef.current
    if (replace) {
      window.history.replaceState({ delveIndex: currentIndex }, '', path)
    } else {
      historyIndexRef.current = currentIndex + 1
      window.history.pushState({ delveIndex: historyIndexRef.current }, '', path)
    }
    applyRoute(route)
  }, [activeCampaign?.id, routeCampaignId, viewingCharacterId, applyRoute])

  const navigateBack = useCallback((fallbackView) => {
    if (historyIndexRef.current > 0) {
      window.history.back()
    } else {
      navigateTo(fallbackView, { replace: true })
    }
  }, [navigateTo])

  useEffect(() => {
    const storedIndex = Number(window.history.state?.delveIndex)
    historyIndexRef.current = Number.isInteger(storedIndex) ? storedIndex : 0
    window.history.replaceState(
      { ...(window.history.state || {}), delveIndex: historyIndexRef.current },
      '',
      pathForView(initialRoute.view, initialRoute)
    )

    const onPopState = (event) => {
      const index = Number(event.state?.delveIndex)
      historyIndexRef.current = Number.isInteger(index) ? index : 0
      applyRoute(parseAppPath(window.location.pathname))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [applyRoute])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  // Restore the campaign and character rows named by a deep link. Every read
  // goes through RLS; an inaccessible or stale URL safely returns to the lobby.
  useEffect(() => {
    if (session === undefined) return
    if (!session || !routeNeedsCampaign(view)) {
      setRouteLoading(false)
      return
    }
    if (!routeCampaignId) {
      navigateTo('lobby', { replace: true })
      setRouteLoading(false)
      return
    }

    let cancelled = false
    setRouteLoading(true)
    const hydrate = async () => {
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', routeCampaignId)
        .maybeSingle()
      if (cancelled) return
      if (!campaign) {
        setRouteLoading(false)
        navigateTo('lobby', { replace: true })
        return
      }
      setActiveCampaign(campaign)

      if (view === 'gm') {
        const { data: membership } = await supabase
          .from('campaign_members')
          .select('role')
          .eq('campaign_id', routeCampaignId)
          .eq('user_id', session.user.id)
          .maybeSingle()
        if (cancelled) return
        if (membership?.role !== 'gm') {
          setRouteLoading(false)
          navigateTo('table', { campaignId: routeCampaignId, replace: true })
          return
        }
      }

      if (view === 'sheet') {
        const { data: character } = await supabase
          .from('characters')
          .select('*')
          .eq('id', viewingCharacterId)
          .eq('campaign_id', routeCampaignId)
          .maybeSingle()
        if (cancelled) return
        if (!character) {
          setRouteLoading(false)
          navigateTo('campaign-lobby', { campaignId: routeCampaignId, replace: true })
          return
        }
        setActiveCharacter(character)
      }
      setRouteLoading(false)
    }
    hydrate()
    return () => { cancelled = true }
  }, [session, view, routeCampaignId, viewingCharacterId, navigateTo])

  const signOut = () => supabase.auth.signOut()

  const enterCampaign = (campaign) => {
    setActiveCampaign(campaign)
    navigateTo('campaign-lobby', { campaignId: campaign.id })
  }

  const chooseCharacter = async ({ mode, characterId } = {}) => {
    if (mode === 'create') {
      navigateTo('builder')
      return
    }
    if (characterId) {
      const { data } = await supabase.from('characters').select('*').eq('id', characterId).maybeSingle()
      setActiveCharacter(data || null)
    }
    navigateTo('campaign-lobby')
  }

  const finishBuilding = (character) => {
    setActiveCharacter(character)
    navigateTo('campaign-lobby')
  }

  const startSession = (role) => {
    navigateTo(role === 'gm' ? 'gm' : 'table')
  }

  const openCharacterSheet = (characterId, fromView) => {
    setSheetReturnView(fromView)
    navigateTo('sheet', { characterId })
  }

  const openCampaignSettings = (fromView) => {
    setSettingsReturnView(fromView)
    navigateTo('settings')
  }

  const openCampaignLog = (fromView) => {
    setLogReturnView(fromView)
    navigateTo('log')
  }

  const openRulesLibrary = (fromView) => {
    setLibraryReturnView(fromView)
    navigateTo('library')
  }

  const openTracker = (fromView) => {
    setTrackerReturnView(fromView)
    navigateTo('tracker')
  }

  const campaignName = activeCampaign?.name || ''

  if (session === undefined || (session && routeLoading)) {
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
          onCreateCampaign={() => navigateTo('campaign-builder')}
          onSignOut={signOut}
          onOpenProfile={() => navigateTo('profile')}
        />
      )}
      {view === 'campaign-builder' && (
        <CampaignBuilder
          session={session}
          onComplete={enterCampaign}
          onCancel={() => navigateTo('lobby')}
        />
      )}
      {view === 'campaign-lobby' && (
        <CampaignLobby
          campaignId={activeCampaign?.id}
          session={session}
          onOpenCharacterSheet={(characterId) => openCharacterSheet(characterId, 'campaign-lobby')}
          onCreateCharacter={() => navigateTo('builder')}
          onChooseCharacter={() => navigateTo('characters')}
          onStartSession={startSession}
          onOpenSettings={() => openCampaignSettings('campaign-lobby')}
        />
      )}
      {view === 'profile' && (
        <Profile session={session} onSignOut={signOut} onBack={() => navigateBack('lobby')} />
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
          onOpenGmView={() => navigateTo('gm')}
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
          onSwitchToPlayerView={() => navigateTo('table')}
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
          onBack={() => navigateBack(sheetReturnView)}
        />
      )}
      {view === 'settings' && (
        <CampaignSettings
          campaignId={activeCampaign?.id}
          session={session}
          campaignName={campaignName}
          onBack={() => navigateBack(settingsReturnView)}
        />
      )}
      {view === 'log' && (
        <CampaignLog
          campaignId={activeCampaign?.id}
          session={session}
          campaignName={campaignName}
          onBack={() => navigateBack(logReturnView)}
        />
      )}
      {view === 'library' && (
        <RulesLibrary
          campaignId={activeCampaign?.id}
          session={session}
          campaignName={campaignName}
          onBack={() => navigateBack(libraryReturnView)}
        />
      )}
      {view === 'tracker' && (
        <CampaignTracker
          campaignId={activeCampaign?.id}
          session={session}
          campaignName={campaignName}
          onBack={() => navigateBack(trackerReturnView)}
        />
      )}
      {view !== 'lobby' && view !== 'campaign-builder' && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2">
          <button
            onClick={() => navigateTo('lobby')}
            className="text-xs bg-neutral-900 border border-neutral-700 rounded-full px-3 py-1.5 text-neutral-300 hover:bg-neutral-800"
          >
            Back to lobby
          </button>
        </div>
      )}
    </div>
  )
}
