import { EventEmitter } from 'node:events';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { commitOffset } from '@core/common/functions/commitOffset';
import { createConsumer } from '@core/common/functions/createConsumer';
import { setWorkerKafkaDispatchAuthorized } from '@core/common/functions/workerKafkaDispatchAuthorization';
import { WHATSAPP_DURABLE_COMMITTED_TOPICS } from '@core/common/functions/kafkaConsumerStartPositionPolicy';
import { getKafkaDispatchGuard } from '@core/common/functions/kafkaDispatchFenceContext';
import { getKafkaConsumerEntityFenceStats } from '@core/common/functions/kafkaConsumerEntityFence';
import {
  MessageUpdatePublishFailedError,
  isMessageUpdatePublishFailedError,
} from '@core/common/exceptions/MessageUpdatePublishFailedError';

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: jest.fn(async () => undefined),
}));

jest.mock('@core/common/functions/connectConsumer', () => ({
  connectConsumer: jest.fn(async (_consumer, _topic, onConnected) => {
    onConnected?.();
  }),
}));

jest.mock('@core/common/functions/createConsumer', () => ({
  createConsumer: jest.fn(),
}));

jest.mock('@core/common/functions/commitOffset', () => ({
  commitOffset: jest.fn(async () => undefined),
}));

jest.mock('@core/common/functions/handleConsumerError', () => ({
  handleConsumerError: jest.fn(),
}));

jest.mock('@core/plugins/kafkaStreams', () => ({}));

class FakeConsumer extends EventEmitter {
  activeAssignmentEpoch = 1;
  private readonly assignmentInvalidationListeners = new Set<
    (partitions?: number[]) => void
  >();
  pause = jest.fn();
  resume = jest.fn();
  unsubscribe = jest.fn();
  disconnect = jest.fn((callback?: () => void) => callback?.());
  __isAssignmentEpochActive = jest.fn(
    (_topic: string, _partition: number, epoch: number) =>
      epoch === this.activeAssignmentEpoch
  );
  __reportProcessingProgress = jest.fn(
    (_topic: string, _partition: number, _offset: number, epoch: number) =>
      epoch === this.activeAssignmentEpoch
  );
  __markProcessingStarted = jest.fn(
    (_topic: string, _partition: number, _offset: number, epoch: number) =>
      epoch === this.activeAssignmentEpoch
  );
  __markProcessingSettled = jest.fn(
    (_topic: string, _partition: number, _offset: number, epoch: number) =>
      epoch === this.activeAssignmentEpoch
  );
  __isLatestAssignmentCutoverCommitted = jest.fn(() => true);
  __subscribeAssignmentInvalidation = jest.fn(
    (listener: (partitions?: number[]) => void) => {
      this.assignmentInvalidationListeners.add(listener);
      return () => {
        this.assignmentInvalidationListeners.delete(listener);
      };
    }
  );
  __restartGenerationWithoutCommit = jest.fn(() => {
    this.activeAssignmentEpoch += 1;
    this.invalidateAssignments();
  });

  invalidateAssignments(partitions?: number[]): void {
    for (const listener of this.assignmentInvalidationListeners) {
      listener(partitions);
    }
  }

  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (
      eventName === 'data' &&
      args[0] &&
      typeof args[0] === 'object' &&
      typeof (args[0] as { consumerAssignmentEpoch?: unknown })
        .consumerAssignmentEpoch !== 'number'
    ) {
      return super.emit(eventName, {
        ...(args[0] as object),
        consumerAssignmentEpoch: this.activeAssignmentEpoch,
      });
    }

