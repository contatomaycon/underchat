const resumeListeners = new Set<() => void>();

export function addAppResumeListener(listener: () => void): () => void {
  resumeListeners.add(listener);
  return () => {
    resumeListeners.delete(listener);
  };
}

export function emitAppResume(): void {
  for (const listener of resumeListeners) {
    try {
      listener();
    } catch {
      //
    }
  }
}
