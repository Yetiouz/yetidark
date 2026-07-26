import { Dices, ListChecks } from 'lucide-react'
import { myCharacters } from '../mockData.js'

const badgeColor = {
  blue: 'bg-blue-500/20 text-blue-300',
  amber: 'bg-amber-500/20 text-amber-300',
}

export default function CharacterPicker({ campaignName = 'The sunken keep', onChooseCharacter }) {
  return (
    <div className="max-w-xl mx-auto p-6">
      <p className="text-xs text-neutral-400 mb-0.5">{campaignName}</p>
      <h1 className="text-white text-lg font-medium mb-4">Choose your character</h1>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col items-center text-center gap-2">
          <Dices size={22} className="text-blue-400" />
          <p className="text-sm font-medium text-white">Create a character</p>
          <p className="text-xs text-neutral-400">Roll stats, pick ancestry and class</p>
          <button
            onClick={() => onChooseCharacter && onChooseCharacter({ mode: 'create' })}
            className="w-full mt-1 text-sm border border-neutral-700 rounded-md py-1.5 text-neutral-100 hover:bg-neutral-800"
          >
            Start rolling
          </button>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col items-center text-center gap-2">
          <ListChecks size={22} className="text-neutral-400" />
          <p className="text-sm font-medium text-white">Pick an existing character</p>
          <p className="text-xs text-neutral-400">From this campaign or a past one</p>
          <button
            onClick={() => onChooseCharacter && onChooseCharacter({ mode: 'existing', characterId: myCharacters[0]?.id })}
            className="w-full mt-1 text-sm border border-neutral-700 rounded-md py-1.5 text-neutral-100 hover:bg-neutral-800"
          >
            Choose
          </button>
        </div>
      </div>

      <p className="text-xs text-neutral-400 mb-2">Your characters</p>
      <div className="flex flex-col gap-1.5">
        {myCharacters.map((c) => (
          <div key={c.id} className="flex items-center gap-2.5 bg-neutral-900 rounded-md px-2.5 py-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${badgeColor[c.color]}`}>
              {c.initial}
            </div>
            <div className="flex-1">
              <p className="text-sm text-white">{c.name}</p>
              <p className="text-xs text-neutral-400">
                {c.className} &middot; lvl {c.level} &middot; {c.campaign}
              </p>
            </div>
            <button
              onClick={() => onChooseCharacter && onChooseCharacter({ mode: 'existing', characterId: c.id })}
              className="text-xs border border-neutral-700 rounded-md px-2.5 py-1 text-neutral-200 hover:bg-neutral-800"
            >
              Use
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
