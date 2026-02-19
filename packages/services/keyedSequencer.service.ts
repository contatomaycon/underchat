import { injectable } from 'tsyringe';

@injectable()
export class KeyedSequencerService {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly TASK_TIMEOUT_MS = 15000;

  private resolveTimeoutMs(timeoutMs?: number): number {
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
      return this.TASK_TIMEOUT_MS;
    }

    return timeoutMs > 0 ? timeoutMs : this.TASK_TIMEOUT_MS;
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    key: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => {
          reject(
            new Error(`Task timeout após ${timeoutMs}ms para chave: ${key}`)
          );
        }, timeoutMs)
      ),
    ]);
  }

  enqueue(
    key: string,
    task: () => Promise<void>,
    options?: { timeoutMs?: number }
  ): Promise<void> {
    const timeoutMs = this.resolveTimeoutMs(options?.timeoutMs);
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => {
        return this.withTimeout(task(), timeoutMs, key);
      })
      .catch((error) => {
        throw error;
      })
      .finally(() => {
        if (this.chains.get(key) === next) {
          this.chains.delete(key);
        }
      });

    this.chains.set(key, next);

    return next;
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.chains.values());
    this.chains.clear();
  }
}
