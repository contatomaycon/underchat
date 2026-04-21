import 'reflect-metadata';
import { KeyedSequencerService } from '@core/services/keyedSequencer.service';

describe('KeyedSequencerService', () => {
  it('runs tasks sequentially for the same key', async () => {
    const service = new KeyedSequencerService();
    const events: string[] = [];

    const first = service.enqueue('k1', async () => {
      events.push('first-start');
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push('first-end');
    });

    const second = service.enqueue('k1', async () => {
      events.push('second-run');
    });

    await first;
    await second;

    expect(events).toEqual(['first-start', 'first-end', 'second-run']);
  });

  it('rejects task when timeout is reached', async () => {
    const service = new KeyedSequencerService();

    await expect(
      service.enqueue(
        'k-timeout',
        async () => new Promise<void>(() => undefined),
        { timeoutMs: 1 }
      )
    ).rejects.toThrow('Task timeout');
  });

  it('drain waits for pending tasks and clears chains', async () => {
    const service = new KeyedSequencerService();

    await service.enqueue('k1', async () => undefined);
    await service.enqueue('k2', async () => undefined);

    await expect(service.drain()).resolves.toBeUndefined();
  });
});
