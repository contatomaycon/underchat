import { NativeConnectionStatusPersistenceQueue } from '@core/services/nativeConnectionStatusPersistenceQueue.service';

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('NativeConnectionStatusPersistenceQueue', () => {
  it('serializes writes and coalesces pending snapshots to the newest sequence', async () => {
    const first = deferred();
    const published: number[] = [];
    const queue = new NativeConnectionStatusPersistenceQueue<number>({
      publish: async (item) => {
        published.push(item.sequence);
        if (item.sequence === 1) await first.promise;
      },
    });

    expect(
      queue.enqueue({
        eventId: '01900000-0000-7000-8000-000000000001',
        sourceId: 'source-a',
        sequence: 1,
        payload: 1,
      })
    ).toBe(true);
    await Promise.resolve();
    queue.enqueue({
      eventId: '01900000-0000-7000-8000-000000000002',
      sourceId: 'source-a',
      sequence: 2,
      payload: 2,
    });
    queue.enqueue({
      eventId: '01900000-0000-7000-8000-000000000003',
      sourceId: 'source-a',
      sequence: 3,
      payload: 3,
    });
    first.resolve();

    await expect(queue.flush()).resolves.toBe(true);
    expect(published).toEqual([1, 3]);
  });

  it('reuses one event ID when the database result is uncertain', async () => {
    jest.useFakeTimers();
    const eventIds: string[] = [];
    const queue = new NativeConnectionStatusPersistenceQueue<string>({
      publish: async (item) => {
        eventIds.push(item.eventId);
        if (eventIds.length === 1) throw new Error('connection reset by peer');
      },
    });
    const eventId = '01900000-0000-7000-8000-000000000004';
    queue.enqueue({
      eventId,
      sourceId: 'source-a',
      sequence: 4,
      payload: 'offline',
    });

    await jest.advanceTimersByTimeAsync(250);
    await expect(queue.flush()).resolves.toBe(true);
    expect(eventIds).toEqual([eventId, eventId]);
    jest.useRealTimers();
  });

  it('does not retry a definitive SQL rejection or accept sequence zero', async () => {
    const publish = jest.fn(async () => {
      throw new Error('worker_runtime_status_rejected:invalid');
    });
    const queue = new NativeConnectionStatusPersistenceQueue<string>({
      publish,
    });
    expect(
      queue.enqueue({
        eventId: '01900000-0000-7000-8000-000000000005',
        sourceId: 'source-a',
        sequence: 0,
        payload: 'initializing',
      })
    ).toBe(false);
    queue.enqueue({
      eventId: '01900000-0000-7000-8000-000000000006',
      sourceId: 'source-a',
      sequence: 1,
      payload: 'initializing',
    });

    await expect(queue.flush()).resolves.toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
