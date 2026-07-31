import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient.js'
import { appendUniqueById } from '../app/realtimeCollections.js'

// Shared by GameTable.jsx (players) and GmDashboard.jsx (GM): both screens
// fetch-then-subscribe to the same six tables in lockstep -- scene log,
// the campaign row, turn order, party characters, clocks, and light
// sources -- with identical realtime wiring. Screen-specific data stays
// local to each screen instead of being forced in here, since the two
// screens read (and sometimes write) it very differently:
//   - campaign_threads: GameTable-only (status rail "objective").
//   - encounter_monsters: GameTable reads a read-only subset for the map
//     overlay and Attack panel; GmDashboard reads a richer subset (ac,
//     dex_mod) and writes hp/hidden/zone. Different enough that a shared
//     shape would need more config than it'd save.
//   - gm_notes: GameTable only ever sees *revealed* notes (a fixed
//     `.eq('revealed', true)` filter); GmDashboard reads and writes all
//     of them, revealed or not. Genuinely different queries, not the same
//     data viewed two ways.
// Each screen keeps its own second realtime channel for its own extra
// tables -- two channels per screen instead of one, but each channel's
// subscription list matches exactly what that screen actually needs.
//
// `party`'s realtime handler applies both INSERT and UPDATE. Before this
// hook, GmDashboard's characters subscription only ever handled INSERT --
// another player's live HP/AC change never reached the GM's Party panel
// without a manual refresh. That's the same drift bug this hook's
// characters handling already fixed for GameTable a while back; folding
// GmDashboard onto the same hook fixes it there too, for free, rather
// than re-shipping a GM dashboard that quietly drops UPDATEs again.
export function useCampaignSession(campaignId, { channelKey = 'campaign-session', onSceneLogInsert } = {}) {
  const [log, setLog] = useState([])
  const [mapInfo, setMapInfo] = useState(null)
  const [turnOrder, setTurnOrder] = useState([])
  const [party, setParty] = useState([])
  const [clocks, setClocks] = useState([])
  const [lightSources, setLightSources] = useState([])

  // Kept current every render (no deps) so the realtime handler set up
  // once below -- closed over campaignId/channelKey only -- always calls
  // the latest onSceneLogInsert, the same ref-mirror pattern GameTable
  // already uses for askAiGmRef. Without this, a caller-supplied callback
  // would close over whatever props/state existed the render this effect
  // first ran, not the current ones.
  const onSceneLogInsertRef = useRef(onSceneLogInsert)
  useEffect(() => {
    onSceneLogInsertRef.current = onSceneLogInsert
  })

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false

    supabase
      .from('scene_log')
      .select('id, type, sender_user_id, sender_name, text, roll_source, dice_roll_id, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setLog(data || []) })

    supabase
      .from('campaigns')
      .select('map_path, map_url, map_cols, map_rows, party_row, party_col, gm_type')
      .eq('id', campaignId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setMapInfo(data) })

    supabase
      .from('turn_order')
      .select('order_list')
      .eq('campaign_id', campaignId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setTurnOrder(data?.order_list || []) })

    supabase
      .from('characters')
      .select('id, name, class, level, hp, max_hp, ac, avatar_url, color, zone, owner_user_id, status, death_timer, stats')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setParty(data || []) })

    supabase
      .from('campaign_clocks')
      .select('id, name, segments_filled, segments_total, created_at')
      .eq('campaign_id', campaignId)
      .then(({ data }) => { if (!cancelled) setClocks(data || []) })

    supabase
      .from('campaign_light_sources')
      .select('id, name, character_id, lit, lit_at, remaining_minutes, total_minutes')
      .eq('campaign_id', campaignId)
      .then(({ data }) => { if (!cancelled) setLightSources(data || []) })

    const channel = supabase
      .channel(`${channelKey}-${campaignId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scene_log', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          setLog((l) => (l.some((e) => e.id === payload.new.id) ? l : [...l, payload.new]))
          onSceneLogInsertRef.current?.(payload.new)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${campaignId}` },
        (payload) => setMapInfo(payload.new)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'turn_order', filter: `campaign_id=eq.${campaignId}` },
        (payload) => setTurnOrder(payload.new?.order_list || [])
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'characters', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setParty((p) => [...p, payload.new])
          } else if (payload.eventType === 'UPDATE') {
            setParty((p) => p.map((c) => (c.id === payload.new.id ? payload.new : c)))
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'campaign_clocks', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setClocks((c) => appendUniqueById(c, payload.new))
          else if (payload.eventType === 'UPDATE') setClocks((c) => c.map((x) => (x.id === payload.new.id ? payload.new : x)))
          else if (payload.eventType === 'DELETE') setClocks((c) => c.filter((x) => x.id !== payload.old.id))
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'campaign_light_sources', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') setLightSources((l) => appendUniqueById(l, payload.new))
          else if (payload.eventType === 'UPDATE') setLightSources((l) => l.map((x) => (x.id === payload.new.id ? payload.new : x)))
          else if (payload.eventType === 'DELETE') setLightSources((l) => l.filter((x) => x.id !== payload.old.id))
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [campaignId, channelKey])

  return {
    log, setLog,
    mapInfo, setMapInfo,
    turnOrder, setTurnOrder,
    party, setParty,
    clocks, setClocks,
    lightSources, setLightSources,
  }
}

// Same fetch-once-on-user-change pattern GameTable and GmDashboard each
// had inline, differing only in their fallback ('You' vs 'GM').
export function useProfileDisplayName(user, fallback) {
  const [displayName, setDisplayName] = useState(fallback)

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || user.email || fallback))
  }, [user, fallback])

  return displayName
}
