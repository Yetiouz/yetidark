import { useState, useEffect } from 'react'
import { Dices, ListChecks } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import Card from './ui/Card.jsx'
import Button from './ui/Button.jsx'

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
      <p className="text-xs text-ink-dim mb-1">{campaignName}</p>
      <h1 className="text-ink text-lg font-medium mb-4">Choose your character</h1>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <Card bodyClassName="flex flex-col items-center text-center gap-2">
          <Dices size={22} className="text-primary-text" />
          <p className="text-sm font-medium text-ink">Create a character</p>
          <p className="text-xs text-ink-dim">Roll stats, pick ancestry and class</p>
          <Button className="w-full mt-1" onClick={() => onChooseCharacter && onChooseCharacter({ mode: 'create' })}>
            Start rolling
          </Button>
        </Card>
        <Card bodyClassName="flex flex-col items-center text-center gap-2">
          <ListChecks size={22} className="text-ink-dim" />
          <p className="text-sm font-medium text-ink">Pick an existing character</p>
          <p className="text-xs text-ink-dim">
            {/* Bug #2 fix: this shortcut used to always call onChooseCharacter
                with characters[0]?.id, silently choosing the wrong character
                whenever a player had more than one in this campaign. It's
                now only enabled when there's exactly one -- the one case
                where "the first character" and "the intended character" are
                the same thing. With 2+, the button disables and the copy
                below points at the per-row "Use" buttons in the list, which
                already carry the correct id for whichever row was clicked. */}
            {characters.length > 1 ? 'Pick one from the list below' : 'Already made one for this campaign'}
          </p>
          <Button
            className="w-full mt-1"
            disabled={characters.length !== 1}
            onClick={() =>
              onChooseCharacter && onChooseCharacter({ mode: 'existing', characterId: characters[0]?.id })
            }
          >
            Choose
          </Button>
        </Card>
      </div>

      <p className="text-xs text-ink-dim mb-2">Your characters in this campaign</p>
      {loading ? (
        <p className="text-sm text-ink-faint">Loading...</p>
      ) : characters.length === 0 ? (
        <p className="text-sm text-ink-faint">
          None yet -- create one above to get started.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {characters.map((c, i) => (
            <div key={c.id} className="flex items-center gap-3 bg-panel rounded-md px-3 py-2">
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
              <Button onClick={() => onChooseCharacter && onChooseCharacter({ mode: 'existing', characterId: c.id })}>
                Use
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
