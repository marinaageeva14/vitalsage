export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}

export function generateSuggestionId(
  agent: string,
  metric: string,
  title: string,
): string {
  const input = `${agent}:${metric}:${title.toLowerCase().replace(/\s+/g, '-').slice(0, 60)}`;
  // djb2 hash — deterministic, stable across runs
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
