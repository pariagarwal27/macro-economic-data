export function resolveStudioSelection<T extends { id: string }>(items: T[], selectedId: string | null): T | null {
  return items.find(item => item.id === selectedId) ?? items[0] ?? null;
}