    return super.emit(eventName, ...args);
  }

  emitUnfencedData(message: object): boolean {
    return super.emit('data', message);
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function flushPromises(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

describe('KafkaConsumerRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setWorkerKafkaDispatchAuthorized(false);
  });

  it('reports durable handler progress against the exact active record', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const handle = jest.fn(async (_payload, context) => {
      context.reportProgress?.();
    });
    const runner = new KafkaConsumerRunner<{ id: string }>({
      kafka: {} as never,
      topic: 'config.channels.recreate.all',
      groupId: 'group-progress-lease',
      parse: () => ({ id: 'bulk-1' }),
      handle,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      topic: 'config.channels.recreate.all',
      partition: 2,
      offset: 17,
      value: Buffer.from('{}'),
    });
    await flushPromises();

    expect(fakeConsumer.__reportProcessingProgress).toHaveBeenCalledWith(
      'config.channels.recreate.all',
      2,
      17,
      1
    );
    expect(fakeConsumer.__markProcessingStarted).toHaveBeenCalledWith(
      'config.channels.recreate.all',
      2,
      17,
      1
    );
    expect(fakeConsumer.__markProcessingSettled).toHaveBeenCalledWith(
      'config.channels.recreate.all',
      2,
      17,
      1
    );
    expect(commitOffset).toHaveBeenCalled();
    await runner.close();
  });

  it('rejects a retained progress callback after assignment revocation without committing', async () => {
    const fakeConsumer = new FakeConsumer();
    const gate = deferred();
    let reportProgress: (() => void) | undefined;
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const runner = new KafkaConsumerRunner<{ id: string }>({
      kafka: {} as never,
      topic: 'config.channels.recreate.all',
      groupId: 'group-progress-revoked',
      parse: () => ({ id: 'bulk-1' }),
      handle: async (_payload, context) => {
        reportProgress = context.reportProgress;
        await gate.promise;
        context.reportProgress?.();
      },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      topic: 'config.channels.recreate.all',
      partition: 2,
      offset: 17,
      value: Buffer.from('{}'),
    });
    await flushPromises();
    expect(reportProgress).toBeDefined();

    fakeConsumer.activeAssignmentEpoch += 1;
    fakeConsumer.invalidateAssignments([2]);

    expect(() => reportProgress?.()).toThrow(
      'Kafka consumer dispatch authorization was revoked'
    );
    gate.resolve();
    await flushPromises();

    expect(commitOffset).not.toHaveBeenCalled();
    expect(fakeConsumer.__markProcessingSettled).not.toHaveBeenCalled();
    await runner.close();
  });

  it('coerces a protected topic to committed offsets without a discard fence', async () => {
    const fakeConsumer = new FakeConsumer();
    delete (
      fakeConsumer as unknown as {
        __isLatestAssignmentCutoverCommitted?: () => boolean;
      }
    ).__isLatestAssignmentCutoverCommitted;
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      startPosition: 'latest-on-assignment',
      parse: (message) => ({ offset: message.offset }),
      handle: jest.fn(),
    });

    await expect(runner.start()).resolves.toBeUndefined();
    expect(createConsumer).toHaveBeenCalledWith(
      expect.anything(),
      'group-test',
      expect.objectContaining({ startPosition: 'committed' })
    );
    await runner.close();
  });

  it('drops a latest record without assignment epoch before tracking it', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const handle = jest.fn();
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'bootstrap.latest.test',
      groupId: 'group-test',
      startPosition: 'latest-on-assignment',
      parse: (message) => ({ offset: message.offset }),
      handle,
    });

    await runner.start();
    fakeConsumer.emitUnfencedData({
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    await flushPromises();

    expect(handle).not.toHaveBeenCalled();
    expect(commitOffset).not.toHaveBeenCalled();
    expect(
      (
        runner as unknown as {
          partitionCommitStates: Map<number, unknown>;
        }
      ).partitionCommitStates.size
    ).toBe(0);
    expect(fakeConsumer.pause).not.toHaveBeenCalled();

    await runner.close();
  });

  it('drops a committed record without assignment epoch before tracking it', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const handle = jest.fn();
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'internal.chat.direct.message',
      groupId: 'central-group',
      startPosition: 'committed',
      parse: (message) => ({ offset: message.offset }),
      handle,
    });

    await runner.start();
    fakeConsumer.emitUnfencedData({
      topic: 'internal.chat.direct.message',
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    await flushPromises();

    expect(handle).not.toHaveBeenCalled();
    expect(commitOffset).not.toHaveBeenCalled();
    expect(
      (
        runner as unknown as {
          partitionCommitStates: Map<number, unknown>;
        }
      ).partitionCommitStates.size
    ).toBe(0);

    await runner.close();
  });

  it('holds a runtime effect lease through the handler and processed hook', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    let owned = true;
    const lease = {
      assertOwned: jest.fn(() => {
        if (!owned) {
          throw new Error('lease lost');
        }
      }),
      release: jest.fn(async () => {
        owned = false;
        return true;
      }),
    };
    const acquireEffectLease = jest.fn(async () => lease);
    const handle = jest.fn(async (_payload, context) => {
      expect(owned).toBe(true);
      context.assertActive();
    });
    const onProcessed = jest.fn(async (_payload, context) => {
      expect(owned).toBe(true);
      expect(getKafkaDispatchGuard()).toBe(context.assertActive);
      context.assertActive();
    });
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      acquireEffectLease,
      handle,
      onProcessed,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    await flushPromises();

    expect(acquireEffectLease).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(onProcessed).toHaveBeenCalledTimes(1);
    expect(lease.release).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      10
    );

    await runner.close();
  });

  it('propagates the assignment guard through async handler call chains', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const handle = jest.fn(async (_payload, context) => {
      await Promise.resolve();
      expect(getKafkaDispatchGuard()).toBe(context.assertActive);
      getKafkaDispatchGuard()?.();
    });
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 12,
    });
    await flushPromises();

    expect(handle).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      12
    );

    await runner.close();
  });

  it('holds a runtime effect lease through failed and discarded hooks', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    let owned = true;
    const lease = {
      assertOwned: jest.fn(() => {
        if (!owned) {
          throw new Error('lease lost');
        }
      }),
      release: jest.fn(async () => {
        owned = false;
        return true;
      }),
    };
    const onFailed = jest.fn(async (_payload, context) => {
      expect(owned).toBe(true);
      expect(getKafkaDispatchGuard()).toBe(context.assertActive);
    });
    const onDiscarded = jest.fn(async (_payload, context) => {
      expect(owned).toBe(true);
      expect(getKafkaDispatchGuard()).toBe(context.assertActive);
    });
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      acquireEffectLease: jest.fn(async () => lease),
      handle: async () => {
        expect(owned).toBe(true);
        throw new Error('still_failing');
      },
      onFailed,
      onDiscarded,
      maxRetries: 1,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 11,
    });
    await flushPromises(8);

    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onDiscarded).toHaveBeenCalledWith(
      { offset: 11 },
      expect.objectContaining({
        partition: 0,
        offset: 11,
        attempt: 1,
      }),
      expect.any(Error),
      'retry_exhausted'
    );
    expect(lease.release).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      11
    );

    await runner.close();
  });

  it('restarts the generation without committing when a fail-closed discarded hook fails', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const handle = jest.fn(async () => {
      throw new Error('handler failed');
    });
    const onDiscarded = jest.fn(async () => {
      throw new Error('durable compensation unavailable');
    });
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.lifecycle.request',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle,
      onDiscarded,
      failOnDiscardedHookError: true,
      maxRetries: 1,
      logger: { error: jest.fn(), warn: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 12,
    });
    await flushPromises(8);

    expect(handle).toHaveBeenCalledTimes(1);
    expect(onDiscarded).toHaveBeenCalledTimes(1);
    expect(commitOffset).not.toHaveBeenCalled();
    expect(fakeConsumer.__restartGenerationWithoutCommit).toHaveBeenCalledTimes(
      1
    );
    expect(fakeConsumer.__restartGenerationWithoutCommit).toHaveBeenCalledWith(
      'discard hook failed for worker.lifecycle.request[0] at offset 12'
    );

    await runner.close();
  });

  it('restarts the generation without committing when the runtime effect fence closes admission', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const handle = jest.fn(async () => undefined);
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      acquireEffectLease: jest.fn(async () => null),
      handle,
      logger: { warn: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    await flushPromises();

    expect(handle).not.toHaveBeenCalled();
    expect(commitOffset).not.toHaveBeenCalled();
    expect(fakeConsumer.__restartGenerationWithoutCommit).toHaveBeenCalledWith(
      'runtime effect lease admission rejected for upsert.message[0] at offset 10'
    );

    await runner.close();
  });

  it('commits a rejected runtime-fenced event only when explicitly classified as terminal', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const classifyEffectLeaseRejection = jest.fn(
      async () => 'terminal' as const
    );
    const handle = jest.fn(async () => undefined);
    const onDiscarded = jest.fn();
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      acquireEffectLease: jest.fn(async () => null),
      classifyEffectLeaseRejection,
      handle,
      onDiscarded,
      logger: { warn: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    await flushPromises();

    expect(classifyEffectLeaseRejection).toHaveBeenCalledTimes(1);
    expect(handle).not.toHaveBeenCalled();
    expect(onDiscarded).not.toHaveBeenCalled();
    expect(
      fakeConsumer.__restartGenerationWithoutCommit
    ).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      10
    );

    await runner.close();
  });

  it('restarts without commit when runtime lease acquisition throws', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const handle = jest.fn(async () => undefined);
    const onFailed = jest.fn();
    const onDiscarded = jest.fn();
    const transientScopeError = new Error(
      'active auxiliary runtime scope unavailable during activation'
    );
    transientScopeError.name = 'AuxiliaryRuntimeLeaseRaceError';
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      acquireEffectLease: jest.fn(async () => {
        throw transientScopeError;
      }),
      handle,
      onFailed,
      onDiscarded,
      maxRetries: 1,
      logger: { warn: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    await flushPromises();

    expect(handle).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(onDiscarded).not.toHaveBeenCalled();
    expect(commitOffset).not.toHaveBeenCalled();
    expect(fakeConsumer.__restartGenerationWithoutCommit).toHaveBeenCalledWith(
      'runtime effect lease admission check failed for upsert.message[0] at offset 10'
    );

    await runner.close();
  });

  it('retries a classified lease race in the same generation and commits only after lease recovery', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const leaseRace = new Error('auxiliary_runtime_lease_race');
    const allowLease = deferred();
    const effectLease = {
      assertOwned: jest.fn(),
      release: jest.fn(async () => true),
    };
    const acquireEffectLease = jest
      .fn()
      .mockRejectedValueOnce(leaseRace)
      .mockImplementationOnce(async () => {
        await allowLease.promise;
        return effectLease;
      });
    const handle = jest.fn(async () => undefined);
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'update.message.status',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      acquireEffectLease,
      shouldContinueRetryWithoutCommit: (_payload, _context, error) =>
        error === leaseRace,
      handle,
      maxRetries: 1,
      retryDelaysMs: [0],
      logger: { error: jest.fn(), warn: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 2,
      offset: 9,
    });
    for (
      let index = 0;
      index < 20 && acquireEffectLease.mock.calls.length < 2;
      index += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    expect(acquireEffectLease).toHaveBeenCalledTimes(2);
    expect(handle).not.toHaveBeenCalled();
    expect(commitOffset).not.toHaveBeenCalled();
    expect(
      fakeConsumer.__restartGenerationWithoutCommit
    ).not.toHaveBeenCalled();

    allowLease.resolve();
    await flushPromises(8);

    expect(handle).toHaveBeenCalledTimes(1);
    expect(effectLease.release).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'update.message.status',
      2,
      9
    );
    expect(
      fakeConsumer.__restartGenerationWithoutCommit
    ).not.toHaveBeenCalled();

    await runner.close();
  });

  it('commits only after a fenced durable handoff accepts a lease-acquisition race', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const leaseRace = new Error('auxiliary_runtime_lease_race');
    const handle = jest.fn(async () => undefined);
    const recoverEffectLeaseAcquisitionFailure = jest.fn(
      async (_payload, context) => {
        context.reportProgress?.();
        return 'durable_handoff' as const;
      }
    );
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'update.message.status',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      acquireEffectLease: jest.fn(async () => {
        throw leaseRace;
      }),
      recoverEffectLeaseAcquisitionFailure,
      handle,
      logger: { warn: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 2,
      offset: 10,
    });
    await flushPromises(8);

    expect(recoverEffectLeaseAcquisitionFailure).toHaveBeenCalledWith(
      { offset: 10 },
      expect.objectContaining({
        partition: 2,
        offset: 10,
        attempt: 1,
      }),
      leaseRace
    );
    expect(fakeConsumer.__reportProcessingProgress).toHaveBeenCalledWith(
      'update.message.status',
      2,
      10,
      1
    );
    expect(handle).not.toHaveBeenCalled();
    expect(
      fakeConsumer.__restartGenerationWithoutCommit
    ).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'update.message.status',
      2,
      10
    );

    await runner.close();
  });

  it('keeps the current generation and offset while durable handoff persistence is unavailable', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const leaseRace = new Error('auxiliary_runtime_lease_race');
    const persistenceFailure = new Error('redis unavailable');
    const allowHandoff = deferred();
    let recoveryAttempts = 0;
    const recoverEffectLeaseAcquisitionFailure = jest.fn(
      async (_payload, context) => {
        recoveryAttempts += 1;
        if (recoveryAttempts === 1) {
          throw persistenceFailure;
        }
        await allowHandoff.promise;
        context.reportProgress?.();
        return 'durable_handoff' as const;
      }
    );
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'update.message.status',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      acquireEffectLease: jest.fn(async () => {
        throw leaseRace;
      }),
      recoverEffectLeaseAcquisitionFailure,
      shouldContinueRetryWithoutCommit: (_payload, _context, error) =>
        error === persistenceFailure,
      handle: jest.fn(async () => undefined),
      maxRetries: 1,
      retryDelaysMs: [0],
      logger: { error: jest.fn(), warn: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 2,
      offset: 11,
    });
    for (
      let index = 0;
      index < 20 && recoverEffectLeaseAcquisitionFailure.mock.calls.length < 2;
      index += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    expect(recoverEffectLeaseAcquisitionFailure).toHaveBeenCalledTimes(2);
    expect(commitOffset).not.toHaveBeenCalled();
    expect(
      fakeConsumer.__restartGenerationWithoutCommit
    ).not.toHaveBeenCalled();
    expect(fakeConsumer.__reportProcessingProgress).not.toHaveBeenCalled();

    allowHandoff.resolve();
    await flushPromises(8);

    expect(fakeConsumer.__reportProcessingProgress).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'update.message.status',
      2,
      11
    );
    expect(
      fakeConsumer.__restartGenerationWithoutCommit
    ).not.toHaveBeenCalled();

    await runner.close();
  });

  it('fails closed without committing when durable handoff recovery throws an unclassified error', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const recoveryFailure = new Error('durable store rejected the handoff');
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'update.message.status',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      acquireEffectLease: jest.fn(async () => {
        throw new Error('auxiliary_runtime_lease_race');
      }),
      recoverEffectLeaseAcquisitionFailure: jest.fn(async () => {
        throw recoveryFailure;
      }),
      handle: jest.fn(async () => undefined),
      logger: { warn: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 2,
      offset: 12,
    });
    await flushPromises(8);

    expect(commitOffset).not.toHaveBeenCalled();
    expect(fakeConsumer.__reportProcessingProgress).not.toHaveBeenCalled();
    expect(fakeConsumer.__restartGenerationWithoutCommit).toHaveBeenCalledWith(
      'runtime effect lease admission check failed for update.message.status[2] at offset 12'
    );

    await runner.close();
  });

  it('commits a poison record when lease acquisition proves a terminal identity error', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const terminalError = new Error('immutable auxiliary identity invalid');
    terminalError.name = 'UnrecoverableAuxiliaryRuntimeEventError';
    const handle = jest.fn(async () => undefined);
    const onFailed = jest.fn();
    const onDiscarded = jest.fn();
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'update.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      acquireEffectLease: jest.fn(async () => {
        throw terminalError;
      }),
      classifyError: (_payload, _context, error) =>
        error === terminalError ? 'terminal' : 'retryable',
      handle,
      onFailed,
      onDiscarded,
      maxRetries: 1,
      logger: { warn: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    await flushPromises(8);

    expect(handle).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith(
      { offset: 10 },
      expect.any(Object),
      terminalError
    );
    expect(onDiscarded).toHaveBeenCalledWith(
      { offset: 10 },
      expect.any(Object),
      terminalError,
      'terminal_error'
    );
    expect(
      fakeConsumer.__restartGenerationWithoutCommit
    ).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'update.message',
      0,
      10
    );

    await runner.close();
  });

  it('restarts without commit when the terminal lease decision cannot be proven', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      acquireEffectLease: jest.fn(async () => null),
      classifyEffectLeaseRejection: jest.fn(async () => {
        throw new Error('redis unavailable');
      }),
      handle: jest.fn(async () => undefined),
      maxRetries: 1,
      logger: { warn: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    await flushPromises();

    expect(commitOffset).not.toHaveBeenCalled();
    expect(fakeConsumer.__restartGenerationWithoutCommit).toHaveBeenCalledTimes(
      1
    );

    await runner.close();
  });

  it('leaves the record uncommitted and pauses when a consumer lacks the generation restart hook', async () => {
    const fakeConsumer = new FakeConsumer();
    delete (
      fakeConsumer as unknown as {
        __restartGenerationWithoutCommit?: (reason: string) => void;
      }
    ).__restartGenerationWithoutCommit;
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const logger = { error: jest.fn(), warn: jest.fn() };
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      acquireEffectLease: jest.fn(async () => null),
      handle: jest.fn(async () => undefined),
      logger,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    await flushPromises();

    expect(commitOffset).not.toHaveBeenCalled();
    expect(fakeConsumer.pause).toHaveBeenCalledWith([
      { topic: 'upsert.message', partition: 0 },
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ partition: 0, offset: 10 }),
      expect.stringContaining('left uncommitted')
    );

    await runner.close();
  });

  it('commits only contiguous completed offsets per partition', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const offset10 = deferred();
    const offset11 = deferred();
    const handler = jest.fn((payload: { offset: number }) =>
      payload.offset === 10 ? offset10.promise : offset11.promise
    );

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle: handler,
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 11,
    });
    await flushPromises();

    offset11.resolve();
    await flushPromises();

    expect(commitOffset).not.toHaveBeenCalled();

    offset10.resolve();
    await flushPromises();

    expect(commitOffset).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      11
    );

    await runner.close();
  });

  it('coalesces an in-flight duplicate without releasing its offset gap', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const primary = deferred();
    const handle = jest.fn(() => primary.promise);
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({
        operationId: 'operation-1',
        offset: message.offset,
      }),
      resolveCoalesceKey: (payload) => payload.operationId,
      resolveEntityKey: () => 'entity-1',
      preserveEntityOrder: true,
      handle,
      maxInFlightTotal: 2,
      maxInFlightPerPartition: 2,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 11,
    });
    await flushPromises(8);

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(
      { operationId: 'operation-1', offset: 10 },
      expect.anything()
    );
    expect(fakeConsumer.pause).toHaveBeenCalledWith([
      { topic: 'upsert.message', partition: 0 },
    ]);
    expect(fakeConsumer.resume).toHaveBeenCalledWith([
      { topic: 'upsert.message', partition: 0 },
    ]);
    expect(
      (
        runner as unknown as {
          inFlightByPartition: Map<number, number>;
        }
      ).inFlightByPartition.get(0)
    ).toBe(1);
    expect(commitOffset).not.toHaveBeenCalled();

    primary.resolve();
    await flushPromises(8);

    expect(commitOffset).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      11
    );
    expect(
      (
        runner as unknown as {
          activeCoalesceKeys: Map<number, unknown>;
        }
      ).activeCoalesceKeys.size
    ).toBe(0);

    await runner.close();
  });

  it('never coalesces the same semantic key across partitions', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const release = deferred();
    const handle = jest.fn(() => release.promise);
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: () => ({ operationId: 'operation-1' }),
      resolveCoalesceKey: (payload) => payload.operationId,
      handle,
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 2,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 1,
      offset: 10,
    });
    await flushPromises(8);

    expect(handle).toHaveBeenCalledTimes(2);
    expect(commitOffset).not.toHaveBeenCalled();

    release.resolve();
    await flushPromises(8);
    expect(commitOffset).toHaveBeenCalledTimes(2);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      10
    );
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      1,
      10
    );
    await runner.close();
  });

  it('clears coalesce ownership on rebalance without reviving stale work', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const stalePrimary = deferred();
    const currentPrimary = deferred();
    const handledEpochs: number[] = [];
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({
        assignmentEpoch: message.consumerAssignmentEpoch,
        operationId: 'operation-1',
      }),
      resolveCoalesceKey: (payload) => payload.operationId,
      handle: async (payload) => {
        handledEpochs.push(payload.assignmentEpoch ?? -1);
        await (payload.assignmentEpoch === 1
          ? stalePrimary.promise
          : currentPrimary.promise);
      },
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
      consumerAssignmentEpoch: 1,
    });
    await flushPromises();
    expect(handledEpochs).toEqual([1]);

    fakeConsumer.activeAssignmentEpoch = 2;
    fakeConsumer.invalidateAssignments([0]);
    expect(
      (
        runner as unknown as {
          activeCoalesceKeys: Map<number, unknown>;
        }
      ).activeCoalesceKeys.size
    ).toBe(0);

    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
      consumerAssignmentEpoch: 2,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 11,
      consumerAssignmentEpoch: 2,
    });
    await flushPromises(8);
    expect(handledEpochs).toEqual([1, 2]);
    expect(commitOffset).not.toHaveBeenCalled();

    currentPrimary.resolve();
    await flushPromises(8);
    expect(commitOffset).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      11
    );

    stalePrimary.resolve();
    await flushPromises(8);
    expect(commitOffset).toHaveBeenCalledTimes(1);
    await runner.close();
  });

  it('preserves both records for redelivery when restarted before the primary finishes', async () => {
    const firstConsumer = new FakeConsumer();
    const replacementConsumer = new FakeConsumer();
    (createConsumer as jest.Mock)
      .mockReturnValueOnce(firstConsumer)
      .mockReturnValueOnce(replacementConsumer);
    const abandonedPrimary = deferred();
    const firstHandle = jest.fn(() => abandonedPrimary.promise);
    const firstRunner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({
        operationId: 'operation-1',
        offset: message.offset,
      }),
      resolveCoalesceKey: (payload) => payload.operationId,
      handle: firstHandle,
      maxInFlightTotal: 2,
      maxInFlightPerPartition: 2,
      shutdownDrainTimeoutMs: 1,
    });

    await firstRunner.start();
    firstConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 20,
    });
    firstConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 21,
    });
    await flushPromises(8);
    expect(firstHandle).toHaveBeenCalledTimes(1);
    expect(commitOffset).not.toHaveBeenCalled();

    await firstRunner.close();
    expect(commitOffset).not.toHaveBeenCalled();
    expect(
      (
        firstRunner as unknown as {
          activeCoalesceKeys: Map<number, unknown>;
        }
      ).activeCoalesceKeys.size
    ).toBe(0);

    const replacementHandle = jest.fn(async () => undefined);
    const replacementRunner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({
        operationId: 'operation-1',
        offset: message.offset,
      }),
      resolveCoalesceKey: (payload) => payload.operationId,
      handle: replacementHandle,
      maxInFlightTotal: 2,
      maxInFlightPerPartition: 2,
    });

    await replacementRunner.start();
    replacementConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 20,
    });
    replacementConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 21,
    });
    await flushPromises(8);

    expect(replacementHandle).toHaveBeenCalledTimes(1);
    expect(replacementHandle).toHaveBeenCalledWith(
      { operationId: 'operation-1', offset: 20 },
      expect.anything()
    );
    expect(commitOffset).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      replacementConsumer,
      'upsert.message',
      0,
      21
    );

    abandonedPrimary.resolve();
    await flushPromises(8);
    expect(commitOffset).toHaveBeenCalledTimes(1);
    await replacementRunner.close();
  });

  it('commits the completed delivered prefix across compacted offset gaps', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const offset10 = deferred();
    const offset12 = deferred();
    const handler = jest.fn((payload: { offset: number }) =>
      payload.offset === 10 ? offset10.promise : offset12.promise
    );

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'user.phone.jid.update',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle: handler,
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 12,
    });
    await flushPromises();

    offset12.resolve();
    await flushPromises();
    expect(commitOffset).not.toHaveBeenCalled();

    offset10.resolve();
    await flushPromises();

    expect(commitOffset).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'user.phone.jid.update',
      0,
      12
    );

    await runner.close();
  });

  it('retries only the offset flush when a commit fails after the handler completed', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    (commitOffset as jest.Mock)
      .mockRejectedValueOnce(new Error('commit unavailable'))
      .mockResolvedValue(undefined);
    const handle = jest.fn(async () => undefined);
    const onFailed = jest.fn();
    const logger = { error: jest.fn() };
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle,
      onFailed,
      maxRetries: 3,
      logger,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
    });
    await flushPromises(8);

    expect(handle).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'upsert.message',
        partition: 0,
        offset: 10,
      }),
      'Kafka consumer offset commit failed after processing; handler will not be replayed'
    );

    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 11,
    });
    await flushPromises(8);

    expect(handle).toHaveBeenCalledTimes(2);
    expect(onFailed).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenLastCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      11
    );

    await runner.close();
  });

  it('uses the processing timeout as a watchdog without starting an overlapping retry', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const originalAttempt = deferred();
    const handle = jest.fn(() => originalAttempt.promise);
    const logger = { warn: jest.fn() };
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'official.whatsapp.webhook.event',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle,
      processingTimeoutMs: 5,
      maxRetries: 3,
      logger,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 20,
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 15));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'official.whatsapp.webhook.event',
        partition: 0,
        offset: 20,
        timeoutMs: 5,
      }),
      'Kafka consumer handler exceeded its processing watchdog; waiting for the original attempt to settle'
    );
    expect(commitOffset).not.toHaveBeenCalled();

    originalAttempt.resolve();
    await flushPromises(8);

    expect(handle).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'official.whatsapp.webhook.event',
      0,
      20
    );

    await runner.close();
  });

  it('pauses and resumes partitions when in-flight limit is reached', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const task = deferred();
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle: () => task.promise,
      maxInFlightTotal: 1,
      maxInFlightPerPartition: 1,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 3,
      offset: 42,
    });
    await flushPromises();

    expect(fakeConsumer.pause).toHaveBeenCalledWith([
      { topic: 'upsert.message', partition: 3 },
    ]);

    task.resolve();
    await flushPromises();

    expect(fakeConsumer.resume).toHaveBeenCalledWith([
      { topic: 'upsert.message', partition: 3 },
    ]);

    await runner.close();
  });

  it('does not serialize messages with the same Kafka key by default', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const releaseFirst = deferred();
    const releaseSecond = deferred();
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle: async (payload: { offset: number }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        started.push(payload.offset);
        await (payload.offset === 1
          ? releaseSecond.promise
          : releaseFirst.promise);
        active -= 1;
      },
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      key: Buffer.from('same-key'),
      partition: 0,
      offset: 0,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      key: Buffer.from('same-key'),
      partition: 0,
      offset: 1,
    });
    await flushPromises();

    expect(started).toEqual([0, 1]);
    expect(maxActive).toBe(2);

    releaseSecond.resolve();
    releaseFirst.resolve();
    await flushPromises();
    await runner.close();
  });

  it('serializes messages for the same entity only when requested', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const releaseFirst = deferred();
    const releaseSecond = deferred();
    const started: number[] = [];

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      resolveEntityKey: () => 'chat:a',
      preserveEntityOrder: true,
      handle: async (payload: { offset: number }) => {
        started.push(payload.offset);
        await (payload.offset === 1
          ? releaseSecond.promise
          : releaseFirst.promise);
      },
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      key: Buffer.from('malformed-chat'),
      partition: 0,
      offset: 0,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 1,
    });
    await flushPromises();

    expect(started).toEqual([0]);
    expect(
      fakeConsumer.__markProcessingStarted.mock.calls.map((call) => call[2])
    ).toEqual([0]);

    releaseFirst.resolve();
    await flushPromises();

    expect(started).toEqual([0, 1]);
    expect(
      fakeConsumer.__markProcessingStarted.mock.calls.map((call) => call[2])
    ).toEqual([0, 1]);

    releaseSecond.resolve();
    await flushPromises();
    await runner.close();
  });

  it('falls back to record identity when an entity resolver throws without leaving a commit gap', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const logger = { error: jest.fn() };
    const handle = jest.fn(async () => undefined);
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      resolveEntityKey: (payload: { offset: number }) => {
        if (payload.offset === 0) {
          throw new TypeError('malformed account id');
        }
        return 'chat:valid';
      },
      preserveEntityOrder: true,
      handle,
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
      logger,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 0,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 1,
    });
    await flushPromises(8);

    expect(handle).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'worker.w1.send.message',
        groupId: 'group-test',
        partition: 0,
        offset: 0,
      }),
      'Kafka consumer runner entity key resolver failed; using record identity fallback'
    );
    expect(commitOffset).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'worker.w1.send.message',
      0,
      1
    );

    await runner.close();
  });

  it('continues an ordered entity after a handler failure', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const started: number[] = [];
    const logger = { error: jest.fn() };
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      resolveEntityKey: () => 'chat:acc:chat',
      preserveEntityOrder: true,
      handle: async (payload: { offset: number }) => {
        started.push(payload.offset);
        if (payload.offset === 0) {
          throw new Error('send_failed');
        }
      },
      maxRetries: 1,
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
      logger,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 0,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 1,
    });

    await flushPromises(8);

    expect(started).toEqual([0, 1]);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'worker.w1.send.message',
      0,
      1
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'worker.w1.send.message',
        groupId: 'group-test',
        partition: 0,
        offset: 0,
        attempts: 1,
      }),
      'Kafka consumer runner exhausted retries; discarding message'
    );

    await runner.close();
  });

  it('commits invalid messages even when parser or invalid hook fails', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: () => {
        throw new Error('parse_failed');
      },
      handle: jest.fn(),
      onInvalidMessage: () => {
        throw new Error('invalid_hook_failed');
      },
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
      logger: { error: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{'),
      partition: 0,
      offset: 0,
    });

    await flushPromises();

    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      0
    );

    await runner.close();
  });

  it('commits and reports terminal errors without retrying them', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const handle = jest.fn(async () => {
      throw new Error('terminal_payload');
    });
    const onDiscarded = jest.fn();

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle,
      classifyError: () => 'terminal',
      onDiscarded,
      maxRetries: 5,
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
      logger: { warn: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 7,
    });
    await flushPromises();

    expect(handle).toHaveBeenCalledTimes(1);
    expect(onDiscarded).toHaveBeenCalledWith(
      { offset: 7 },
      expect.objectContaining({
        partition: 0,
        offset: 7,
        attempt: 1,
      }),
      expect.any(Error),
      'terminal_error'
    );
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      7
    );

    await runner.close();
  });

  it('reports retry exhaustion before committing the failed offset', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const onDiscarded = jest.fn();
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle: async () => {
        throw new Error('still_failing');
      },
      onDiscarded,
      maxRetries: 1,
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
      logger: { error: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 9,
    });
    await flushPromises(8);

    expect(onDiscarded).toHaveBeenCalledWith(
      { offset: 9 },
      expect.objectContaining({
        partition: 0,
        offset: 9,
        attempt: 1,
      }),
      expect.any(Error),
      'retry_exhausted'
    );
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'upsert.message',
      0,
      9
    );

    await runner.close();
  });

  it('keeps the offset uncommitted after bounded retries and commits only after recovery', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const updatePublishError = new Error('update_message_publish_failed');
    const allowRecovery = deferred();
    const onDiscarded = jest.fn();
    let attempts = 0;
    const handle = jest.fn(async () => {
      attempts += 1;
      if (attempts <= 2) {
        throw updatePublishError;
      }
      await allowRecovery.promise;
    });
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-underchat-send-w1',
      parse: (message) => ({ offset: message.offset }),
      handle,
      maxRetries: 2,
      retryDelaysMs: [0],
      shouldContinueRetryWithoutCommit: (_payload, _context, error) =>
        error === updatePublishError,
      onDiscarded,
      logger: { error: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 21,
    });

    for (
      let index = 0;
      index < 20 && handle.mock.calls.length < 3;
      index += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    expect(handle).toHaveBeenCalledTimes(3);
    expect(commitOffset).not.toHaveBeenCalled();
    expect(onDiscarded).not.toHaveBeenCalled();

    allowRecovery.resolve();
    await flushPromises(8);

    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'worker.w1.send.message',
      0,
      21
    );
    expect(onDiscarded).not.toHaveBeenCalled();

    await runner.close();
  });

  it('never commits notification/schedule technical redrive after three retries and resumes only after recovery', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const allowRecovery = deferred();
    const onDiscarded = jest.fn();
    const technicalFailure = new MessageUpdatePublishFailedError(
      new Error('provider unavailable before start')
    );
    let attempts = 0;
    const handle = jest.fn(async () => {
      attempts += 1;
      if (attempts <= 3) {
        throw technicalFailure;
      }
      await allowRecovery.promise;
    });
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.schedule.send.message',
      groupId: 'group-underchat-schedule-w1',
      startPosition: 'committed',
      parse: (message) => ({ offset: message.offset }),
      handle,
      maxRetries: 3,
      retryDelaysMs: [0],
      shouldContinueRetryWithoutCommit: (_payload, _context, error) =>
        isMessageUpdatePublishFailedError(error),
      onDiscarded,
      logger: { error: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 22,
    });

    for (
      let index = 0;
      index < 30 && handle.mock.calls.length < 4;
      index += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    expect(handle).toHaveBeenCalledTimes(4);
    expect(commitOffset).not.toHaveBeenCalled();
    expect(onDiscarded).not.toHaveBeenCalled();

    allowRecovery.resolve();
    await flushPromises(8);

    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'worker.w1.schedule.send.message',
      0,
      22
    );
    expect(onDiscarded).not.toHaveBeenCalled();

    await runner.close();
  });

  it('does not block close forever when a task is stuck', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'upsert.message',
      groupId: 'group-test',
      parse: (message) => ({ offset: message.offset }),
      handle: () => new Promise<void>(() => undefined),
      maxInFlightTotal: 1,
      maxInFlightPerPartition: 1,
      shutdownDrainTimeoutMs: 1,
      logger: { warn: jest.fn() },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 0,
    });
    await flushPromises();

    await expect(runner.close()).resolves.toBeUndefined();
    expect(fakeConsumer.disconnect).toHaveBeenCalled();
  });

  it('waits for managed native shutdown beyond the legacy outer timeout', async () => {
    jest.useFakeTimers();
    const fakeConsumer = new FakeConsumer();
    fakeConsumer.disconnect.mockImplementation((callback?: () => void) => {
      setTimeout(() => callback?.(), 6_000);
    });
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);

    try {
      const runner = new KafkaConsumerRunner({
        kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
        topic: 'worker.w1.send.message',
        groupId: 'group-test',
        parse: () => ({}),
        handle: async () => undefined,
      });

      await runner.start();
      const closing = runner.close();
      const closed = jest.fn();
      void closing.then(closed);

      await jest.advanceTimersByTimeAsync(5_000);
      expect(closed).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1_000);
      await expect(closing).resolves.toBeUndefined();
      expect(closed).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops admission, drains the accepted handler and commits before disconnecting', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const acceptedHandler = deferred();
    const handle = jest.fn(() => acceptedHandler.promise);
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-test',
      startPosition: 'committed',
      parse: (message) => ({ offset: message.offset }),
      handle,
      maxInFlightTotal: 1,
      maxInFlightPerPartition: 1,
      shutdownDrainTimeoutMs: 5_000,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 0,
    });
    await flushPromises();
    expect(handle).toHaveBeenCalledTimes(1);

    const closing = runner.close();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 1,
    });
    await flushPromises();

    expect(handle).toHaveBeenCalledTimes(1);
    expect(fakeConsumer.disconnect).not.toHaveBeenCalled();
    expect(commitOffset).not.toHaveBeenCalled();

    acceptedHandler.resolve();
    await closing;

    expect(commitOffset).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'worker.w1.send.message',
      0,
      0
    );
    expect(fakeConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(
      (commitOffset as jest.Mock).mock.invocationCallOrder[0]
    ).toBeLessThan(fakeConsumer.disconnect.mock.invocationCallOrder[0]);
  });

  it('quarantines a redelivered entity across runner replacement until the old handler settles', async () => {
    setWorkerKafkaDispatchAuthorized(true);
    const oldConsumer = new FakeConsumer();
    const waitingConsumer = new FakeConsumer();
    const replacementConsumer = new FakeConsumer();
    (createConsumer as jest.Mock)
      .mockReturnValueOnce(oldConsumer)
      .mockReturnValueOnce(waitingConsumer)
      .mockReturnValueOnce(replacementConsumer);

    const oldHandler = deferred();
    const oldHandle = jest.fn(() => oldHandler.promise);
    const waitingHandle = jest.fn(async () => undefined);
    const replacementHandle = jest.fn(async () => undefined);
    const topic = 'worker.fence-test.send.message';
    const groupId = 'worker-fence-test-send';
    const baseline = getKafkaConsumerEntityFenceStats();
    const kafkaA = {
      createConsumer: jest.fn(),
      getBroker: jest.fn(() => 'broker-b:9092, broker-a:9092'),
    } as never;
    const kafkaB = {
      createConsumer: jest.fn(),
      getBroker: jest.fn(() => 'broker-a:9092,broker-b:9092'),
    } as never;
    const commonOptions = {
      topic,
      groupId,
      parse: (message: { value: Buffer | null }) =>
        JSON.parse(message.value?.toString('utf8') ?? '{}') as {
          entity: string;
        },
      resolveEntityKey: (payload: { entity: string }) => payload.entity,
      preserveEntityOrder: false,
      requireDispatchAuthorization: true,
      shutdownDrainTimeoutMs: 1,
    };

    const oldRunner = new KafkaConsumerRunner({
      ...commonOptions,
      kafka: kafkaA,
      handle: oldHandle,
    });
    await oldRunner.start();
    oldConsumer.emit('data', {
      value: Buffer.from('{"entity":"shared"}'),
      partition: 0,
      offset: 0,
    });
    await flushPromises();
    expect(oldHandle).toHaveBeenCalledTimes(1);

    await oldRunner.close();
    expect(getKafkaConsumerEntityFenceStats()).toEqual({
      active_fence_count: baseline.active_fence_count + 1,
      waiting_count: baseline.waiting_count,
    });

    const waitingRunner = new KafkaConsumerRunner({
      ...commonOptions,
      kafka: kafkaB,
      handle: waitingHandle,
    });
    await waitingRunner.start();
    waitingConsumer.emit('data', {
      value: Buffer.from('{"entity":"shared"}'),
      partition: 0,
      offset: 0,
    });
    waitingConsumer.emit('data', {
      value: Buffer.from('{"entity":"independent"}'),
      partition: 0,
      offset: 1,
    });
    await flushPromises(8);

    expect(waitingHandle).toHaveBeenCalledTimes(1);
    expect(waitingHandle).toHaveBeenCalledWith(
      { entity: 'independent' },
      expect.anything()
    );
    expect(getKafkaConsumerEntityFenceStats()).toEqual({
      active_fence_count: baseline.active_fence_count + 1,
      waiting_count: baseline.waiting_count + 1,
    });

    await waitingRunner.close();
    expect(waitingHandle).toHaveBeenCalledTimes(1);
    expect(getKafkaConsumerEntityFenceStats()).toEqual({
      active_fence_count: baseline.active_fence_count + 1,
      waiting_count: baseline.waiting_count,
    });

    const replacementRunner = new KafkaConsumerRunner({
      ...commonOptions,
      kafka: kafkaA,
      handle: replacementHandle,
    });
    await replacementRunner.start();
    replacementConsumer.emit('data', {
      value: Buffer.from('{"entity":"shared"}'),
      partition: 0,
      offset: 0,
    });
    await flushPromises();

    expect(replacementHandle).not.toHaveBeenCalled();
    expect(getKafkaConsumerEntityFenceStats().waiting_count).toBe(
      baseline.waiting_count + 1
    );

    oldHandler.resolve();
    await flushPromises(12);

    expect(waitingHandle).toHaveBeenCalledTimes(1);
    expect(replacementHandle).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(replacementConsumer, topic, 0, 0);
    expect(getKafkaConsumerEntityFenceStats()).toEqual(baseline);

    await replacementRunner.close();
  });

  it('keeps identical entity keys isolated across distinct consumer scopes', async () => {
    const firstConsumer = new FakeConsumer();
    const isolatedConsumer = new FakeConsumer();
    (createConsumer as jest.Mock)
      .mockReturnValueOnce(firstConsumer)
      .mockReturnValueOnce(isolatedConsumer);
    const firstHandler = deferred();
    const firstHandle = jest.fn(() => firstHandler.promise);
    const isolatedHandle = jest.fn(async () => undefined);
    const kafka = {
      createConsumer: jest.fn(),
      getBroker: jest.fn(() => 'broker-a:9092,broker-b:9092'),
    } as never;
    const firstRunner = new KafkaConsumerRunner({
      kafka,
      topic: 'worker.fence-scope-a.send.message',
      groupId: 'worker-fence-scope-a-send',
      parse: () => ({ entity: 'same' }),
      resolveEntityKey: (payload) => payload.entity,
      preserveEntityOrder: true,
      handle: firstHandle,
    });
    const isolatedRunner = new KafkaConsumerRunner({
      kafka,
      topic: 'worker.fence-scope-b.send.message',
      groupId: 'worker-fence-scope-b-send',
      parse: () => ({ entity: 'same' }),
      resolveEntityKey: (payload) => payload.entity,
      preserveEntityOrder: true,
      handle: isolatedHandle,
    });

    await firstRunner.start();
    firstConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 0,
    });
    await flushPromises();
    await isolatedRunner.start();
    isolatedConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 0,
    });
    await flushPromises(8);

    expect(firstHandle).toHaveBeenCalledTimes(1);
    expect(isolatedHandle).toHaveBeenCalledTimes(1);

    firstHandler.resolve();
    await flushPromises(8);
    await Promise.all([firstRunner.close(), isolatedRunner.close()]);
  });

  it('keeps the stale generation fenced when restarting the same runner instance', async () => {
    const oldConsumer = new FakeConsumer();
    const replacementConsumer = new FakeConsumer();
    (createConsumer as jest.Mock)
      .mockReturnValueOnce(oldConsumer)
      .mockReturnValueOnce(replacementConsumer);
    const oldHandler = deferred();
    const handle = jest
      .fn()
      .mockImplementationOnce(() => oldHandler.promise)
      .mockImplementation(async () => undefined);
    const topic = 'worker.fence-generation.send.message';
    const runner = new KafkaConsumerRunner({
      kafka: {
        createConsumer: jest.fn(),
        getBroker: jest.fn(() => 'broker-a:9092'),
      } as never,
      topic,
      groupId: 'worker-fence-generation-send',
      parse: () => ({ entity: 'same' }),
      resolveEntityKey: (payload) => payload.entity,
      preserveEntityOrder: true,
      shutdownDrainTimeoutMs: 1,
      handle,
    });

    await runner.start();
    oldConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 0,
    });
    await flushPromises();
    expect(handle).toHaveBeenCalledTimes(1);

    await runner.restart();
    replacementConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 0,
    });
    await flushPromises();
    expect(handle).toHaveBeenCalledTimes(1);

    oldHandler.resolve();
    await flushPromises(12);

    expect(handle).toHaveBeenCalledTimes(2);
    expect(commitOffset).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(replacementConsumer, topic, 0, 0);

    await runner.close();
  });

  it('does not start a replacement after native disconnect requires process replacement', async () => {
    const failedConsumer = new FakeConsumer();
    (
      failedConsumer as FakeConsumer & {
        __health: () => {
          pod_replacement_required: boolean;
          last_error: string;
        };
      }
    ).__health = jest.fn(() => ({
      pod_replacement_required: true,
      last_error: 'Kafka native disconnect timed out',
    }));
    (createConsumer as jest.Mock).mockReturnValue(failedConsumer);
    const runner = new KafkaConsumerRunner({
      kafka: {
        createConsumer: jest.fn(),
        getBroker: jest.fn(() => 'broker-a:9092'),
      } as never,
      topic: 'worker.fence-native-replacement.send.message',
      groupId: 'worker-fence-native-replacement-send',
      parse: () => ({}),
      handle: async () => undefined,
    });

    await runner.start();

    await expect(runner.restart()).rejects.toThrow(
      'Kafka native disconnect timed out'
    );
    expect(createConsumer).toHaveBeenCalledTimes(1);
  });

  it('passes committed positioning and dispatch authorization for worker queues', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const kafka = { createConsumer: jest.fn(), getBroker: jest.fn() } as never;
    const runner = new KafkaConsumerRunner({
      kafka,
      topic: 'worker.w1.send.message',
      groupId: 'group-test',
      startPosition: 'latest-on-assignment',
      requireDispatchAuthorization: true,
      parse: () => ({}),
      handle: async () => undefined,
    });

    await runner.start();

    expect(createConsumer).toHaveBeenCalledWith(kafka, 'group-test', {
      startPosition: 'committed',
      requireDispatchAuthorization: true,
    });
    await runner.close();
  });

  it.each(WHATSAPP_DURABLE_COMMITTED_TOPICS)(
    'enforces committed positioning for the protected topic %s',
    async (topic) => {
      const fakeConsumer = new FakeConsumer();
      (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
      const kafka = {
        createConsumer: jest.fn(),
        getBroker: jest.fn(),
      } as never;
      const runner = new KafkaConsumerRunner({
        kafka,
        topic,
        groupId: 'group-test',
        parse: () => ({}),
        handle: async () => undefined,
      });

      await runner.start();

      expect(createConsumer).toHaveBeenCalledWith(kafka, 'group-test', {
        startPosition: 'committed',
        requireDispatchAuthorization: undefined,
      });
      await runner.close();
    }
  );

  it('does not revive ordered work captured before authorization was revoked', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const first = deferred();
    const handled: number[] = [];
    setWorkerKafkaDispatchAuthorized(true);

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-test',
      startPosition: 'latest-on-assignment',
      requireDispatchAuthorization: true,
      preserveEntityOrder: true,
      resolveEntityKey: () => 'chat:1',
      parse: (message) => ({ offset: message.offset }),
      handle: async (payload: { offset: number }) => {
        handled.push(payload.offset);
        if (payload.offset === 0) {
          await first.promise;
        }
      },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 0,
      consumerAssignmentEpoch: 1,
    });
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 1,
      consumerAssignmentEpoch: 1,
    });
    await flushPromises();
    expect(handled).toEqual([0]);

    setWorkerKafkaDispatchAuthorized(false);
    setWorkerKafkaDispatchAuthorized(true);
    first.resolve();
    await flushPromises(8);

    expect(handled).toEqual([0]);
    expect(commitOffset).not.toHaveBeenCalled();
    await runner.close();
  });

  it('fences a provider boundary reached after authorization was revoked', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const preflight = deferred();
    const providerCall = jest.fn();
    const handlerStarted = jest.fn();
    setWorkerKafkaDispatchAuthorized(true);

    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-test',
      startPosition: 'latest-on-assignment',
      requireDispatchAuthorization: true,
      parse: () => ({}),
      handle: async (_payload, context) => {
        handlerStarted();
        await preflight.promise;
        context.assertActive();
        providerCall();
      },
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 0,
      consumerAssignmentEpoch: 1,
    });
    await flushPromises();
    expect(handlerStarted).toHaveBeenCalledTimes(1);

    setWorkerKafkaDispatchAuthorized(false);
    setWorkerKafkaDispatchAuthorized(true);
    preflight.resolve();
    await flushPromises(8);

    expect(providerCall).not.toHaveBeenCalled();
    expect(commitOffset).not.toHaveBeenCalled();
    await runner.close();
  });

  it('keeps committed consumer startup non-blocking before the ready callback', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    let onConnected: (() => void) | undefined;
    (
      jest.requireMock('@core/common/functions/connectConsumer')
        .connectConsumer as jest.Mock
    ).mockImplementationOnce(async (_consumer, _topic, callback) => {
      onConnected = callback;
    });
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'internal.chat.direct.message',
      groupId: 'central-group',
      parse: () => ({}),
      handle: async () => undefined,
    });

    await expect(runner.start()).resolves.toBeUndefined();
    await expect(runner.start()).resolves.toBeUndefined();
    expect(createConsumer).toHaveBeenCalledTimes(1);

    onConnected?.();
    await runner.close();
  });

  it('coalesces concurrent starts into one consumer until readiness', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const readiness = deferred();
    (
      jest.requireMock('@core/common/functions/connectConsumer')
        .connectConsumer as jest.Mock
    ).mockImplementationOnce(async (_consumer, _topic, onConnected) => {
      await readiness.promise;
      onConnected();
    });
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-test',
      startPosition: 'latest-on-assignment',
      parse: () => ({}),
      handle: async () => undefined,
    });

    const firstStart = runner.start();
    const secondStart = runner.start();
    await flushPromises();

    expect(createConsumer).toHaveBeenCalledTimes(1);
    readiness.resolve();
    await Promise.all([firstStart, secondStart]);

    expect(createConsumer).toHaveBeenCalledTimes(1);
    await runner.close();
  });

  it('waits for an in-progress latest start after its consumer is created', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const readiness = deferred();
    (
      jest.requireMock('@core/common/functions/connectConsumer')
        .connectConsumer as jest.Mock
    ).mockImplementationOnce(async (_consumer, _topic, onConnected) => {
      await readiness.promise;
      onConnected();
    });
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-test',
      startPosition: 'latest-on-assignment',
      parse: () => ({}),
      handle: async () => undefined,
    });

    const firstStart = runner.start();
    await flushPromises();
    expect(runner.consumer).toBe(fakeConsumer);

    let secondResolved = false;
    const secondStart = runner.start().then(() => {
      secondResolved = true;
    });
    await flushPromises();
    expect(secondResolved).toBe(false);

    readiness.resolve();
    await Promise.all([firstStart, secondStart]);
    expect(createConsumer).toHaveBeenCalledTimes(1);
    await runner.close();
  });

  it('closes a failed start and automatically creates a fresh consumer', async () => {
    const previousRetryBase = process.env.KAFKA_CONSUMER_START_RETRY_BASE_MS;
    const previousRetryMax = process.env.KAFKA_CONSUMER_START_RETRY_MAX_MS;
    process.env.KAFKA_CONSUMER_START_RETRY_BASE_MS = '1';
    process.env.KAFKA_CONSUMER_START_RETRY_MAX_MS = '1';
    const firstConsumer = new FakeConsumer();
    const secondConsumer = new FakeConsumer();
    (createConsumer as jest.Mock)
      .mockReturnValueOnce(firstConsumer)
      .mockReturnValueOnce(secondConsumer);
    const connectConsumerMock = jest.requireMock(
      '@core/common/functions/connectConsumer'
    ).connectConsumer as jest.Mock;
    connectConsumerMock
      .mockRejectedValueOnce(new Error('assignment_timeout'))
      .mockImplementationOnce(async (_consumer, _topic, onConnected) => {
        onConnected();
      });
    try {
      const runner = new KafkaConsumerRunner({
        kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
        topic: 'worker.w1.send.message',
        groupId: 'group-test',
        startPosition: 'latest-on-assignment',
        parse: () => ({}),
        handle: async () => undefined,
      });

      await expect(runner.start()).resolves.toBeUndefined();
      expect(firstConsumer.disconnect).toHaveBeenCalledTimes(1);
      expect(createConsumer).toHaveBeenCalledTimes(2);
      expect(runner.consumer).toBe(secondConsumer);

      await runner.close();
    } finally {
      if (previousRetryBase === undefined) {
        delete process.env.KAFKA_CONSUMER_START_RETRY_BASE_MS;
      } else {
        process.env.KAFKA_CONSUMER_START_RETRY_BASE_MS = previousRetryBase;
      }
      if (previousRetryMax === undefined) {
        delete process.env.KAFKA_CONSUMER_START_RETRY_MAX_MS;
      } else {
        process.env.KAFKA_CONSUMER_START_RETRY_MAX_MS = previousRetryMax;
      }
    }
  });

  it('cancels startup while the consumer factory is waiting to retry', async () => {
    const previousRetryBase = process.env.KAFKA_CONSUMER_START_RETRY_BASE_MS;
    const previousRetryMax = process.env.KAFKA_CONSUMER_START_RETRY_MAX_MS;
    process.env.KAFKA_CONSUMER_START_RETRY_BASE_MS = '1000';
    process.env.KAFKA_CONSUMER_START_RETRY_MAX_MS = '1000';
    jest.useFakeTimers();
    (createConsumer as jest.Mock).mockImplementation(() => {
      throw new Error('consumer_factory_unavailable');
    });

    try {
      const runner = new KafkaConsumerRunner({
        kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
        topic: 'worker.w1.send.message',
        groupId: 'group-test',
        startPosition: 'latest-on-assignment',
        parse: () => ({}),
        handle: async () => undefined,
      });

      const starting = runner.start();
      const failedStart = expect(starting).rejects.toThrow(
        'Kafka consumer start cancelled'
      );
      await Promise.resolve();

      const closing = runner.close();
      await jest.advanceTimersByTimeAsync(1000);

      await expect(closing).resolves.toBeUndefined();
      await failedStart;
      expect(createConsumer).toHaveBeenCalledTimes(1);
      expect(runner.consumer).toBeNull();
    } finally {
      jest.useRealTimers();
      if (previousRetryBase === undefined) {
        delete process.env.KAFKA_CONSUMER_START_RETRY_BASE_MS;
      } else {
        process.env.KAFKA_CONSUMER_START_RETRY_BASE_MS = previousRetryBase;
      }
      if (previousRetryMax === undefined) {
        delete process.env.KAFKA_CONSUMER_START_RETRY_MAX_MS;
      } else {
        process.env.KAFKA_CONSUMER_START_RETRY_MAX_MS = previousRetryMax;
      }
    }
  });

  it('aborts a pending start without leaving an orphan consumer', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    let rejectConnection!: (error: Error) => void;
    const pendingConnection = new Promise<void>((_resolve, reject) => {
      rejectConnection = reject;
    });
    (
      jest.requireMock('@core/common/functions/connectConsumer')
        .connectConsumer as jest.Mock
    ).mockImplementationOnce(() => pendingConnection);
    fakeConsumer.disconnect.mockImplementation((callback?: () => void) => {
      rejectConnection(new Error('connection_aborted'));
      callback?.();
    });
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-test',
      startPosition: 'latest-on-assignment',
      parse: () => ({}),
      handle: async () => undefined,
    });

    const starting = runner.start();
    const failedStart = expect(starting).rejects.toThrow('connection_aborted');
    await flushPromises();

    await expect(runner.close()).resolves.toBeUndefined();
    await failedStart;

    expect(fakeConsumer.disconnect).toHaveBeenCalled();
    expect(runner.consumer).toBeNull();
  });

  it('does not run completion hooks or commit after the assignment epoch is revoked', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const firstHandler = deferred();
    const onProcessed = jest.fn();
    const handle = jest.fn((payload: { offset: number }) =>
      payload.offset === 10 ? firstHandler.promise : Promise.resolve()
    );
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-test',
      startPosition: 'latest-on-assignment',
      parse: (message) => ({ offset: message.offset }),
      handle,
      onProcessed,
      maxInFlightTotal: 2,
      maxInFlightPerPartition: 2,
    });

    await runner.start();
    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
      consumerAssignmentEpoch: 1,
    });
    await flushPromises();
    expect(handle).toHaveBeenCalledTimes(1);

    fakeConsumer.activeAssignmentEpoch = 2;
    firstHandler.resolve();
    await flushPromises(8);

    expect(onProcessed).not.toHaveBeenCalled();
    expect(commitOffset).not.toHaveBeenCalled();

    fakeConsumer.emit('data', {
      value: Buffer.from('{}'),
      partition: 0,
      offset: 11,
      consumerAssignmentEpoch: 2,
    });
    await flushPromises(8);

    expect(handle).toHaveBeenCalledTimes(2);
    expect(onProcessed).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'worker.w1.send.message',
      0,
      11
    );

    await runner.close();
  });

  it('fences an in-flight committed handler and its commit after rebalance', async () => {
    const fakeConsumer = new FakeConsumer();
    (createConsumer as jest.Mock).mockReturnValue(fakeConsumer);
    const firstHandler = deferred();
    const onProcessed = jest.fn();
    const handle = jest.fn((payload: { offset: number }) =>
      payload.offset === 10 ? firstHandler.promise : Promise.resolve()
    );
    const runner = new KafkaConsumerRunner({
      kafka: { createConsumer: jest.fn(), getBroker: jest.fn() } as never,
      topic: 'internal.chat.direct.message',
      groupId: 'central-group',
      startPosition: 'committed',
      parse: (message) => ({ offset: message.offset }),
      handle,
      onProcessed,
      maxInFlightTotal: 2,
      maxInFlightPerPartition: 2,
    });

    await runner.start();
    fakeConsumer.emitUnfencedData({
      topic: 'internal.chat.direct.message',
      value: Buffer.from('{}'),
      partition: 0,
      offset: 10,
      consumerAssignmentEpoch: 1,
    });
    await flushPromises();
    expect(handle).toHaveBeenCalledTimes(1);

    fakeConsumer.activeAssignmentEpoch = 2;
    firstHandler.resolve();
    await flushPromises(8);

    expect(onProcessed).not.toHaveBeenCalled();
    expect(commitOffset).not.toHaveBeenCalled();

    fakeConsumer.emitUnfencedData({
      topic: 'internal.chat.direct.message',
      value: Buffer.from('{}'),
      partition: 0,
      offset: 11,
      consumerAssignmentEpoch: 2,
    });
    await flushPromises(8);

    expect(handle).toHaveBeenCalledTimes(2);
    expect(onProcessed).toHaveBeenCalledTimes(1);
    expect(commitOffset).toHaveBeenCalledWith(
      fakeConsumer,
      'internal.chat.direct.message',
      0,
      11
    );

    await runner.close();
  });
});
