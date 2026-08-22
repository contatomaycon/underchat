export {};

type RuntimeStateModule =
  typeof import('@core/common/functions/workerProviderRuntimeState');

function loadRuntimeStateModule(): RuntimeStateModule {
  jest.resetModules();
  return require('@core/common/functions/workerProviderRuntimeState') as RuntimeStateModule;
}

async function flushPromises(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe('workerProviderRuntimeState', () => {
  it('exposes the latest desired provider state synchronously', async () => {
    const runtimeState = loadRuntimeStateModule();

    expect(
      runtimeState.getWorkerProviderRuntimeState('baileys')
    ).toBeUndefined();
    const emitted = runtimeState.emitWorkerProviderRuntimeState(
      'baileys',
      false
    );
    expect(runtimeState.getWorkerProviderRuntimeState('baileys')).toBe(false);
    await emitted;
  });

  it('replays the current state to a late subscriber in a microtask', async () => {
    const runtimeState = loadRuntimeStateModule();
    const listener = jest.fn();

    await runtimeState.emitWorkerProviderRuntimeState('baileys', true);
    runtimeState.subscribeWorkerProviderRuntimeState('baileys', listener);

    expect(listener).not.toHaveBeenCalled();
    await flushPromises();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(true);
  });

  it('does not replay a stale or duplicate state when an emit wins the race', async () => {
    const runtimeState = loadRuntimeStateModule();
    const listener = jest.fn();

    await runtimeState.emitWorkerProviderRuntimeState('wwebjs', true);
    runtimeState.subscribeWorkerProviderRuntimeState('wwebjs', listener);
    const emitted = runtimeState.emitWorkerProviderRuntimeState(
      'wwebjs',
      false
    );

    expect(listener).not.toHaveBeenCalled();
    await emitted;
    await flushPromises();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(false);
  });

  it('cancels a pending replay when unsubscribed synchronously', async () => {
    const runtimeState = loadRuntimeStateModule();
    const listener = jest.fn();

    await runtimeState.emitWorkerProviderRuntimeState('baileys', true);
    const unsubscribe = runtimeState.subscribeWorkerProviderRuntimeState(
      'baileys',
      listener
    );
    unsubscribe();
    await flushPromises();

    expect(listener).not.toHaveBeenCalled();
  });

  it('waits for asynchronous listeners before resolving an emit', async () => {
    const runtimeState = loadRuntimeStateModule();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const listener = jest.fn(async () => gate);
    runtimeState.subscribeWorkerProviderRuntimeState('wwebjs', listener);
    let resolved = false;

    const emitting = runtimeState
      .emitWorkerProviderRuntimeState('wwebjs', true)
      .then(() => {
        resolved = true;
      });
    await flushPromises();

    expect(listener).toHaveBeenCalledWith(true);
    expect(resolved).toBe(false);
    release();
    await emitting;
    expect(resolved).toBe(true);
  });

  it('retries the same state after a listener failure', async () => {
    const runtimeState = loadRuntimeStateModule();
    const listener = jest
      .fn()
      .mockRejectedValueOnce(new Error('consumer_start_failed'))
      .mockResolvedValueOnce(undefined);
    runtimeState.subscribeWorkerProviderRuntimeState('baileys', listener);

    await expect(
      runtimeState.emitWorkerProviderRuntimeState('baileys', true)
    ).rejects.toThrow('consumer_start_failed');
    await expect(
      runtimeState.emitWorkerProviderRuntimeState('baileys', true)
    ).resolves.toBeUndefined();

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('redelivers the desired state after an opposite transition fails', async () => {
    const runtimeState = loadRuntimeStateModule();
    const calls: boolean[] = [];
    const listener = jest.fn(async (ready: boolean) => {
      calls.push(ready);
      if (!ready) {
        throw new Error('consumer_close_failed');
      }
    });
    runtimeState.subscribeWorkerProviderRuntimeState('wwebjs', listener);

    await runtimeState.emitWorkerProviderRuntimeState('wwebjs', true);
    await expect(
      runtimeState.emitWorkerProviderRuntimeState('wwebjs', false)
    ).rejects.toThrow('consumer_close_failed');
    await runtimeState.emitWorkerProviderRuntimeState('wwebjs', true);

    expect(calls).toEqual([true, false, true]);
  });

  it('serializes true-false-true without absorbing the final state', async () => {
    const runtimeState = loadRuntimeStateModule();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: boolean[] = [];
    const listener = jest.fn(async (ready: boolean) => {
      calls.push(ready);
      if (calls.length === 1) {
        await firstGate;
      }
    });
    runtimeState.subscribeWorkerProviderRuntimeState('wwebjs', listener);

    const first = runtimeState.emitWorkerProviderRuntimeState('wwebjs', true);
    await flushPromises();
    const second = runtimeState.emitWorkerProviderRuntimeState('wwebjs', false);
    const third = runtimeState.emitWorkerProviderRuntimeState('wwebjs', true);
    await flushPromises();
    expect(calls).toEqual([true]);

    releaseFirst();
    await Promise.all([first, second, third]);

    expect(calls).toEqual([true, false, true]);
  });

  it('publishes desired false synchronously while an async true delivery is pending', async () => {
    const runtimeState = loadRuntimeStateModule();
    let releaseTrue!: () => void;
    const trueGate = new Promise<void>((resolve) => {
      releaseTrue = resolve;
    });
    const delivered: boolean[] = [];
    const desired: boolean[] = [];
    runtimeState.subscribeWorkerProviderRuntimeDesiredState(
      'baileys',
      (ready) => {
        desired.push(ready);
      }
    );
    runtimeState.subscribeWorkerProviderRuntimeState(
      'baileys',
      async (ready) => {
        delivered.push(ready);
        if (ready) {
          await trueGate;
        }
      }
    );

    const starting = runtimeState.emitWorkerProviderRuntimeState(
      'baileys',
      true
    );
    await flushPromises();
    const stopping = runtimeState.emitWorkerProviderRuntimeState(
      'baileys',
      false
    );

    expect(desired).toEqual([true, false]);
    expect(delivered).toEqual([true]);

    releaseTrue();
    await Promise.all([starting, stopping]);
    expect(delivered).toEqual([true, false]);
  });
});
