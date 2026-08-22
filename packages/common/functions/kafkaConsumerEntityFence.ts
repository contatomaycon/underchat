export interface IKafkaConsumerEntityFenceCancellation {
  isCancelled: () => boolean;
  onCancel: (listener: () => void) => () => void;
}

export interface IKafkaConsumerEntityFenceLease {
  release: () => void;
}

export interface IKafkaConsumerEntityFenceStats {
  active_fence_count: number;
  waiting_count: number;
}

interface IKafkaConsumerEntityFenceWaiter {
  token: symbol;
  cancel: () => void;
  grant: (lease: IKafkaConsumerEntityFenceLease) => void;
}

interface IKafkaConsumerEntityFenceEntry {
  owner: symbol;
  waiters: Map<symbol, IKafkaConsumerEntityFenceWaiter>;
}

const processEntityFences = new Map<string, IKafkaConsumerEntityFenceEntry>();

function normalizeBrokerSet(brokers: string): string {
  return (brokers ?? '')
    .split(',')
    .map((broker) => broker.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
}

function buildFenceKey(input: {
  brokers: string;
  groupId: string;
  topic: string;
  entityKey: string;
}): string {
  return JSON.stringify([
    normalizeBrokerSet(input.brokers),
    input.groupId,
    input.topic,
    input.entityKey,
  ]);
}

function createLease(
  fenceKey: string,
  owner: symbol
): IKafkaConsumerEntityFenceLease {
  let released = false;
  return {
    release: () => {
      if (released) {
        return;
      }
      released = true;

      const entry = processEntityFences.get(fenceKey);
      if (!entry || entry.owner !== owner) {
        return;
      }

      const next = entry.waiters.values().next();
      if (!next.done) {
        const waiter = next.value;
        entry.waiters.delete(waiter.token);
        entry.owner = waiter.token;
        waiter.grant(createLease(fenceKey, waiter.token));
        return;
      }

      if (processEntityFences.get(fenceKey) === entry) {
        processEntityFences.delete(fenceKey);
      }
    },
  };
}

/**
 * Serializes irreversible work across runner instances in this process.
 *
 * Closing a runner cancels only its waiters. An owner is intentionally kept
 * until the handler and its hooks actually settle, even after the runner's
 * bounded shutdown drain expires.
 */
export function acquireKafkaConsumerEntityFence(input: {
  brokers: string;
  groupId: string;
  topic: string;
  entityKey: string;
  cancellation: IKafkaConsumerEntityFenceCancellation;
}): Promise<IKafkaConsumerEntityFenceLease | null> {
  if (input.cancellation.isCancelled()) {
    return Promise.resolve(null);
  }

  const fenceKey = buildFenceKey(input);
  const owner = Symbol('kafka-consumer-entity-fence-owner');
  const existing = processEntityFences.get(fenceKey);
  if (!existing) {
    processEntityFences.set(fenceKey, {
      owner,
      waiters: new Map(),
    });
    return Promise.resolve(createLease(fenceKey, owner));
  }

  return new Promise<IKafkaConsumerEntityFenceLease | null>((resolve) => {
    let settled = false;
    let removeCancellationListener = (): void => undefined;
    const finish = (lease: IKafkaConsumerEntityFenceLease | null): void => {
      if (settled) {
        lease?.release();
        return;
      }
      settled = true;
      removeCancellationListener();
      resolve(lease);
    };

    const waiter: IKafkaConsumerEntityFenceWaiter = {
      token: owner,
      cancel: () => {
        if (settled) {
          return;
        }
        const current = processEntityFences.get(fenceKey);
        current?.waiters.delete(owner);
        finish(null);
      },
      grant: (lease) => finish(lease),
    };
    existing.waiters.set(owner, waiter);
    removeCancellationListener = input.cancellation.onCancel(waiter.cancel);

    if (settled) {
      removeCancellationListener();
      return;
    }
    if (input.cancellation.isCancelled()) {
      waiter.cancel();
    }
  });
}

export function getKafkaConsumerEntityFenceStats(): IKafkaConsumerEntityFenceStats {
  let waitingCount = 0;
  for (const entry of processEntityFences.values()) {
    waitingCount += entry.waiters.size;
  }
  return {
    active_fence_count: processEntityFences.size,
    waiting_count: waitingCount,
  };
}
