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
