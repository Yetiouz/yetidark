export const SHADOWDARK_RULESET = Object.freeze({
  id: 'shadowdark-character-core',
  version: '2026-07-29.1',
  source: 'Shadowdark RPG core rules with Delve equipped-item house rule',
})

export function abilityModifier(score) {
  if (score >= 18) return 4
  if (score >= 16) return 3
  if (score >= 14) return 2
  if (score >= 12) return 1
  if (score >= 10) return 0
  if (score >= 8) return -1
  if (score >= 6) return -2
  if (score >= 4) return -3
  return -4
}

export function isValidAbilityScore(score) {
  return Number.isInteger(score) && score >= 3 && score <= 18
}

export function isValidHitDieRoll(roll, hitDie) {
  return Number.isInteger(roll) && Number.isInteger(hitDie) && roll >= 1 && roll <= hitDie
}

export function startingHp({ hitDieRoll, hitDie, constitutionScore, ancestryBonus = 0 }) {
  if (!isValidHitDieRoll(hitDieRoll, hitDie)) {
    throw new RangeError(`Starting HP roll must be between 1 and ${hitDie}.`)
  }

  return Math.max(1, hitDieRoll + abilityModifier(constitutionScore) + ancestryBonus)
}

export function hasHaulerFeature(features = []) {
  return features.some((feature) => {
    const text = typeof feature === 'string' ? feature : `${feature?.name || ''} ${feature?.description || ''}`
    return /\bHauler\b/i.test(text)
  })
}

export function gearSlotCapacity({ strengthScore, constitutionScore, features = [] }) {
  const base = Math.max(Number(strengthScore) || 0, 10)
  const haulerBonus = hasHaulerFeature(features)
    ? Math.max(0, abilityModifier(Number(constitutionScore) || 0))
    : 0
  return base + haulerBonus
}

export function occupiedGearSlots(items = []) {
  return items.reduce((total, item) => {
    if (item?.equipped) return total
    const slots = Math.max(0, Number(item?.slots) || 0)
    const quantity = Math.max(0, Number(item?.quantity) || 0)
    return total + slots * quantity
  }, 0)
}

export function resolveTalentRolls({ rolls, table }) {
  return rolls.map((roll) => {
    if (!Number.isInteger(roll) || roll < 2 || roll > 12) {
      throw new RangeError('Talent rolls must be 2d6 totals from 2 to 12.')
    }
    const result = table.find((entry) => roll >= entry.min && roll <= entry.max)
    if (!result) throw new RangeError(`Talent table has no result for ${roll}.`)
    return { formula: '2d6', roll, description: result.text }
  })
}

export function resolveSpellCheck({ naturalRoll, total, tier, succeededSinceRest = false }) {
  if (!Number.isInteger(naturalRoll) || naturalRoll < 1 || naturalRoll > 20) {
    throw new RangeError('Natural spell check roll must be from 1 to 20.')
  }
  if (!Number.isFinite(total)) throw new TypeError('Spell check total is required.')
  if (!Number.isInteger(tier) || tier < 1) throw new RangeError('Spell tier must be a positive integer.')

  const dc = 10 + tier
  const mishap = naturalRoll === 1
  const succeeded = !mishap && total >= dc
  const locked = !succeeded && succeededSinceRest

  return {
    dc,
    succeeded,
    mishap,
    locked,
    succeededSinceRest: succeededSinceRest || succeeded,
  }
}
