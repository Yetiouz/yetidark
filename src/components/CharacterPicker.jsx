import { useState, useEffect } from 'react'
import { Dices, ListChecks } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'

const badgeColors = ['bg-primary-bg text-primary-text', 'bg-warning-bg text-warning-text', 'bg-ai-bg text-ai-text']

export default function CharacterPicker({ campaignId, session, campaignName = 'The sunken keep', onChooseCharacter }) {
  const user = session?.user
  const [characters, setCharacters] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!campaignId || !user) {
        setLoading(false)
        return
      }
      setLoading(true)
      const { data } = await supabase
        .from('characters')
        .select('id, name, ancestry, class, level')
        .eq('campaign_id', campaignId)
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false })
      if (!cancelled) {
        setCharacters(data || [])
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [campaignId, user])

  return (
    <div className="max-w-xl mx-auto p-6">
      <p className="text-xs text-ink-dim mb-0.5">{campaignName}</p>
      <h1 className="text-ink text-lg font-medium mb-4">Choose your character</h1>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-panel border border-line-soft rounded-xl p-4 flex flex-col items-center text-center gap-2">
          <Dices size={22} className="text-primary-text" />
          <p className="text-sm font-medium text-ink">Create a character</p>
          <p className="text-xs text-ink-dim">Roll stats, pick ancestry and class</p>
          <button
            onClick={() => onChooseCharacter && onChooseCharacter({ mode: 'create' })}
            className="w-full mt-1 text-sm border border-line rounded-md py-1.5 text-ink hover:bg-panel2"
          >
            Start rolling
          </button>
        </div>
        <div className="bg-panel border border-line-soft rounded-xl p-4 flex flex-col items-center text-center gap-2">
          <ListChecks size={22} className="text-ink-dim" />
          <p className="text-sm font-medium text-ink">Pick an existing character</p>
          <p className="text-xs text-ink-dim">Already made one for this campaign</p>
          <button
            disabled={characters.length === 0}
            onClick={() =>
              onChooseCharacter && onChooseCharacter({ mode: 'existing', characterId: characters[0]?.id })
            }
            className="w-full mt-1 text-sm border border-line rounded-md py-1.5 text-ink hover:bg-panel2 disabled:opacity-40"
          >
            Choose
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-dim mb-2">Your characters in this campaign</p>
      {loading ? (
        <p className="text-sm text-ink-faint">Loading...</p>
      ) : characters.length === 0 ? (
        <p className="text-sm text-ink-faint">
          None yet -- create one above to get started.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {characters.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2.5 bg-panel rounded-md px-2.5 py-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                  badgeColors[i % badgeColors.length]
                }`}
              >
                {c.name[0].toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="text-sm text-ink">{c.name}</p>
                <p className="text-xs text-ink-dim">
                  {c.ancestry} {c.class} &middot; lvl {c.level}
                </p>
              </div>
              <button
                onClick={() => onChooseCharacter && onChooseCharacter({ mode: 'existing', characterId: c.id })}
                className="text-xs border border-line rounded-md px-2.5 py-1 text-ink hover:bg-panel2"
              >
                Use
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
