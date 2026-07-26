import { useState } from 'react'
import { Shield, Flame, Dices } from 'lucide-react'
import HexMap from './HexMap.jsx'
import { party, turnOrder, initialSceneLog, initialHexGrid } from '../mockData.js'

const dice = [20, 12, 10, 8, 6, 4]

function hpBarColor(hp, maxHp) {
  const pct = hp / maxHp
  if (pct > 0.6) return 'bg-green-500'
  if (pct > 0.3) return 'bg-amber-500'
  return 'bg-red-500'
}

export default function GameTable({ campaignName = 'The sunken keep', onOpenGmView }) {
  const [tab, setTab] = useState('map') // 'log' | 'map'
  const [log, setLog] = useState(initialSceneLog)
  const [message, setMessage] = useState('')
  const [manualDie, setManualDie] = useState(20)
  const [manualValue, setManualValue] = useState('')
  const [grid, setGrid] = useState(initialHexGrid)
  const [votes, setVotes] = useState({ vault: 3, entry: 1 })

  const appendLog = (entry) => setLog((l) => [...l, entry])

  const sendMessage = () => {
    if (!message.trim()) return
    appendLog({ type: 'chat', name: 'You', text: message })
    setMessage('')
  }

  const rollDie = (sides) => {
    const value = Math.floor(Math.random() * sides) + 1
    appendLog({ type: 'roll', name: 'You', text: `rolled a ${value} (d${sides})`, source: 'app' })
  }

  const logManualRoll = () => {
    if (!manualValue) return
    appendLog({ type: 'roll', name: 'You', text: `rolled a ${manualValue} (d${manualDie})`, source: 'self' })
    setManualValue('')
  }

  const revealHex = (row, col) => {
    setGrid((g) => {
      const next = g.map((r) => r.slice())
      next[row][col] = { ...next[row][col], state: 'explored' }
      return next
    })
  }

  const vote = (key) => setVotes((v) => ({ ...v, [key]: v[key] + 1 }))

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <p className="text-white font-medium">{campaignName}</p>
          <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">Round 3</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex">
            <div className="w-7 h-7 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-xs font-medium border-2 border-neutral-950">Y</div>
            <div className="w-7 h-7 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center text-xs font-medium border-2 border-neutral-950 -ml-2">M</div>
            <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center text-xs font-medium border-2 border-neutral-950 -ml-2">J</div>
          </div>
          {onOpenGmView && (
            <button onClick={onOpenGmView} className="text-xs border border-neutral-700 rounded-md px-2.5 py-1 text-neutral-300 hover:bg-neutral-800">
              GM view
            </button>
          )}
        </div>
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
              {log.map((entry, i) => {
                if (entry.type === 'narration') {
                  return <p key={i} className="italic text-neutral-400">{entry.text}</p>
                }
                if (entry.type === 'gm') {
                  return (
                    <p key={i}>
                      <span className="font-medium text-blue-400">{entry.name}:</span>{' '}
                      <span className="text-neutral-300">{entry.text}</span>
                    </p>
                  )
                }
                if (entry.type === 'roll') {
                  return (
                    <p key={i} className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-white">{entry.name}:</span>
                      <span className="text-neutral-300">{entry.text}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          entry.source === 'app'
                            ? 'bg-blue-500/20 text-blue-300'
                            : 'bg-neutral-800 border border-neutral-700 text-neutral-400'
                        }`}
                      >
                        {entry.source === 'app' ? 'app roll' : 'self-reported'}
                      </span>
                    </p>
                  )
                }
                return (
                  <p key={i}>
                    <span className="font-medium text-white">{entry.name}:</span>{' '}
                    <span className="text-neutral-300">{entry.text}</span>
                  </p>
                )
              })}
            </div>
          )}

          {tab === 'map' && (
            <div>
              <HexMap grid={grid} onRevealHex={revealHex} allowManualReveal={true} />
              <div className="flex items-center gap-3.5 mt-2 text-[10px] text-neutral-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-700 inline-block" /> Explored</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-neutral-700 inline-block" /> Fog, not yet seen</span>
                <span className="flex items-center gap-1"><Shield size={10} /> Party position</span>
              </div>
              <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-neutral-800">
                <span className="text-xs text-neutral-400">Where to next?</span>
                <div className="flex gap-1.5">
                  <button onClick={() => vote('vault')} className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800">
                    Vault <span className="text-[10px] px-1.5 rounded-full bg-blue-500/20 text-blue-300">{votes.vault}</span>
                  </button>
                  <button onClick={() => vote('entry')} className="text-xs border border-neutral-700 rounded-md px-2 py-1 flex items-center gap-1.5 text-neutral-200 hover:bg-neutral-800">
                    Back to entry <span className="text-[10px] px-1.5 rounded-full bg-neutral-800 text-neutral-400">{votes.entry}</span>
                  </button>
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
            <div className="flex flex-col gap-1">
              {turnOrder.map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center justify-between text-xs px-2 py-1.5 rounded ${
                    t.status === 'acting' ? 'bg-blue-500/20 text-blue-300 font-medium' : 'text-neutral-300'
                  }`}
                >
                  <span>{t.name}</span>
                  <span className={t.status === 'acting' ? '' : 'text-neutral-500'}>{t.status}</span>
                </div>
              ))}
            </div>
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
        {party.map((p) => (
          <div key={p.id} className="bg-neutral-900 border border-neutral-800 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-white">{p.name}</span>
              {p.id === 'marcus' && <Shield size={14} className="text-neutral-500" />}
              {p.id === 'yeti' && <Flame size={14} className="text-neutral-500" />}
            </div>
            <p className="text-[11px] text-neutral-400 mb-2">
              {p.className} &middot; lvl {p.level}
            </p>
            <div className="h-1.5 rounded-full bg-red-900/40 overflow-hidden">
              <div
                className={`h-full ${hpBarColor(p.hp, p.maxHp)}`}
                style={{ width: `${(p.hp / p.maxHp) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-neutral-500 mt-1">
              <span>{p.hp}/{p.maxHp} hp</span>
              <span>ac {p.ac}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
