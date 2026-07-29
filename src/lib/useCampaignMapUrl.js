import { useEffect, useState } from 'react'

import { supabase } from './supabaseClient.js'

const SIGNED_URL_TTL_SECONDS = 60 * 60
const SIGNED_URL_REFRESH_MS = 50 * 60 * 1000
const LEGACY_PUBLIC_MAP_MARKER = '/storage/v1/object/public/maps/'

function legacyMapPath(mapUrl) {
  if (!mapUrl) return null
  const markerIndex = mapUrl.indexOf(LEGACY_PUBLIC_MAP_MARKER)
  if (markerIndex === -1) return null

  const encodedPath = mapUrl.slice(markerIndex + LEGACY_PUBLIC_MAP_MARKER.length)
  try {
    return decodeURIComponent(encodedPath)
  } catch {
    return encodedPath
  }
}

export function campaignMapPath(mapInfo) {
  return mapInfo?.map_path || legacyMapPath(mapInfo?.map_url)
}

export function useCampaignMapUrl(mapInfo) {
  const path = campaignMapPath(mapInfo)
  const [state, setState] = useState({ path: null, url: null, error: null })

  useEffect(() => {
    let cancelled = false
    let refreshTimer

    if (!path) {
      setState({ path: null, url: null, error: null })
      return () => {}
    }

    setState({ path, url: null, error: null })

    const signMapUrl = async () => {
      const { data, error } = await supabase.storage
        .from('maps')
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

      if (cancelled) return
      if (error) {
        setState({ path, url: null, error: error.message })
        return
      }

      setState({ path, url: data.signedUrl, error: null })
      refreshTimer = window.setTimeout(signMapUrl, SIGNED_URL_REFRESH_MS)
    }

    signMapUrl()

    return () => {
      cancelled = true
      if (refreshTimer) window.clearTimeout(refreshTimer)
    }
  }, [path])

  return state
}
