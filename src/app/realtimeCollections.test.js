import test from 'node:test'
import assert from 'node:assert/strict'
import { appendUniqueById } from './realtimeCollections.js'

test('realtime inserts do not duplicate an optimistic command result', () => {
  const existing = [{ id: 'clock-1', name: 'Playtest clock' }]
  assert.equal(appendUniqueById(existing, { id: 'clock-1', name: 'Playtest clock' }), existing)
})

test('new realtime inserts are appended once', () => {
  const existing = [{ id: 'clock-1' }]
  assert.deepEqual(appendUniqueById(existing, { id: 'clock-2' }), [
    { id: 'clock-1' },
    { id: 'clock-2' },
  ])
})
