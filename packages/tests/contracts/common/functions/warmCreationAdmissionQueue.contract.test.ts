import {
  WarmCreationAdmissionQueue,
  WarmCreationAdmissionQueueClosedError,
  WarmCreationAdmissionQueueOperationTimeoutError,
  WarmCreationAdmissionQueueSaturatedError,
} from '@core/common/functions/warmCreationAdmissionQueue';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('WarmCreationAdmissionQueue', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('serializes one provider while allowing different providers in parallel', async () => {
    const queue = new WarmCreationAdmissionQueue();
    const baileysFirst = deferred();
    const order: string[] = [];

    const first = queue.enqueue('baileys', async () => {
      order.push('baileys:first:start');
      await baileysFirst.promise;
      order.push('baileys:first:end');
    });
    const second = queue.enqueue('baileys', async () => {
      order.push('baileys:second');
    });
    const wwebjs = queue.enqueue('wwebjs', async () => {
      order.push('wwebjs');
    });
    await Promise.resolve();
    await wwebjs;

    expect(order).toEqual(['baileys:first:start', 'wwebjs']);

    baileysFirst.resolve();
    await Promise.all([first, second]);

    expect(order).toEqual([
      'baileys:first:start',
      'wwebjs',
      'baileys:first:end',
      'baileys:second',
    ]);
  });

  it('observes a rejected operation and continues the provider tail', async () => {
    const queue = new WarmCreationAdmissionQueue();
    const failure = new Error('create_failed');
    const failed = queue.enqueue('baileys', async () => {
      throw failure;
    });
    const recovered = jest.fn(async () => undefined);
    const next = queue.enqueue('baileys', recovered);

    await expect(failed).rejects.toBe(failure);
    await next;

    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it('stops admission and reports a bounded incomplete drain', async () => {
    jest.useFakeTimers();
    const queue = new WarmCreationAdmissionQueue();
    const blocked = deferred();
    void queue.enqueue('whatsmeow', () => blocked.promise);
    await Promise.resolve();

    const closing = queue.close(1_000);
    expect(() => queue.enqueue('baileys', async () => undefined)).toThrow(
      WarmCreationAdmissionQueueClosedError
    );

    await jest.advanceTimersByTimeAsync(1_000);
    await expect(closing).resolves.toEqual({
      completed: false,
      pending: 1,
    });

    blocked.resolve();
  });

  it('joins repeated closes and drains every admitted operation', async () => {
    const queue = new WarmCreationAdmissionQueue();
    const blocked = deferred();
    const operation = queue.enqueue('wwebjs', () => blocked.promise);
    await Promise.resolve();

    const firstClose = queue.close(1_000);
    const secondClose = queue.close(1_000);
    expect(secondClose).toBe(firstClose);

    blocked.resolve();
    await operation;
    await expect(firstClose).resolves.toEqual({
      completed: true,
      pending: 0,
    });
  });

  it('rejects excess admission before an acknowledged backlog can grow without bound', () => {
    const queue = new WarmCreationAdmissionQueue({ maxPending: 1 });
    const blocked = deferred();
    void queue.enqueue('baileys', () => blocked.promise);

    expect(() => queue.enqueue('wwebjs', async () => undefined)).toThrow(
      WarmCreationAdmissionQueueSaturatedError
    );

    blocked.resolve();
  });

  it('poisons every lane and invokes the watchdog when an operation stalls', async () => {
    jest.useFakeTimers();
    const onOperationTimeout = jest.fn();
    const queue = new WarmCreationAdmissionQueue({
      operationTimeoutMs: 1_000,
      onOperationTimeout,
    });
    const blocked = deferred();
    const neverStarted = jest.fn(async () => undefined);
    const stalled = queue.enqueue('baileys', () => blocked.promise);
    const queued = queue.enqueue('baileys', neverStarted);

    await jest.advanceTimersByTimeAsync(1_000);

    await expect(stalled).rejects.toBeInstanceOf(
      WarmCreationAdmissionQueueOperationTimeoutError
    );
    await expect(queued).rejects.toBeInstanceOf(
      WarmCreationAdmissionQueueOperationTimeoutError
    );
    expect(onOperationTimeout).toHaveBeenCalledTimes(1);
    expect(neverStarted).not.toHaveBeenCalled();
    expect(() => queue.enqueue('wwebjs', async () => undefined)).toThrow(
      WarmCreationAdmissionQueueClosedError
    );

    const closing = queue.close(1_000);
    await jest.advanceTimersByTimeAsync(1_000);
    await expect(closing).resolves.toEqual({
      completed: false,
      pending: 1,
    });
    blocked.resolve();
  });
});
