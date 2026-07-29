const SIMPLE_PATHS = {
  lobby: '/',
  profile: '/profile',
  'campaign-builder': '/campaigns/new',
}

const CAMPAIGN_PATHS = {
  'campaign-lobby': '',
  characters: '/characters',
  builder: '/characters/new',
  table: '/table',
  gm: '/gm',
  settings: '/settings',
  log: '/log',
  library: '/library',
  tracker: '/tracker',
}

function safeSegment(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}

export function parseAppPath(pathname = '/') {
  const parts = pathname.split('/').filter(Boolean).map(safeSegment)
  if (parts.length === 0) return { view: 'lobby', campaignId: null, characterId: null }
  if (parts.length === 1 && parts[0] === 'profile') {
    return { view: 'profile', campaignId: null, characterId: null }
  }
  if (parts[0] !== 'campaigns') {
    return { view: 'lobby', campaignId: null, characterId: null }
  }
  if (parts.length === 2 && parts[1] === 'new') {
    return { view: 'campaign-builder', campaignId: null, characterId: null }
  }

  const campaignId = parts[1] || null
  if (!campaignId) return { view: 'lobby', campaignId: null, characterId: null }
  if (parts.length === 2) return { view: 'campaign-lobby', campaignId, characterId: null }
  if (parts.length === 3 && parts[2] === 'characters') {
    return { view: 'characters', campaignId, characterId: null }
  }
  if (parts.length === 4 && parts[2] === 'characters' && parts[3] === 'new') {
    return { view: 'builder', campaignId, characterId: null }
  }
  if (parts.length === 4 && parts[2] === 'characters') {
    return { view: 'sheet', campaignId, characterId: parts[3] }
  }

  const campaignView = Object.entries(CAMPAIGN_PATHS)
    .find(([, suffix]) => suffix === `/${parts[2]}`)?.[0]
  return campaignView
    ? { view: campaignView, campaignId, characterId: null }
    : { view: 'campaign-lobby', campaignId, characterId: null }
}

export function pathForView(view, { campaignId = null, characterId = null } = {}) {
  if (SIMPLE_PATHS[view]) return SIMPLE_PATHS[view]
  if (!campaignId) return '/'
  const campaignBase = `/campaigns/${encodeURIComponent(campaignId)}`
  if (view === 'sheet' && characterId) {
    return `${campaignBase}/characters/${encodeURIComponent(characterId)}`
  }
  const suffix = CAMPAIGN_PATHS[view]
  return suffix == null ? campaignBase : `${campaignBase}${suffix}`
}

export function routeNeedsCampaign(view) {
  return Object.hasOwn(CAMPAIGN_PATHS, view) || view === 'sheet'
}
