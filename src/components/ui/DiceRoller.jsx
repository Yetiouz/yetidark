import { Dices, AlertCircle } from 'lucide-react'

// Dice roller / Attack / Stabilize panel -- extracted from GameTable.jsx's
// Modal.jsx-hosted "Dice & combat" popup (see that file's comment for why
// this lives behind an on-demand modal instead of a permanent stacked
// card). Purely presentational: all the roll/attack/stabilize state and
// the Supabase-backed handlers stay in GameTable.jsx (and, on the GM
// side, would stay in whatever screen embeds this) and get passed down
// as props, so this component has no knowledge of campaigns, Supabase,
// or the scene log -- just the dice/attack/stabilize UI and the
// notation/mode/target values it needs to render.
const DICE = [20, 12, 10, 8, 6, 4]

export default function DiceRoller({
  rollState,
  rollNonce,
  onRollQuickDie,
  notationInput,
  setNotationInput,
  rollMode,
  setRollMode,
  reasonInput,
  setReasonInput,
  onRollCustom,
  rollError,
  manualDie,
  setManualDie,
  manualValue,
  setManualValue,
  onLogManualRoll,
  monsters,
  attackTargetId,
  setAttackTargetId,
  attackNotation,
  setAttackNotation,
  damageNotation,
  setDamageNotation,
  onResolveAttack,
  attacking,
  attackError,
  dyingParty,
  stabilizeTargetId,
  setStabilizeTargetId,
  stabilizeNotation,
  setStabilizeNotation,
  onResolveStabilize,
  stabilizing,
  stabilizeError,
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="bg-panel rounded-lg p-3">
        <style>{`
    @keyframes dice-spin {
    0% { transform: rotate(0deg) scale(1); }
    50% { transform: rotate(180deg) scale(1.12); }
    100% { transform: rotate(360deg) scale(1); }
    }
    @keyframes dice-land {
    0% { transform: scale(1.35); }
    60% { transform: scale(0.92); }
    100% { transform: scale(1); }
    }
    .dice-rolling { animation: dice-spin 0.3s linear infinite; }
    .dice-landed { animation: dice-land 0.3s ease-out; }
    `}</style>
        <p className="text-xs text-ink-dim mb-2">Roll a die</p>

        <div className="flex flex-col items-center justify-center mb-3">
          <div
            key={rollNonce}
            className={`w-16 h-16 rounded-xl border-2 flex items-center justify-center text-2xl font-bold ${
              rollState
                ? rollState.isCrit
                  ? 'border-positive text-white bg-positive/10'
                  : rollState.isFumble
                    ? 'border-danger text-white bg-danger/10'
                    : 'border-primary text-white bg-primary/10'
                : 'border-line text-ink-faint bg-bg'
            } ${rollState?.isRolling ? 'dice-rolling' : rollState ? 'dice-landed' : ''}`}
          >
            {rollState ? rollState.value : <Dices size={22} />}
          </div>
          {rollState && (
            <p className="text-[11px] text-ink-dim mt-2">
              {rollState.label}
              {rollState.isRolling
                ? ' rolling…'
                : rollState.isCrit
                  ? ' — crit!'
                  : rollState.isFumble
                    ? ' — fumble!'
                    : ''}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          {DICE.map((sides) => (
            <button
              key={sides}
              onClick={() => onRollQuickDie(sides)}
              disabled={rollState?.isRolling}
              className="text-xs py-2 border border-line rounded-md text-ink hover:bg-panel2 disabled:opacity-50"
            >
              d{sides}
            </button>
          ))}
        </div>

        <div className="pt-3 border-t border-line-soft">
          <p className="text-[11px] text-ink-dim mb-2">
            Custom roll (notation, advantage/disadvantage, reason)
          </p>
          <div className="flex gap-2 mb-2">
            <input
              value={notationInput}
              onChange={(e) => setNotationInput(e.target.value)}
              placeholder="1d20+3"
              className="w-20 text-xs bg-bg border border-line rounded-md px-2 py-1 text-white"
            />
            <div className="flex flex-1 gap-1">
              {['flat', 'advantage', 'disadvantage'].map((m) => (
                <button
                  key={m}
                  onClick={() => setRollMode(m)}
                  className={`flex-1 text-[10px] py-1 rounded-md border ${
                    rollMode === m
                      ? 'border-primary text-primary-text bg-primary/10'
                      : 'border-line text-ink'
                  }`}
                >
                  {m === 'flat' ? 'flat' : m === 'advantage' ? 'adv' : 'disadv'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 mb-2">
            <input
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              placeholder="reason (optional)"
              className="flex-1 min-w-0 text-xs bg-bg border border-line rounded-md px-2 py-1 text-white"
            />
            <button
              onClick={onRollCustom}
              disabled={rollState?.isRolling}
              className="text-xs px-3 border border-line rounded-md text-ink hover:bg-panel2 disabled:opacity-50"
            >
              Roll
            </button>
          </div>
          {rollError && (
            <div className="flex items-center gap-2 text-danger-text mb-2">
              <AlertCircle size={12} />
              <p className="text-[11px]">{rollError}</p>
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-line-soft">
          <p className="text-[11px] text-ink-dim mb-2">Rolled it yourself? Log it here.</p>
          <div className="flex gap-2">
            <select
              value={manualDie}
              onChange={(e) => setManualDie(e.target.value)}
              className="w-14 text-xs bg-bg border border-line rounded-md px-1 py-1 text-white"
            >
              {DICE.map((d) => (
                <option key={d} value={d}>
                  d{d}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              placeholder="14"
              className="w-14 text-xs bg-bg border border-line rounded-md px-2 py-1 text-white"
            />
            <button
              onClick={onLogManualRoll}
              className="flex-1 text-xs border border-line rounded-md text-ink hover:bg-panel2"
            >
              Log
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="bg-panel rounded-lg p-3">
          <p className="text-xs text-ink-dim mb-2">Attack</p>
          {monsters.length === 0 ? (
            <p className="text-[11px] text-ink-dim">No monsters in this encounter yet.</p>
          ) : (
            <>
              <select
                value={attackTargetId}
                onChange={(e) => setAttackTargetId(e.target.value)}
                className="w-full text-xs bg-bg border border-line rounded-md px-2 py-1 text-white mb-2"
              >
                <option value="">Target...</option>
                {monsters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2 mb-2">
                <input
                  value={attackNotation}
                  onChange={(e) => setAttackNotation(e.target.value)}
                  placeholder="1d20+3"
                  className="w-16 text-xs bg-bg border border-line rounded-md px-2 py-1 text-white"
                />
                <input
                  value={damageNotation}
                  onChange={(e) => setDamageNotation(e.target.value)}
                  placeholder="1d6+1"
                  className="w-16 text-xs bg-bg border border-line rounded-md px-2 py-1 text-white"
                />
                <button
                  onClick={onResolveAttack}
                  disabled={!attackTargetId || attacking}
                  className="flex-1 text-xs border border-line rounded-md text-ink hover:bg-panel2 disabled:opacity-50"
                >
                  {attacking ? 'Rolling…' : 'Attack'}
                </button>
              </div>
              {attackError && (
                <div className="flex items-center gap-2 text-danger-text">
                  <AlertCircle size={12} />
                  <p className="text-[11px]">{attackError}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="bg-panel rounded-lg p-3">
          <p className="text-xs text-ink-dim mb-2">Stabilize</p>
          {dyingParty.length === 0 ? (
            <p className="text-[11px] text-ink-dim">No one is dying right now.</p>
          ) : (
            <>
              <select
                value={stabilizeTargetId}
                onChange={(e) => setStabilizeTargetId(e.target.value)}
                className="w-full text-xs bg-bg border border-line rounded-md px-2 py-1 text-white mb-2"
              >
                <option value="">Target...</option>
                {dyingParty.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {(p.zone || 'near') !== 'close' ? ' (not Close)' : ''}
                  </option>
                ))}
              </select>
              <div className="flex gap-2 mb-2">
                <input
                  value={stabilizeNotation}
                  onChange={(e) => setStabilizeNotation(e.target.value)}
                  placeholder="1d20+1"
                  className="w-16 text-xs bg-bg border border-line rounded-md px-2 py-1 text-white"
                />
                <button
                  onClick={onResolveStabilize}
                  disabled={!stabilizeTargetId || stabilizing}
                  className="flex-1 text-xs border border-line rounded-md text-ink hover:bg-panel2 disabled:opacity-50"
                >
                  {stabilizing ? 'Rolling…' : 'Stabilize (DC 15 INT)'}
                </button>
              </div>
              {stabilizeError && (
                <div className="flex items-center gap-2 text-danger-text">
                  <AlertCircle size={12} />
                  <p className="text-[11px]">{stabilizeError}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
