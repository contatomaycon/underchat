const resumeListeners = new Set<() => void>();
const sessionUpdatedListeners = new Set<() => void>();

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

export function addSessionUpdatedListener(listener: () => void): () => void {
  sessionUpdatedListeners.add(listener);
  return () => {
    sessionUpdatedListeners.delete(listener);
  };
}

export function emitSessionUpdated(): void {
  for (const listener of sessionUpdatedListeners) {
    try {
      listener();
    } catch {
      //
    }
  }
}
