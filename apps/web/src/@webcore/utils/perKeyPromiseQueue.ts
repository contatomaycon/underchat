export class PerKeyPromiseQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new Error('per_key_promise_queue_key_required');
    }

    const predecessor = this.tails.get(normalizedKey) ?? Promise.resolve();
    const execution = predecessor.catch(() => undefined).then(operation);
    const settled = execution.then(
      () => undefined,
      () => undefined
    );
    this.tails.set(normalizedKey, settled);

    try {
      return await execution;
    } finally {
      if (this.tails.get(normalizedKey) === settled) {
        this.tails.delete(normalizedKey);
      }
    }
  }
}
