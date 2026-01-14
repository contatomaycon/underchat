import { injectable } from 'tsyringe';

@injectable()
export class KeyedSequencerService {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly TASK_TIMEOUT_MS = 30000;

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

  enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => {
        return this.withTimeout(task(), this.TASK_TIMEOUT_MS, key);
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
