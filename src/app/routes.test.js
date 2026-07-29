import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAppPath, pathForView, routeNeedsCampaign } from './routes.js'

const campaignId = '10000000-0000-0000-0000-000000000001'
const characterId = '40000000-0000-0000-0000-000000000001'

test('simple application paths parse deterministically', () => {
  assert.deepEqual(parseAppPath('/'), { view: 'lobby', campaignId: null, characterId: null })
  assert.deepEqual(parseAppPath('/profile'), { view: 'profile', campaignId: null, characterId: null })
  assert.deepEqual(parseAppPath('/campaigns/new'), { view: 'campaign-builder', campaignId: null, characterId: null })
})

test('campaign paths round trip through parser and formatter', () => {
  for (const view of ['campaign-lobby', 'characters', 'builder', 'table', 'gm', 'settings', 'log', 'library', 'tracker']) {
    const path = pathForView(view, { campaignId })
    assert.deepEqual(parseAppPath(path), { view, campaignId, characterId: null })
  }
})

test('character sheet paths retain campaign and character context', () => {
  const path = pathForView('sheet', { campaignId, characterId })
  assert.equal(path, `/campaigns/${campaignId}/characters/${characterId}`)
  assert.deepEqual(parseAppPath(path), { view: 'sheet', campaignId, characterId })
})

test('unknown paths safely return to a useful screen', () => {
  assert.deepEqual(parseAppPath('/missing'), { view: 'lobby', campaignId: null, characterId: null })
  assert.deepEqual(
    parseAppPath(`/campaigns/${campaignId}/missing`),
    { view: 'campaign-lobby', campaignId, characterId: null }
  )
})

test('campaign requirements are explicit', () => {
  assert.equal(routeNeedsCampaign('table'), true)
  assert.equal(routeNeedsCampaign('sheet'), true)
  assert.equal(routeNeedsCampaign('profile'), false)
})
