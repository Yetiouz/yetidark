export function appendUniqueById(items, incoming) {
  if (!incoming?.id || items.some((item) => item.id === incoming.id)) return items
  return [...items, incoming]
}
