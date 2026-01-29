export function resolveApiBase(): string {
  const raw = import.meta.env.VITE_NODE_API_ENDPOINT || '';
  return raw.replace(/\/+$/, '');
}

export function apiUrl(path: string): string {
  if (!path) return resolveApiBase() || '';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const base = resolveApiBase();
  return base ? `${base}${normalized}` : normalized;
}
