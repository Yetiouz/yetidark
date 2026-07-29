export function getCampaignEntryBlockReason({
  sessionActive,
  hasCharacter,
  canStart,
  hasMinPlayers,
  minPlayers,
  memberCount,
  missingCharacterNames,
}) {
  if (sessionActive) {
    return hasCharacter ? null : 'Create or select a character before joining the session.'
  }

  if (!canStart) return 'Only the GM can start the session.'

  if (!hasMinPlayers) {
    const remaining = minPlayers - memberCount
    return `Waiting for ${remaining} more player${remaining === 1 ? '' : 's'}`
  }

  if (missingCharacterNames.length > 0) {
    return `Waiting for ${missingCharacterNames.join(', ')}`
  }

  return null
}
