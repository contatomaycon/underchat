import { injectable } from 'tsyringe';

@injectable()
export class KeyedSequencerService {
  private chains = new Map<string, Promise<void>>();

  enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(task).finally(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    });

    this.chains.set(key, next);

    return next;
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.chains.values()]);

    this.chains.clear();
  }
}
