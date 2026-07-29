import test from 'node:test'
import assert from 'node:assert/strict'
import { getCampaignEntryBlockReason } from './campaignEntry.js'

const readyCampaign = {
  sessionActive: false,
  hasCharacter: true,
  canStart: true,
  hasMinPlayers: true,
  minPlayers: 1,
  memberCount: 2,
  missingCharacterNames: [],
}

test('players with characters can rejoin an active human-GM session', () => {
  assert.equal(
    getCampaignEntryBlockReason({
      ...readyCampaign,
      sessionActive: true,
      canStart: false,
    }),
    null
  )
})

test('active sessions still require the current player to have a character', () => {
  assert.equal(
    getCampaignEntryBlockReason({
      ...readyCampaign,
      sessionActive: true,
      hasCharacter: false,
      canStart: false,
    }),
    'Create or select a character before joining the session.'
  )
})

test('only the GM can start an inactive human-GM session', () => {
  assert.equal(
    getCampaignEntryBlockReason({
      ...readyCampaign,
      canStart: false,
    }),
    'Only the GM can start the session.'
  )
})
