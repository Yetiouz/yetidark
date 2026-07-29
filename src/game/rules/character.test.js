import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SHADOWDARK_RULESET,
  abilityModifier,
  gearSlotCapacity,
  hasHaulerFeature,
  isValidAbilityScore,
  isValidHitDieRoll,
  occupiedGearSlots,
  startingHp,
} from './character.js'

test('ruleset is explicitly versioned', () => {
  assert.match(SHADOWDARK_RULESET.version, /^\d{4}-\d{2}-\d{2}\.\d+$/)
})

test('ability modifiers follow the Shadowdark score bands', () => {
  assert.equal(abilityModifier(3), -4)
  assert.equal(abilityModifier(8), -1)
  assert.equal(abilityModifier(10), 0)
  assert.equal(abilityModifier(14), 2)
  assert.equal(abilityModifier(18), 4)
})

test('character creation accepts only possible 3d6 ability totals', () => {
  assert.equal(isValidAbilityScore(3), true)
  assert.equal(isValidAbilityScore(18), true)
  assert.equal(isValidAbilityScore(2), false)
  assert.equal(isValidAbilityScore(19), false)
})

test('starting HP uses the recorded hit-die roll and bonuses with a minimum of one', () => {
  assert.equal(startingHp({ hitDieRoll: 5, hitDie: 8, constitutionScore: 14, ancestryBonus: 0 }), 7)
  assert.equal(startingHp({ hitDieRoll: 1, hitDie: 4, constitutionScore: 3, ancestryBonus: 0 }), 1)
  assert.equal(startingHp({ hitDieRoll: 4, hitDie: 6, constitutionScore: 10, ancestryBonus: 2 }), 6)
})

test('starting HP rejects results outside the class hit die', () => {
  assert.equal(isValidHitDieRoll(1, 6), true)
  assert.equal(isValidHitDieRoll(6, 6), true)
  assert.equal(isValidHitDieRoll(0, 6), false)
  assert.equal(isValidHitDieRoll(7, 6), false)
  assert.throws(
    () => startingHp({ hitDieRoll: 7, hitDie: 6, constitutionScore: 10 }),
    /between 1 and 6/
  )
})

test('positive Constitution adds slots only when the character has the Hauler feature', () => {
  assert.equal(gearSlotCapacity({ strengthScore: 12, constitutionScore: 16, features: [] }), 12)
  assert.equal(
    gearSlotCapacity({
      strengthScore: 12,
      constitutionScore: 16,
      features: [{ name: 'Hauler', description: 'Add your Constitution modifier to gear slots' }],
    }),
    15
  )
  assert.equal(hasHaulerFeature([{ name: 'Hauler', description: 'Carry more gear' }]), true)
})

test('equipped items do not consume gear slots under the active house rule', () => {
  assert.equal(
    occupiedGearSlots([
      { slots: 1, quantity: 2, equipped: false },
      { slots: 3, quantity: 1, equipped: true },
      { slots: 1, quantity: 3, equipped: false },
    ]),
    5
  )
})
