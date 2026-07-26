import { useState, useEffect } from 'react'
import { Dices } from 'lucide-react'
import MapGrid from './MapGrid.jsx'
import { supabase } from '../lib/supabaseClient.js'

const dice = [20, 12, 10, 8, 6, 4]
const VOTE_POLL_KEY = 'where-next'
const VOTE_OPTIONS = [
  { key: 'vault', label: 'Vault' },
  { key: 'entry', label: 'Back to entry' },
]

function hpBarColor(hp, maxHp) {
  const pct = maxHp ? hp / maxHp : 0
  if (pct > 0.6) return 'bg-green-500'
  if (pct > 0.3) return 'bg-amber-500'
  return 'bg-red-500'
}

// Everything here is real Supabase data now, synced live for the whole
// table: the scene log, dice rolls (app-rolled and self-reported, tagged
// per the honor-system design), the map, turn order, the "where to next?"
// vote, and the party's HP/AC cards.
export default function GameTable({ campaignId, session, campaignName = 'The sunken keep', onOpenGmView }) {
  const user = session?.user
  const [displayName, setDisplayName] = useState('')
  const [isGm, setIsGm] = useState(false)

  const [tab, setTab] = useState('map') // 'log' | 'map'
  const [log, setLog] = useState([])
  const [message, setMessage] = useState('')
  const [manualDie, setManualDie] = useState(20)
  const [manualValue, setManualValue] = useState('')

  const [mapInfo, setMapInfo] = useState(null)
  const [cellState, setCellState] = useState({})
  const [turnOrder, setTurnOrder] = useState([])
  const [votes, setVotes] = useState([])
  const [party, setParty] = useState([])

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || user.email || 'You'))
  }, [user])

  // Only the GM can unfog the map -- everyone else sees a read-only view.
  useEffect(() => {
    if (!user || !campaignId) return
    supabase
      .from('campaign_members')
      .select('role')
      .eq('campaign_id', campaignId)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setIsGm(data?.role === 'gm'))
  }, [user, campaignId])

  const reloadVotes = (campaignIdArg) => {
    supabase
      .from('votes')
      .select('option_key, voter_user_id')
      .eq('campaign_id', campaignIdArg)
      .eq('poll_key', VOTE_POLL_KEY)
      .then(({ data }) => setVotes(data || []))
  }

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false

    supabase
      .from('scene_log')
      .select('id, type, sender_name, text, roll_source, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setLog(data || []) })

    supabase
      .from('campaigns')
      .select('map_url, map_cols, map_rows, party_row, party_col')
      .eq('id', campaignId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setMapInfo(data) })

    supabase
      .from('map_cells')
      .select('row, col, state')
      .eq('campaign_id', campaignId)
      .then(({ data }) => {
        if (cancelled) return
        const next = {}
        for (const cell of data || []) next[`${cell.row},${cell.col}`] = cell.state
        setCellState(next)
      })

    supabase
      .from('turn_order')
      .select('order_list')
      .eq('campaign_id', campaignId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setTurnOrder(data?.order_list || []) })

    reloadVotes(campaignId)

    supabase
      .from('characters')
      .select('id, name, class, level, hp, max_hp, ac')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .then(({ data }) => { if (!cancelled) setParty(data || []) })

    const channel = supabase
      .channel(`game-table-${campaignId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scene_log', filter: `campaign_id=eq.${campaignId}` },
        (payload) => setLog((l) => [...l, payload.new])
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'map_cells', filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          const row = payload.new
          if (!row) return
          setCellState((s) => ({ ...s, [`${row.row},${row.col}`]: row.state }))
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
        { event: '*', schema: 'public', table: 'votes', filter: `campaign_id=eq.${campaignId}` },
        () => reloadVotes(campaignId)
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
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [campaignId])

  const revealCell = async (row, col) => {
    if (!campaignId) return
    setCellState((s) => ({ ...s, [`${row},${col}`]: 'explored' }))
    await supabase
      .from('map_cells')
      .upsert({ campaign_id: campaignId, row, col, state: 'explored' }, { onConflict: 'campaign_id,row,col' })
  }

  const postToLog = async (entry) => {
    if (!campaignId) return
    await supabase
      .from('scene_log')
      .insert({ campaign_id: campaignId, sender_user_id: user?.id, sender_name: displayName || 'You', ...entry })
  }

  const sendMessage = () => {
    if (!message.trim()) return
    postToLog({ type: 'chat', text: message.trim() })
    setMessage('')
  }

  const rollDie = (sides) => {
    const value = Math.floor(Math.random() * sides) + 1
    postToLog({ type: 'roll', text: `rolled a ${value} (d${sides})`, roll_source: 'app' })
  }

  const logManualRoll = () => {
    if (!manualValue) return
    postToLog({ type: 'roll', text: `rolled a ${manualValue} (d${manualDie})`, roll_source: 'self' })
    setManualValue('')
  }

  const vote = async (optionKey) => {
    if (!campaignId || !user) return
    const option = VOTE_OPTIONS.find((o) => o.key === optionKey)
    await supabase
      .from('votes')
      .upsert(
        {
          campaign_id: campaignId,
          poll_key: VOTE_POLL_KEY,
          option_key: optionKey,
          option_label: option.label,
          voter_user_id: user.id,
        },
        { onConflict: 'campaign_id,poll_key,voter_user_id' }
      )
  }

  const voteCounts = VOTE_OPTIONS.reduce((acc, o) => {
    acc[o.key] = votes.filter((v) => v.option_key === o.key).length
    return acc
  }, {})
  const myVote = votes.find((v) => v.voter_user_id === user?.id)?.option_key

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <p className="text-white font-medium">{campaignName}</p>
        </div>
        {onOpenGmView && (
          <button onClick={onOpenGmView} className="text-xs border border-neutral-700 rounded-md px-2.5 py-1 text-neutral-300 hover:bg-neutral-800">
            GM view
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3 mb-3">
        <div className="bg-neutral-900 rounded-lg p-4">
          <div className="flex gap-1.5 mb-2.5">
            <button
              onClick={() => setTab('log')}
              className={`text-xs px-2.5 py-1 rounded ${tab === 'log' ? 'bg-neutral-800 border border-neutral-600 text-white' : 'text-neutral-400'}`}
            >
              Scene log
            </button>
            <button
              onClick={() => setTab('map')}
              className={`text-xs px-2.5 py-1 rounded ${tab === 'map' ? 'bg-neutral-800 border border-neutral-600 text-white' : 'text-neutral-400'}`}
            >
              Map
            </button>
          </div>

          {tab === 'log' && (
            <div className="h-[260px] overflow-y-auto flex flex-col gap-2.5 text-sm pr-1">
              {log.length === 0 && <p className="text-xs text-neutral-500">No messages yet -- say something below.</p>}
              {log.map((entry) => {
                if (entry.type === 'narration') {
                  return <p key={entry.id} className="italic text-neutral-400">{entry.text}</p>
                }
                if (entry.type === 'gm') {
                  return (
                    <p key={entry.id}>
                      <span className="font-medium text-blue-400">{entry.sender_name}:</span>{' '}
                      <span className="text-neutral-300">{entry.text}</span>
                    </p>
                  )
                }
                if (entry.type === 'roll') {
                  return (
                    <p key={entry.id} className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-white">{entry.sender_name}:</span>
                      <span className="text-neutral-300">{entry.text}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          entry.roll_source === 'app'
                            ? 'bg-blue-500/20 text-blue-300'
                            : 'bg-neutral-800 border border-neutral-700 text-neutral-400'
                        }`}
                      >
                        {entry.roll_source === 'app' ? 'app roll' : 'self-reported'}
                      </span>
                    </p>
                  )
                }
                return (
                  <p key={entry.id}>
                    <span className="font-medium text-white">{entry.sender_name}:</span>{' '}
                    <span className="text-neutral-300">{entry.text}</span>
                  </p>
                )
              })}
            </div>
          )}

          {tab === 'map' && (
            <div>
              <MapGrid
                mapUrl={mapInfo?.map_url}
                cols={mapInfo?.map_cols || 10}
                rows={mapInfo?.map_rows || 6}
                cellState={cellState}
                partyRow={mapInfo?.party_row}
                partyCol={mapInfo?.party_col}
                mode={isGm ? 'reveal' : 'view'}
                onCellClick={isGm ? (r, c) => revealCell(r, c) : undefined}
              />
              <div className="flex items-center gap-3.5 mt-2 text-[10px] text-neutral-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-neutral-300 inline-block" /> Explored</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-neutral-700 inline-block" /> Fog, not yet seen</span>
              </div>
              <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-neutral-800">
                <span className="text-xs text-neutral-400">Where to next?</span>
                <div className="flex gap-1.5">
                  {VOTE_OPTIONS.map((o) => (
                    <button
                      key={o.key}
                      onClick={() => vote(o.key)}
                      className={`text-xs border rounded-md px-2 py-1 flex items-center gap-1.5 hover:bg-neutral-800 ${
                        myVote === o.key ? 'border-blue-500 text-blue-200' : 'border-neutral-700 text-neutral-200'
                      }`}
                    >
                      {o.label}{' '}
                      <span className="text-[10px] px-1.5 rounded-full bg-blue-500/20 text-blue-300">{voteCounts[o.key]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-neutral-800">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Say or do something"
              className="flex-1 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-white"
            />
            <button onClick={sendMessage} className="text-sm border border-neutral-700 rounded-md px-3 py-1.5 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800">
              <Dices size={15} /> Send
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="bg-neutral-900 rounded-lg p-3">
            <p className="text-xs text-neutral-400 mb-2">Turn order</p>
            {turnOrder.length === 0 ? (
              <p className="text-xs text-neutral-500">Not set yet -- the GM rolls initiative to start.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {turnOrder.map((t, i) => (
                  <div
                    key={t.id || i}
                    className={`flex items-center justify-between text-xs px-2 py-1.5 rounded ${
                      t.status === 'acting' ? 'bg-blue-500/20 text-blue-300 font-medium' : 'text-neutral-300'
                    }`}
                  >
                    <span>{t.name}</span>
                    <span className={t.status === 'acting' ? '' : 'text-neutral-500'}>{t.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-neutral-900 rounded-lg p-3">
            <p className="text-xs text-neutral-400 mb-2">Roll a die</p>
            <div className="grid grid-cols-3 gap-1.5 mb-2.5">
              {dice.map((sides) => (
                <button
                  key={sides}
                  onClick={() => rollDie(sides)}
                  className="text-xs py-1.5 border border-neutral-700 rounded-md text-neutral-200 hover:bg-neutral-800"
                >
                  d{sides}
                </button>
              ))}
            </div>
            <div className="pt-2.5 border-t border-neutral-800">
              <p className="text-[11px] text-neutral-500 mb-1.5">Rolled it yourself? Log it here.</p>
              <div className="flex gap-1.5">
                <select
                  value={manualDie}
                  onChange={(e) => setManualDie(e.target.value)}
                  className="w-14 text-xs bg-neutral-950 border border-neutral-700 rounded-md px-1 py-1 text-white"
                >
                  {dice.map((d) => (
                    <option key={d} value={d}>d{d}</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={manualValue}
                  onChange={(e) => setManualValue(e.target.value)}
                  placeholder="14"
                  className="w-14 text-xs bg-neutral-950 border border-neutral-700 rounded-md px-1.5 py-1 text-white"
                />
                <button onClick={logManualRoll} className="flex-1 text-xs border border-neutral-700 rounded-md text-neutral-200 hover:bg-neutral-800">
                  Log
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-neutral-400 mb-2">Party</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {party.length === 0 && (
          <p className="text-xs text-neutral-500 sm:col-span-3">No characters in this campaign yet.</p>
        )}
        {party.map((p) => (
          <div key={p.id} className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-white">{p.name}</span>
            </div>
            <p className="text-[11px] text-neutral-400 mb-2">
              {p.class} &middot; lvl {p.level}
            </p>
            <div className="h-1.5 rounded-full bg-red-900/40 overflow-hidden">
              <div
                className={`h-full ${hpBarColor(p.hp, p.max_hp)}`}
                style={{ width: `${p.max_hp ? (p.hp / p.max_hp) * 100 : 0}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500 mt-1">
              <span>{p.hp}/{p.max_hp} hp</span>
              <span>ac {p.ac}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
