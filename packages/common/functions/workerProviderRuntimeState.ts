export type WorkerProviderRuntime = 'baileys' | 'wwebjs';

type WorkerProviderRuntimeListener = (ready: boolean) => void | Promise<void>;
type WorkerProviderRuntimeDesiredStateListener = (ready: boolean) => void;

type WorkerProviderRuntimeDelivery = (ready: boolean) => Promise<void>;

const listeners = new Map<
  WorkerProviderRuntime,
  Set<WorkerProviderRuntimeDelivery>
>();
const runtimeStates = new Map<WorkerProviderRuntime, boolean>();
const desiredStateListeners = new Map<
  WorkerProviderRuntime,
  Set<WorkerProviderRuntimeDesiredStateListener>
>();

export function getWorkerProviderRuntimeState(
  provider: WorkerProviderRuntime
): boolean | undefined {
  return runtimeStates.get(provider);
}

export function subscribeWorkerProviderRuntimeState(
  provider: WorkerProviderRuntime,
  listener: WorkerProviderRuntimeListener
): () => void {
  let active = true;
  let lastDelivery:
    | {
        ready: boolean;
        promise: Promise<void>;
        failed: boolean;
      }
    | undefined;
  let deliveryTail = Promise.resolve();
  const deliver = (ready: boolean): Promise<void> => {
    if (!active) {
      return Promise.resolve();
    }

    if (lastDelivery?.ready === ready && !lastDelivery.failed) {
      return lastDelivery.promise;
    }

    const deliveryState = {
      ready,
      promise: Promise.resolve(),
      failed: false,
    };
    const delivery = deliveryTail
      .catch(() => undefined)
      .then(async () => {
        if (!active) {
          return;
        }
        await listener(ready);
      })
      .catch((error: unknown) => {
        deliveryState.failed = true;
        throw error;
      });
    deliveryState.promise = delivery;
    lastDelivery = deliveryState;
    deliveryTail = delivery;
    return delivery;
  };
  const providerListeners = listeners.get(provider) ?? new Set();
  providerListeners.add(deliver);
  listeners.set(provider, providerListeners);

  queueMicrotask(() => {
    if (!active || !providerListeners.has(deliver)) {
      return;
    }
    const currentState = runtimeStates.get(provider);
    if (currentState !== undefined) {
      void deliver(currentState).catch(() => undefined);
    }
  });

  return () => {
    active = false;
    providerListeners.delete(deliver);
    if (providerListeners.size === 0) {
      listeners.delete(provider);
    }
  };
}

export function subscribeWorkerProviderRuntimeDesiredState(
  provider: WorkerProviderRuntime,
  listener: WorkerProviderRuntimeDesiredStateListener
): () => void {
  let active = true;
  let lastDeliveredState: boolean | undefined;
  const deliver = (ready: boolean): void => {
    if (!active || lastDeliveredState === ready) {
      return;
    }
    lastDeliveredState = ready;
    listener(ready);
  };
  const providerListeners =
    desiredStateListeners.get(provider) ??
    new Set<WorkerProviderRuntimeDesiredStateListener>();
  providerListeners.add(deliver);
  desiredStateListeners.set(provider, providerListeners);

  queueMicrotask(() => {
    if (!active || !providerListeners.has(deliver)) {
      return;
    }
    const currentState = runtimeStates.get(provider);
    if (currentState === undefined) {
      return;
    }
    try {
      deliver(currentState);
    } catch {}
  });

  return () => {
    active = false;
    providerListeners.delete(deliver);
    if (providerListeners.size === 0) {
      desiredStateListeners.delete(provider);
    }
  };
}

export function emitWorkerProviderRuntimeState(
  provider: WorkerProviderRuntime,
  ready: boolean
): Promise<void> {
  runtimeStates.set(provider, ready);
  for (const listener of desiredStateListeners.get(provider) ?? []) {
    try {
      listener(ready);
    } catch {}
  }
  return Promise.all(
    Array.from(listeners.get(provider) ?? []).map((listener) => listener(ready))
  ).then(() => undefined);
}
