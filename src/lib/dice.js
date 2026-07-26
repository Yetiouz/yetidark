// Client-side port of the Shadowdark GM system's `_TOOLS/dice.py`, so every
// roll made in the app follows the exact same rules as the file-based
// system: real notation (not just a single die face), advantage/
// disadvantage that only ever applies to a lone 1d20 check (roll twice,
// keep higher/lower), and automatic natural-20 / natural-1 flagging.
//
// This module only computes a roll -- it doesn't touch Supabase. Callers
// are expected to persist the result to the `dice_rolls` table themselves
// (see GameTable.jsx / GmDashboard.jsx) so results stay auditable, matching
// dice.py's append-only dice_log.txt.

const TERM_RE = /([+-]?)\s*(\d*d\d+|\d+)/gi

export class DiceNotationError extends Error {}

function parseExpression(notation) {
  const cleaned = notation.trim().toLowerCase().replace(/\s+/g, '')
  if (!cleaned) throw new DiceNotationError('Empty dice notation.')

  const terms = []
  let rebuilt = ''
  let match
  TERM_RE.lastIndex = 0
  while ((match = TERM_RE.exec(cleaned)) !== null) {
    rebuilt += match[0]
    const sign = match[1] === '-' ? -1 : 1
    const token = match[2]
    if (token.includes('d')) {
      const [countStr, sidesStr] = token.split('d')
      const count = countStr ? parseInt(countStr, 10) : 1
      const sides = parseInt(sidesStr, 10)
      if (count < 1 || sides < 2) throw new DiceNotationError(`Bad dice term: ${token}`)
      terms.push({ sign, count, sides })
    } else {
      terms.push({ sign, count: null, sides: parseInt(token, 10) })
    }
  }
  if (!terms.length || rebuilt !== cleaned) {
    throw new DiceNotationError(
      `Bad dice notation: ${notation} (expected e.g. 1d20+2, 2d6, 1d8+1d4+2, d100)`
    )
  }
  return terms
}

function rollTerms(terms) {
  let total = 0
  const parts = []
  let loneD20Raw = null
  const d20TermCount = terms.filter((t) => t.sides === 20 && t.count === 1).length

  for (const t of terms) {
    if (t.count === null) {
      total += t.sign * t.sides
      parts.push(`${t.sign > 0 ? '+' : '-'}${t.sides}`)
    } else {
      const rolls = Array.from({ length: t.count }, () => Math.floor(Math.random() * t.sides) + 1)
      const subtotal = rolls.reduce((a, b) => a + b, 0)
      total += t.sign * subtotal
      parts.push(`${t.sign > 0 ? '+' : '-'}${t.count}d${t.sides}[${rolls.join(',')}]`)
      if (t.sides === 20 && t.count === 1 && d20TermCount === 1) loneD20Raw = rolls[0]
    }
  }
  let breakdown = parts.join(' ')
  if (breakdown.startsWith('+')) breakdown = breakdown.slice(1)
  return { total, breakdown, loneD20Raw }
}

function isSingleD20(terms) {
  const diceTerms = terms.filter((t) => t.count !== null)
  return (
    diceTerms.length === 1 &&
    diceTerms[0].count === 1 &&
    diceTerms[0].sides === 20 &&
    diceTerms[0].sign > 0
  )
}

function critFlag(raw) {
  if (raw == null) return null
  if (raw === 20) return 'crit'
  if (raw === 1) return 'fumble'
  return null
}

/**
 * Rolls a dice notation string, e.g. "1d20+3", "2d6", "1d8+1d4+2".
 * mode: 'flat' (default) rolls once. 'advantage'/'disadvantage' roll twice
 * and keep the higher/lower -- but only valid for a single 1d20(+mods) term,
 * matching dice.py exactly (throws DiceNotationError otherwise).
 * Returns { notation, mode, reason, total, breakdown, rawD20, isCrit, isFumble }.
 */
export function rollDiceNotation(notation, { mode = 'flat', reason = null } = {}) {
  const terms = parseExpression(notation)

  if (mode === 'advantage' || mode === 'disadvantage') {
    if (!isSingleD20(terms)) {
      throw new DiceNotationError(
        'Advantage/disadvantage only apply to a single 1d20 term plus optional flat modifiers (e.g. 1d20+2).'
      )
    }
    const a = rollTerms(terms)
    const b = rollTerms(terms)
    const keepA = mode === 'advantage' ? a.total >= b.total : a.total <= b.total
    const kept = keepA ? a : b
    const flag = critFlag(kept.loneD20Raw)
    return {
      notation,
      mode,
      reason,
      total: kept.total,
      breakdown: `[${a.breakdown}] vs [${b.breakdown}]`,
      rawD20: kept.loneD20Raw,
      isCrit: flag === 'crit',
      isFumble: flag === 'fumble',
    }
  }

  const r = rollTerms(terms)
  const flag = critFlag(r.loneD20Raw)
  return {
    notation,
    mode: 'flat',
    reason,
    total: r.total,
    breakdown: r.breakdown,
    rawD20: r.loneD20Raw,
    isCrit: flag === 'crit',
    isFumble: flag === 'fumble',
  }
}

/** Quick-pick helper for the "d20/d12/.../d4" buttons -- just "1d{sides}". */
export function flatDieNotation(sides) {
  return `1d${sides}`
}
