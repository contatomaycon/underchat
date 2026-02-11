const listeners = new Set<() => void>();

export function addAuthUnauthorizedListener(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function emitAuthUnauthorized(): void {
  listeners.forEach((cb) => cb());
}
