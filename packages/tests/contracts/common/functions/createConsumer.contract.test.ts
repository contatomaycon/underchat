import { EventEmitter } from 'node:events';
import {
  beginKafkaConsumerGracefulProcessShutdown,
  createConsumer,
  resetKafkaConsumerProcessReplacementForTests,
} from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { setWorkerKafkaDispatchAuthorized } from '@core/common/functions/workerKafkaDispatchAuthorization';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { workerLifecycleBudgets } from '@core/common/functions/workerLifecycleBudgets';

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: jest.fn(async () => undefined),
}));

class FakeKafkaConsumer extends EventEmitter {
  private subscribedTopics: string[] = [];
  private assignedPartitions: Array<{ topic: string; partition: number }> = [];
  private readonly committedOffsets = new Map<string, number>();
  private readonly pausedPartitionKeys = new Set<string>();
  committedOffset = 0;
  highOffset = 0;
  positionOffset = 0;

  constructor(private readonly autoAssign = true) {
    super();
  }

  connect = jest.fn((_metadata: unknown, cb?: (err: Error | null) => void) => {
    cb?.(null);
  });
  getMetadata = jest.fn(
    (
      options: { topic?: string },
      cb?: (err: Error | null, metadata: unknown) => void
    ) => {
      cb?.(null, {
        topics: [
          {
            name: options.topic,
            partitions: [{ id: 0, leader: 1, replicas: [1], isrs: [1] }],
          },
        ],
        brokers: [],
      });
    }
  );
  subscribe = jest.fn((topics: string[]) => {
    this.subscribedTopics = topics;
    if (this.autoAssign) {
      this.assignedPartitions = topics.map((topic) => ({
        topic,
        partition: 0,
      }));
    }
  });
  consume = jest.fn();
  commitSync = jest.fn(
    (
      offsets:
        | Array<{ topic: string; partition: number; offset: number }>
        | { topic: string; partition: number; offset: number }
        | null
    ) => {
      const values = Array.isArray(offsets)
        ? offsets
        : offsets
          ? [offsets]
          : [];
      for (const offset of values) {
        this.committedOffsets.set(
          `${offset.topic}:${offset.partition}`,
          offset.offset
        );
      }
      return this;
    }
  );
  unsubscribe = jest.fn();
  disconnect = jest.fn((cb?: () => void) => {
    cb?.();
  });
  pause = jest.fn(
    (assignments: Array<{ topic: string; partition: number }>) => {
      for (const assignment of assignments) {
        this.pausedPartitionKeys.add(
          `${assignment.topic}:${assignment.partition}`
        );
      }
    }
  );
  resume = jest.fn(
    (assignments: Array<{ topic: string; partition: number }>) => {
      for (const assignment of assignments) {
        this.pausedPartitionKeys.delete(
          `${assignment.topic}:${assignment.partition}`
        );
      }
    }
  );
  assign = jest.fn(
    (assignments: Array<{ topic: string; partition: number }>) => {
      this.pausedPartitionKeys.clear();
      this.assignedPartitions = assignments.map(({ topic, partition }) => ({
        topic,
        partition,
      }));
    }
  );
  reassignRetainingPause = jest.fn(
    (assignments: Array<{ topic: string; partition: number }>) => {
      this.assignedPartitions = assignments.map(({ topic, partition }) => ({
        topic,
        partition,
      }));
    }
  );
  incrementalAssign = this.assign;
  unassign = jest.fn(() => {
    this.pausedPartitionKeys.clear();
    this.assignedPartitions = [];
  });
  incrementalUnassign = this.unassign;
  rebalanceProtocol = jest.fn(() => 'EAGER');
  assignments = jest.fn(() =>
    this.assignedPartitions.map(({ topic, partition }) => ({
      topic,
      partition,
    }))
  );
  committed = jest.fn(
    (
      assignments: Array<{ topic: string; partition: number }>,
      _timeout: number,
      cb?: (
        err: Error | null,
        offsets: Array<{ topic: string; partition: number; offset: number }>
      ) => void
    ) => {
      cb?.(
        null,
        assignments.map((assignment) => ({
          ...assignment,
          offset:
            this.committedOffsets.get(
              `${assignment.topic}:${assignment.partition}`
            ) ?? this.committedOffset,
        }))
      );
    }
  );
  position = jest.fn(
    (assignments: Array<{ topic: string; partition: number }>) =>
      assignments.map((assignment) => ({
        ...assignment,
        offset: this.positionOffset,
      }))
  );
  queryWatermarkOffsets = jest.fn(
    (
      _topic: string,
      _partition: number,
      _timeout: number,
      cb?: (
        err: Error | null,
        offsets: { lowOffset: number; highOffset: number }
      ) => void
    ) => {
      cb?.(null, { lowOffset: 0, highOffset: this.highOffset });
    }
  );
  seek = jest.fn(
    (
      assignment: { topic: string; partition: number; offset: number },
      _timeout: number,
      cb?: (err: Error | null) => void
    ) => {
      this.positionOffset = assignment.offset;
      cb?.(null);
      return this;
    }
  );

  isPartitionPaused(topic: string, partition: number): boolean {
    return this.pausedPartitionKeys.has(`${topic}:${partition}`);
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function flushPromises(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe('createConsumer managed kafka consumer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    setWorkerKafkaDispatchAuthorized(false);
  });

  afterEach(() => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    resetKafkaConsumerProcessReplacementForTests();
    process.env.NODE_ENV = previousNodeEnvironment;
    jest.useRealTimers();
  });

  it('connects without granting the runtime consumer topic-create authority', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1') as any;
    const onConnected = jest.fn();

    const connected = connectConsumer(
      consumer,
      'worker.w1.custom.message',
      onConnected
    );
    await flushPromises();

    expect(ensureKafkaTopic).not.toHaveBeenCalled();
    expect(firstConsumer.connect).toHaveBeenCalledTimes(1);

    firstConsumer.emit('ready');
    await connected;
    await flushPromises();

    expect(firstConsumer.subscribe).toHaveBeenCalledWith([
      'worker.w1.custom.message',
    ]);
    expect(firstConsumer.consume).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('keeps native delivery paused until runner and pending-offset backpressure are both released', async () => {
    const nativeConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(nativeConsumer),
      getBroker: jest.fn(() => 'kafka:9092'),
    };
    const primary = deferred();
    const handle = jest.fn(() => primary.promise);
    const runner = new KafkaConsumerRunner({
      kafka: kafka as never,
      topic: 'worker.lifecycle.request',
      groupId: 'group-coordinated-backpressure',
      parse: (message) => ({
        operationId: 'operation-1',
        offset: message.offset,
      }),
      resolveCoalesceKey: (payload) => payload.operationId,
      handle,
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
    });
    const start = runner.start();
    await flushPromises();
    nativeConsumer.emit('ready');
    await start;

    for (let offset = 0; offset < 4; offset += 1) {
      nativeConsumer.emit('data', {
        topic: 'worker.lifecycle.request',
        partition: 0,
        offset,
        value: Buffer.from('{}'),
      });
    }
    await flushPromises(12);

    expect(handle).toHaveBeenCalledTimes(1);
    expect(
      nativeConsumer.isPartitionPaused('worker.lifecycle.request', 0)
    ).toBe(true);
    expect(nativeConsumer.resume).not.toHaveBeenCalled();
    expect((runner.consumer as any).__health().pending_count).toBe(4);

    let deliveredAfterCap = 0;
    for (let offset = 4; offset < 32; offset += 1) {
      if (nativeConsumer.isPartitionPaused('worker.lifecycle.request', 0)) {
        continue;
      }
      deliveredAfterCap += 1;
      nativeConsumer.emit('data', {
        topic: 'worker.lifecycle.request',
        partition: 0,
        offset,
        value: Buffer.from('{}'),
      });
      await flushPromises();
    }
    expect(deliveredAfterCap).toBe(0);
    expect((runner.consumer as any).__health().pending_count).toBe(4);

    primary.resolve();
    await flushPromises(12);
    await jest.advanceTimersByTimeAsync(1);
    await flushPromises(12);

    expect(nativeConsumer.commitSync).toHaveBeenCalledWith([
      {
        topic: 'worker.lifecycle.request',
        partition: 0,
        offset: 4,
      },
    ]);
    expect(nativeConsumer.resume).toHaveBeenCalledTimes(1);
    expect(
      nativeConsumer.isPartitionPaused('worker.lifecycle.request', 0)
    ).toBe(false);
    await runner.close();
  });

  it('restarts after a settled handler commit failure without locally reexecuting it', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.commitSync.mockImplementationOnce(() => {
      throw new Error('commit unavailable');
    });
    const secondConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(secondConsumer),
      getBroker: jest.fn(() => 'kafka:9092'),
    };
    const handle = jest.fn(async () => undefined);
    const runner = new KafkaConsumerRunner({
      kafka: kafka as never,
      topic: 'config.channels.recreate.all',
      groupId: 'group-settled-commit-failure',
      parse: () => ({ requestId: 'request-1' }),
      handle,
    });
    const start = runner.start();
    await flushPromises();
    firstConsumer.emit('ready');
    await start;

    firstConsumer.emit('data', {
      topic: 'config.channels.recreate.all',
      partition: 0,
      offset: 0,
      value: Buffer.from('{}'),
    });
    await flushPromises(12);
    await jest.advanceTimersByTimeAsync(1);
    await flushPromises(12);

    expect(handle).toHaveBeenCalledTimes(1);
    expect(firstConsumer.commitSync).toHaveBeenCalledTimes(1);
    expect((runner.consumer as any).__health()).toEqual(
      expect.objectContaining({
        pending_count: 1,
        pending_processing_count: 0,
        pending_settled_count: 1,
        restart_count: 1,
      })
    );

    await jest.advanceTimersByTimeAsync(1_000);
    await flushPromises(12);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(secondConsumer.commitSync).not.toHaveBeenCalled();
    await runner.close();
  });

  it('does not let revoked tasks release backpressure owned by a new assignment', async () => {
    const nativeConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(nativeConsumer),
      getBroker: jest.fn(() => 'kafka:9092'),
    };
    const revokedTasks = deferred();
    const currentTask = deferred();
    const runner = new KafkaConsumerRunner({
      kafka: kafka as never,
      topic: 'worker.lifecycle.request',
      groupId: 'group-epoch-backpressure',
      parse: (message) => ({ offset: message.offset }),
      handle: (payload) =>
        payload.offset < 100 ? revokedTasks.promise : currentTask.promise,
      maxInFlightTotal: 4,
      maxInFlightPerPartition: 4,
    });
    const start = runner.start();
    await flushPromises();
    nativeConsumer.emit('ready');
    await start;

    for (let offset = 0; offset < 4; offset += 1) {
      nativeConsumer.emit('data', {
        topic: 'worker.lifecycle.request',
        partition: 0,
        offset,
        value: Buffer.from('{}'),
      });
    }
    await flushPromises();
    expect(
      nativeConsumer.isPartitionPaused('worker.lifecycle.request', 0)
    ).toBe(true);

    const assignment = {
      topic: 'worker.lifecycle.request',
      partition: 0,
      offset: -1000,
    };
    const consumerOptions = kafka.createConsumer.mock.calls[0][1];
    consumerOptions.onPartitionsRevoked([assignment]);
    nativeConsumer.unassign();
    nativeConsumer.assign([assignment]);
    consumerOptions.onPartitionsAssigned([assignment]);
    nativeConsumer.resume.mockClear();

    nativeConsumer.emit('data', {
      topic: assignment.topic,
      partition: assignment.partition,
      offset: 100,
      value: Buffer.from('{}'),
    });
    await flushPromises();

    revokedTasks.resolve();
    await flushPromises(12);

    expect(nativeConsumer.resume).not.toHaveBeenCalled();
    expect(
      (
        runner as unknown as {
          inFlightByPartition: Map<number, number>;
        }
      ).inFlightByPartition.get(0)
    ).toBe(1);

    currentTask.resolve();
    await flushPromises(12);
    await jest.advanceTimersByTimeAsync(1);
    await flushPromises(12);
    await runner.close();
  });

  it('reconciles a retained native pause after committed revoke and reassign before processing and commit', async () => {
    const nativeConsumer = new FakeKafkaConsumer(false);
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(nativeConsumer),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-retained-native-pause'
    ) as any;
    const topic = 'config.channels.recreate.all';
    const received: Array<{
      offset: number;
      consumerAssignmentEpoch: number;
    }> = [];
    consumer.on(
      'data',
      (message: { offset: number; consumerAssignmentEpoch: number }) => {
        received.push(message);
      }
    );

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    nativeConsumer.emit('ready');
    await flushPromises();

    const assignment = { topic, partition: 0, offset: -1001 };
    const options = kafka.createConsumer.mock.calls[0][1];
    nativeConsumer.assign([assignment]);
    options.onPartitionsAssigned([assignment]);
    nativeConsumer.emit('data', {
      topic,
      partition: 0,
      offset: 0,
      value: Buffer.from('{}'),
    });
    const revokedEpoch = received[0]?.consumerAssignmentEpoch;
    expect(typeof revokedEpoch).toBe('number');
    expect(
      consumer.__setRunnerPartitionBackpressure(topic, 0, revokedEpoch, true)
    ).toBe(true);
    expect(nativeConsumer.isPartitionPaused(topic, 0)).toBe(true);

    options.onPartitionsRevoked([assignment]);
    nativeConsumer.reassignRetainingPause([assignment]);
    nativeConsumer.resume.mockClear();
    options.onPartitionsAssigned([assignment]);

    expect(nativeConsumer.resume).toHaveBeenCalledTimes(1);
    expect(nativeConsumer.resume).toHaveBeenCalledWith([
      { topic, partition: 0 },
    ]);
    expect(nativeConsumer.isPartitionPaused(topic, 0)).toBe(false);

    nativeConsumer.emit('data', {
      topic,
      partition: 0,
      offset: 1,
      value: Buffer.from('{}'),
    });
    const activeEpoch = received[1]?.consumerAssignmentEpoch;
    expect(typeof activeEpoch).toBe('number');
    expect(activeEpoch).not.toBe(revokedEpoch);
    expect(consumer.__markProcessingStarted(topic, 0, 1, activeEpoch)).toBe(
      true
    );
    expect(consumer.__markProcessingSettled(topic, 0, 1, activeEpoch)).toBe(
      true
    );
    consumer.commitSync([
      {
        topic,
        partition: 0,
        offset: 2,
        consumerAssignmentEpoch: activeEpoch,
      },
    ]);

    expect(nativeConsumer.commitSync).toHaveBeenCalledWith([
      { topic, partition: 0, offset: 2 },
    ]);
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        connected: true,
        pending_count: 0,
        committed_assignment_resume_reconciliation_count: 0,
        unhealthy: false,
      })
    );
    consumer.disconnect();
  });

  it('does not let duplicate assignment reconciliation reopen active runner backpressure', async () => {
    const nativeConsumer = new FakeKafkaConsumer(false);
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(nativeConsumer),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-current-runner-backpressure'
    ) as any;
    const topic = 'worker.lifecycle.request';
    let assignmentEpoch = 0;
    consumer.on('data', (message: { consumerAssignmentEpoch: number }) => {
      assignmentEpoch = message.consumerAssignmentEpoch;
    });

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    nativeConsumer.emit('ready');
    await flushPromises();

    const assignment = { topic, partition: 0, offset: -1001 };
    const options = kafka.createConsumer.mock.calls[0][1];
    nativeConsumer.assign([assignment]);
    options.onPartitionsAssigned([assignment]);
    nativeConsumer.emit('data', {
      topic,
      partition: 0,
      offset: 0,
      value: Buffer.from('{}'),
    });
    expect(assignmentEpoch).not.toBe(0);
    expect(
      consumer.__setRunnerPartitionBackpressure(topic, 0, assignmentEpoch, true)
    ).toBe(true);
    nativeConsumer.resume.mockClear();

    options.onPartitionsAssigned([assignment]);

    expect(nativeConsumer.resume).not.toHaveBeenCalled();
    expect(nativeConsumer.isPartitionPaused(topic, 0)).toBe(true);
    consumer.disconnect();
  });

  it('fences committed records and commits when their native assignment is still active', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-committed') as any;
    const received: Array<{
      offset: number;
      consumerAssignmentEpoch: number;
    }> = [];
    const assignmentErrors: Error[] = [];
    consumer.on(
      'data',
      (message: { offset: number; consumerAssignmentEpoch: number }) =>
        received.push(message)
    );
    consumer.on('event.error', (error: Error) => assignmentErrors.push(error));

    consumer.subscribe(['internal.chat.direct.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const options = kafka.createConsumer.mock.calls[0][1];
    expect(options).toEqual(
      expect.objectContaining({
        startPosition: 'committed',
        onPartitionsAssigned: expect.any(Function),
        onPartitionsRevoked: expect.any(Function),
        onRebalanceError: expect.any(Function),
      })
    );

    const assignment = {
      topic: 'internal.chat.direct.message',
      partition: 0,
      offset: -1000,
    };
    // Model a native member that owns the partition but whose managed
    // assignment callback was missed. Data must pause and force recovery.
    firstConsumer.assign([assignment]);
    firstConsumer.emit('data', {
      topic: 'internal.chat.direct.message',
      partition: 0,
      offset: 40,
      value: Buffer.from('{}'),
    });
    expect(received).toHaveLength(0);
    expect(assignmentErrors).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          'committed record arrived without an active assignment epoch'
        ),
      }),
    ]);
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        restart_count: 1,
        last_error: expect.stringContaining(
          'committed record arrived without an active assignment epoch'
        ),
      })
    );
    expect(firstConsumer.pause).toHaveBeenCalledWith([
      { topic: 'internal.chat.direct.message', partition: 0 },
    ]);
    firstConsumer.emit('data', {
      topic: 'internal.chat.direct.message',
      partition: 0,
      offset: 41,
      value: Buffer.from('{}'),
    });
    expect(assignmentErrors).toHaveLength(1);
    expect(firstConsumer.pause).toHaveBeenCalledTimes(1);
    expect(consumer.__health().restart_count).toBe(1);

    options.onPartitionsAssigned([assignment]);
    firstConsumer.emit('data', {
      topic: assignment.topic,
      partition: assignment.partition,
      offset: 41,
      value: Buffer.from('{}'),
    });

    expect(received).toHaveLength(1);
    const firstEpoch = received[0].consumerAssignmentEpoch;
    expect(firstEpoch).toEqual(expect.any(Number));
    expect(
      consumer.__isAssignmentEpochActive(
        assignment.topic,
        assignment.partition,
        firstEpoch
      )
    ).toBe(true);

    options.onPartitionsAssigned([assignment]);
    expect(
      consumer.__isAssignmentEpochActive(
        assignment.topic,
        assignment.partition,
        firstEpoch
      )
    ).toBe(true);

    consumer.commitResolvedSync([
      {
        topic: assignment.topic,
        partition: assignment.partition,
        offset: 42,
        consumerAssignmentEpoch: firstEpoch,
      },
    ]);
    expect(firstConsumer.commitSync).toHaveBeenLastCalledWith([
      {
        topic: assignment.topic,
        partition: assignment.partition,
        offset: 42,
      },
    ]);

    const onAssignmentInvalidated = jest.fn();
    consumer.__subscribeAssignmentInvalidation(onAssignmentInvalidated);
    options.onPartitionsRevoked([assignment]);
    firstConsumer.unassign();
    expect(onAssignmentInvalidated).toHaveBeenCalledWith([
      assignment.partition,
    ]);
    expect(
      consumer.__isAssignmentEpochActive(
        assignment.topic,
        assignment.partition,
        firstEpoch
      )
    ).toBe(false);

    consumer.commitResolvedSync([
      {
        topic: assignment.topic,
        partition: assignment.partition,
        offset: 43,
        consumerAssignmentEpoch: firstEpoch,
      },
    ]);
    expect(firstConsumer.commitSync).toHaveBeenCalledTimes(1);

    firstConsumer.emit('data', {
      topic: assignment.topic,
      partition: assignment.partition,
      offset: 42,
      value: Buffer.from('{}'),
    });
    expect(received).toHaveLength(1);

    firstConsumer.assign([assignment]);
    options.onPartitionsAssigned([assignment]);
    firstConsumer.emit('data', {
      topic: assignment.topic,
      partition: assignment.partition,
      offset: 42,
      value: Buffer.from('{}'),
    });
    expect(received).toHaveLength(2);
    expect(received[1].consumerAssignmentEpoch).not.toBe(firstEpoch);

    const secondEpoch = received[1].consumerAssignmentEpoch;
    consumer.disconnect();
    expect(onAssignmentInvalidated).toHaveBeenLastCalledWith(undefined);
    expect(
      consumer.__isAssignmentEpochActive(
        assignment.topic,
        assignment.partition,
        secondEpoch
      )
    ).toBe(false);
  });

  it('restarts from the committed offset without accepting commits from the fenced generation', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    const replacementConsumer = new FakeKafkaConsumer(false);
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(replacementConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-redelivery') as any;

    consumer.subscribe(['worker.worker-1.send.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const assignment = {
      topic: 'worker.worker-1.send.message',
      partition: 0,
      offset: -1000,
    };
    firstConsumer.assign([assignment]);
    const firstOptions = kafka.createConsumer.mock.calls[0][1];
    firstOptions.onPartitionsAssigned([assignment]);

    const assignmentEpoch = consumer.__health().assignment_epoch;
    expect(
      consumer.__isAssignmentEpochActive(
        assignment.topic,
        assignment.partition,
        assignmentEpoch
      )
    ).toBe(true);

    consumer.__restartGenerationWithoutCommit('effect lease admission closed');

    expect(firstConsumer.pause).toHaveBeenCalledWith([
      { topic: assignment.topic, partition: assignment.partition },
    ]);
    expect(
      consumer.__isAssignmentEpochActive(
        assignment.topic,
        assignment.partition,
        assignmentEpoch
      )
    ).toBe(false);
    expect(() =>
      consumer.commitResolvedSync([
        {
          topic: assignment.topic,
          partition: assignment.partition,
          offset: 10,
          consumerAssignmentEpoch: assignmentEpoch,
        },
      ])
    ).toThrow('Kafka consumer is not connected');
    expect(firstConsumer.commitSync).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);
    await flushPromises();

    expect(firstConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);
    expect(replacementConsumer.connect).toHaveBeenCalledTimes(1);
    consumer.disconnect();
  });

  it('connects a protected topic with committed offsets', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'central-group') as any;
    const onConnected = jest.fn();

    const connected = connectConsumer(consumer, 'upsert.message', onConnected);
    await flushPromises();
    firstConsumer.emit('ready');
    await connected;

    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(firstConsumer.connect).toHaveBeenCalledTimes(1);
    expect(consumer.__managedKafkaConsumerStartPosition).toBe('committed');
    consumer.disconnect();
  });

  it('coerces legacy assignment-time end seeking outside tests', () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const consumer = createConsumer(
        { createConsumer: jest.fn() } as never,
        'runtime-guard-group',
        { startPosition: 'latest-on-assignment' }
      ) as any;

      expect(consumer.__managedKafkaConsumerStartPosition).toBe('committed');
    } finally {
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnvironment;
      }
    }
  });

  it('rejects unmanaged durable consumers outside tests', async () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const nativeConsumer = new FakeKafkaConsumer();

      await expect(
        connectConsumer(nativeConsumer as never, 'upsert.message', jest.fn())
      ).rejects.toThrow(
        'Kafka topic upsert.message requires a managed committed-offset consumer'
      );
      expect(nativeConsumer.connect).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnvironment;
      }
    }
  });

  it('resolves managed latest readiness only after OFFSET_END assignment', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const onConnected = jest.fn();
    let resolved = false;

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      onConnected
    ).then(() => {
      resolved = true;
    });
    await flushPromises();

    firstConsumer.emit('ready');
    await flushPromises();
    expect(resolved).toBe(false);
    expect(onConnected).not.toHaveBeenCalled();

    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned([
      { topic: 'worker.w1.send.message', partition: 0, offset: -1 },
    ]);
    await connected;

    expect(firstConsumer.commitSync).toHaveBeenCalledWith([
      { topic: 'worker.w1.send.message', partition: 0, offset: 0 },
    ]);
    expect(resolved).toBe(true);
    expect(onConnected).toHaveBeenCalledTimes(1);
    consumer.disconnect();
  });

  it('keeps a latest consumer ready as standby when the group assigns no partition', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-standby', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const onConnected = jest.fn();
    let resolved = false;

    const connected = connectConsumer(
      consumer,
      'upsert.message',
      onConnected
    ).then(() => {
      resolved = true;
    });
    await flushPromises();

    firstConsumer.emit('ready');
    await flushPromises();
    expect(resolved).toBe(false);

    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned([]);
    await connected;

    expect(resolved).toBe(true);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(firstConsumer.queryWatermarkOffsets).not.toHaveBeenCalled();
    expect(firstConsumer.seek).not.toHaveBeenCalled();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        connected: true,
        consuming: true,
        assignments_ready: true,
        assignment_positioning_count: 0,
        assignments: [],
      })
    );

    jest.advanceTimersByTime(30_000);
    await flushPromises();
    expect(firstConsumer.disconnect).not.toHaveBeenCalled();
    consumer.disconnect();
  });

  it('positions a partition at the current end when a standby later becomes owner', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    firstConsumer.highOffset = 73;
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-standby', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const received = jest.fn();
    consumer.on('data', received);

    const connected = connectConsumer(consumer, 'upsert.message', jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    const options = kafka.createConsumer.mock.calls[0][1];
    options.onPartitionsAssigned([]);
    await connected;

    const assignment = {
      topic: 'upsert.message',
      partition: 0,
      offset: -1,
    };
    firstConsumer.assign([assignment]);
    options.onPartitionsAssigned([assignment]);
    await flushPromises();

    expect(firstConsumer.seek).toHaveBeenCalledWith(
      { ...assignment, offset: 73 },
      expect.any(Number),
      expect.any(Function)
    );
    expect(firstConsumer.commitSync).toHaveBeenCalledWith([
      { ...assignment, offset: 73 },
    ]);
    firstConsumer.emit('data', {
      ...assignment,
      offset: 72,
      value: Buffer.from('{}'),
    });
    expect(received).not.toHaveBeenCalled();

    firstConsumer.emit('data', {
      ...assignment,
      offset: 73,
      value: Buffer.from('{}'),
    });
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({
        offset: 73,
        consumerAssignmentEpoch: expect.any(Number),
      })
    );
    consumer.disconnect();
  });

  it('waits for numeric seeks on every assigned partition before readiness', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    const watermarkCallbacks = new Map<
      number,
      (
        error: Error | null,
        offsets: { lowOffset: number; highOffset: number }
      ) => void
    >();
    const seekCallbacks = new Map<number, (error: Error | null) => void>();
    firstConsumer.queryWatermarkOffsets.mockImplementation(
      (
        _topic: string,
        partition: number,
        _timeout: number,
        callback?: (
          error: Error | null,
          offsets: { lowOffset: number; highOffset: number }
        ) => void
      ) => {
        if (callback) {
          watermarkCallbacks.set(partition, callback);
        }
      }
    );
    firstConsumer.seek.mockImplementation(
      (
        assignment: { topic: string; partition: number; offset: number },
        _timeout: number,
        callback?: (error: Error | null) => void
      ) => {
        if (callback) {
          seekCallbacks.set(assignment.partition, callback);
        }
        return firstConsumer;
      }
    );
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const onConnected = jest.fn();
    let resolved = false;

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      onConnected
    ).then(() => {
      resolved = true;
    });
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    const assignments = [0, 1, 2].map((partition) => ({
      topic: 'worker.w1.send.message',
      partition,
      offset: -1,
    }));
    firstConsumer.assign(assignments);
    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned(assignments);

    expect(firstConsumer.pause).toHaveBeenCalledWith(
      assignments.map(({ topic, partition }) => ({ topic, partition }))
    );
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        assignments_ready: false,
        assignment_positioning_count: 3,
      })
    );
    expect(resolved).toBe(false);
    for (const partition of [0, 1, 2]) {
      watermarkCallbacks.get(partition)?.(null, {
        lowOffset: 0,
        highOffset: 20 + partition,
      });
    }
    await flushPromises();
    expect(firstConsumer.seek).toHaveBeenCalledTimes(3);
    expect(firstConsumer.resume).not.toHaveBeenCalled();

    seekCallbacks.get(0)?.(null);
    seekCallbacks.get(1)?.(null);
    await flushPromises();
    expect(resolved).toBe(false);
    expect(firstConsumer.resume).not.toHaveBeenCalled();

    seekCallbacks.get(2)?.(null);
    await connected;
    expect(firstConsumer.commitSync).toHaveBeenCalledWith([
      { ...assignments[0], offset: 20 },
      { ...assignments[1], offset: 21 },
      { ...assignments[2], offset: 22 },
    ]);
    expect(firstConsumer.commitSync.mock.invocationCallOrder[0]).toBeLessThan(
      firstConsumer.resume.mock.invocationCallOrder[0]
    );
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        assignments_ready: true,
        assignment_positioning_count: 0,
      })
    );
    expect(firstConsumer.resume).toHaveBeenCalledWith(
      assignments.map(({ topic, partition }) => ({ topic, partition }))
    );
    expect(onConnected).toHaveBeenCalledTimes(1);
    consumer.disconnect();
  });

  it('does not dispatch or announce readiness before the cutover commit is confirmed', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    firstConsumer.highOffset = 44;
    let confirmCommitted:
      | ((
          error: Error | null,
          offsets: Array<{
            topic: string;
            partition: number;
            offset: number;
          }>
        ) => void)
      | undefined;
    firstConsumer.committed.mockImplementation(
      (
        _assignments: Array<{ topic: string; partition: number }>,
        _timeout: number,
        callback?: (
          error: Error | null,
          offsets: Array<{
            topic: string;
            partition: number;
            offset: number;
          }>
        ) => void
      ) => {
        confirmCommitted = callback;
      }
    );
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-fenced', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const onConnected = jest.fn();
    const received = jest.fn();
    consumer.on('data', received);
    let resolved = false;

    const connected = connectConsumer(
      consumer,
      'upsert.message',
      onConnected
    ).then(() => {
      resolved = true;
    });
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const assignment = {
      topic: 'upsert.message',
      partition: 0,
      offset: -1,
    };
    firstConsumer.assign([assignment]);
    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned([assignment]);
    await flushPromises();

    expect(firstConsumer.commitSync).toHaveBeenCalledWith([
      { ...assignment, offset: 44 },
    ]);
    expect(firstConsumer.resume).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
    expect(resolved).toBe(false);
    firstConsumer.emit('data', {
      ...assignment,
      offset: 44,
      value: Buffer.from('{}'),
    });
    expect(received).not.toHaveBeenCalled();

    confirmCommitted?.(null, [{ ...assignment, offset: 44 }]);
    await connected;

    expect(firstConsumer.resume).toHaveBeenCalledWith([
      { topic: assignment.topic, partition: assignment.partition },
    ]);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(true);
    consumer.disconnect();
  });

  it('fails closed and disconnects when the cutover watermark commit fails', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    firstConsumer.highOffset = 19;
    firstConsumer.commitSync.mockImplementationOnce(() => {
      throw new Error('cutover_commit_failed');
    });
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-fenced', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const onConnected = jest.fn();
    const connected = connectConsumer(consumer, 'upsert.message', onConnected);
    const rejection = expect(connected).rejects.toThrow(
      'cutover_commit_failed'
    );
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const assignment = {
      topic: 'upsert.message',
      partition: 0,
      offset: -1,
    };
    firstConsumer.assign([assignment]);
    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned([assignment]);
    await rejection;

    expect(onConnected).not.toHaveBeenCalled();
    expect(firstConsumer.resume).not.toHaveBeenCalled();
    expect(firstConsumer.disconnect).toHaveBeenCalledTimes(1);
  });

  it.each([22, 25, 27, -172])(
    'waits for a new assignment instead of restart-looping on stale cutover code %s',
    async (code) => {
      const firstConsumer = new FakeKafkaConsumer(false);
      firstConsumer.highOffset = 19;
      const staleError = new Error(
        'Kafka cutover generation became stale'
      ) as Error & { code: number };
      staleError.code = code;
      firstConsumer.commitSync.mockImplementationOnce(() => {
        throw staleError;
      });
      const kafka = {
        createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
      };
      const consumer = createConsumer(kafka as never, 'group-fenced', {
        startPosition: 'latest-on-assignment',
      }) as any;
      const onConnected = jest.fn();
      const connected = connectConsumer(
        consumer,
        'upsert.message',
        onConnected
      );
      await flushPromises();
      firstConsumer.emit('ready');
      await flushPromises();

      const assignment = {
        topic: 'upsert.message',
        partition: 0,
        offset: -1,
      };
      firstConsumer.assign([assignment]);
      const options = kafka.createConsumer.mock.calls[0][1];
      options.onPartitionsAssigned([assignment]);
      await flushPromises();

      expect(onConnected).not.toHaveBeenCalled();
      expect(firstConsumer.resume).not.toHaveBeenCalled();
      expect(firstConsumer.disconnect).not.toHaveBeenCalled();
      expect(kafka.createConsumer).toHaveBeenCalledTimes(1);

      options.onPartitionsRevoked([assignment]);
      firstConsumer.unassign();
      firstConsumer.highOffset = 20;
      firstConsumer.assign([assignment]);
      options.onPartitionsAssigned([assignment]);
      await connected;

      expect(firstConsumer.commitSync).toHaveBeenCalledTimes(2);
      expect(firstConsumer.commitSync).toHaveBeenLastCalledWith([
        { ...assignment, offset: 20 },
      ]);
      expect(firstConsumer.resume).toHaveBeenCalledWith([
        { topic: assignment.topic, partition: assignment.partition },
      ]);
      expect(onConnected).toHaveBeenCalledTimes(1);
      expect(kafka.createConsumer).toHaveBeenCalledTimes(1);
      expect(firstConsumer.disconnect).not.toHaveBeenCalled();
      consumer.disconnect();
    }
  );

  it('restarts only after the bounded stale-assignment grace expires', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    firstConsumer.highOffset = 19;
    const staleError = new Error('Broker: Rebalance in progress') as Error & {
      code: number;
    };
    staleError.code = 27;
    firstConsumer.commitSync.mockImplementationOnce(() => {
      throw staleError;
    });
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-fenced', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const connected = connectConsumer(consumer, 'upsert.message', jest.fn());
    const rejection = expect(connected).rejects.toThrow(
      'Kafka cutover assignment did not advance after stale generation'
    );
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const assignment = {
      topic: 'upsert.message',
      partition: 0,
      offset: -1,
    };
    firstConsumer.assign([assignment]);
    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned([assignment]);
    await flushPromises();

    jest.advanceTimersByTime(4_999);
    await flushPromises();
    expect(firstConsumer.disconnect).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await rejection;
    expect(firstConsumer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not activate an assignment revoked while commit confirmation is pending', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    firstConsumer.highOffset = 31;
    let confirmCommitted:
      | ((
          error: Error | null,
          offsets: Array<{
            topic: string;
            partition: number;
            offset: number;
          }>
        ) => void)
      | undefined;
    firstConsumer.committed.mockImplementation(
      (
        _assignments: Array<{ topic: string; partition: number }>,
        _timeout: number,
        callback?: (
          error: Error | null,
          offsets: Array<{
            topic: string;
            partition: number;
            offset: number;
          }>
        ) => void
      ) => {
        confirmCommitted = callback;
      }
    );
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-fenced', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const onConnected = jest.fn();
    const received = jest.fn();
    consumer.on('data', received);
    const connected = connectConsumer(consumer, 'upsert.message', onConnected);
    void connected.catch(() => undefined);
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const assignment = {
      topic: 'upsert.message',
      partition: 0,
      offset: -1,
    };
    firstConsumer.assign([assignment]);
    const options = kafka.createConsumer.mock.calls[0][1];
    options.onPartitionsAssigned([assignment]);
    await flushPromises();
    expect(firstConsumer.commitSync).toHaveBeenCalledTimes(1);

    options.onPartitionsRevoked([assignment]);
    firstConsumer.unassign();
    confirmCommitted?.(null, [{ ...assignment, offset: 31 }]);
    await flushPromises();

    expect(onConnected).not.toHaveBeenCalled();
    expect(firstConsumer.resume).not.toHaveBeenCalled();
    firstConsumer.emit('data', {
      ...assignment,
      offset: 31,
      value: Buffer.from('{}'),
    });
    expect(received).not.toHaveBeenCalled();

    consumer.disconnect();
    await connected.catch(() => undefined);
  });

  it('fails closed when the broker does not confirm the exact committed cutover', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    firstConsumer.highOffset = 27;
    firstConsumer.committed.mockImplementation(
      (
        assignments: Array<{ topic: string; partition: number }>,
        _timeout: number,
        callback?: (
          error: Error | null,
          offsets: Array<{
            topic: string;
            partition: number;
            offset: number;
          }>
        ) => void
      ) => {
        callback?.(
          null,
          assignments.map((assignment) => ({
            ...assignment,
            offset: 26,
          }))
        );
      }
    );
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-fenced', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const onConnected = jest.fn();
    const connected = connectConsumer(consumer, 'upsert.message', onConnected);
    const rejection = expect(connected).rejects.toThrow(
      'Kafka cutover offset confirmation failed'
    );
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const assignment = {
      topic: 'upsert.message',
      partition: 0,
      offset: -1,
    };
    firstConsumer.assign([assignment]);
    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned([assignment]);
    await rejection;

    expect(onConnected).not.toHaveBeenCalled();
    expect(firstConsumer.resume).not.toHaveBeenCalled();
    expect(firstConsumer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('treats a committed offset beyond the watermark as an obsolete preparation', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    firstConsumer.highOffset = 27;
    firstConsumer.committed.mockImplementationOnce(
      (
        assignments: Array<{ topic: string; partition: number }>,
        _timeout: number,
        callback?: (
          error: Error | null,
          offsets: Array<{
            topic: string;
            partition: number;
            offset: number;
          }>
        ) => void
      ) => {
        callback?.(
          null,
          assignments.map((assignment) => ({
            ...assignment,
            offset: 28,
          }))
        );
      }
    );
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-fenced', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const onConnected = jest.fn();
    const connected = connectConsumer(consumer, 'upsert.message', onConnected);
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const assignment = {
      topic: 'upsert.message',
      partition: 0,
      offset: -1,
    };
    firstConsumer.assign([assignment]);
    const options = kafka.createConsumer.mock.calls[0][1];
    options.onPartitionsAssigned([assignment]);
    await flushPromises();

    expect(onConnected).not.toHaveBeenCalled();
    expect(firstConsumer.resume).not.toHaveBeenCalled();
    expect(firstConsumer.disconnect).not.toHaveBeenCalled();

    options.onPartitionsRevoked([assignment]);
    firstConsumer.unassign();
    firstConsumer.highOffset = 29;
    firstConsumer.assign([assignment]);
    options.onPartitionsAssigned([assignment]);
    await connected;

    expect(firstConsumer.commitSync).toHaveBeenCalledTimes(2);
    expect(firstConsumer.commitSync).toHaveBeenLastCalledWith([
      { ...assignment, offset: 29 },
    ]);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(firstConsumer.disconnect).not.toHaveBeenCalled();
    consumer.disconnect();
  });

  it('holds positioned assignments until central online authorization is granted', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    firstConsumer.highOffset = 37;
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1', {
      startPosition: 'latest-on-assignment',
      requireDispatchAuthorization: true,
    }) as any;
    const received = jest.fn();
    consumer.on('data', received);

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      jest.fn()
    );
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const assignment = {
      topic: 'worker.w1.send.message',
      partition: 0,
      offset: -1,
    };
    firstConsumer.assign([assignment]);
    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned([assignment]);
    await connected;

    expect(firstConsumer.seek).toHaveBeenCalledWith(
      { ...assignment, offset: 37 },
      expect.any(Number),
      expect.any(Function)
    );
    expect(firstConsumer.resume).not.toHaveBeenCalled();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        assignments_ready: true,
        dispatch_authorized: false,
      })
    );

    firstConsumer.emit('data', {
      ...assignment,
      offset: 36,
      value: Buffer.from('{}'),
    });
    expect(received).not.toHaveBeenCalled();

    firstConsumer.emit('data', {
      ...assignment,
      offset: 37,
      value: Buffer.from('{}'),
    });
    expect(received).not.toHaveBeenCalled();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({ pending_dispatch_authorization_count: 1 })
    );

    setWorkerKafkaDispatchAuthorized(true);
    expect(firstConsumer.resume).toHaveBeenCalledWith([
      { topic: assignment.topic, partition: assignment.partition },
    ]);
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        dispatch_authorized: true,
        pending_dispatch_authorization_count: 0,
      })
    );
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({
        offset: 37,
        consumerAssignmentEpoch: expect.any(Number),
      })
    );

    firstConsumer.emit('data', {
      ...assignment,
      offset: 38,
      value: Buffer.from('{}'),
    });
    expect(received).toHaveBeenLastCalledWith(
      expect.objectContaining({
        offset: 38,
        consumerAssignmentEpoch: expect.any(Number),
      })
    );

    setWorkerKafkaDispatchAuthorized(false);
    expect(firstConsumer.pause).toHaveBeenLastCalledWith([
      { topic: assignment.topic, partition: assignment.partition },
    ]);
    consumer.disconnect();
  });

  it('does not resume when authorization arrives before the high-watermark seek completes', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    firstConsumer.highOffset = 52;
    let completeSeek: ((error: Error | null) => void) | undefined;
    firstConsumer.seek.mockImplementation(
      (
        _assignment: { topic: string; partition: number; offset: number },
        _timeout: number,
        callback?: (error: Error | null) => void
      ) => {
        completeSeek = callback;
        return firstConsumer;
      }
    );
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1', {
      startPosition: 'latest-on-assignment',
      requireDispatchAuthorization: true,
    }) as any;

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      jest.fn()
    );
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const assignment = {
      topic: 'worker.w1.send.message',
      partition: 0,
      offset: -1,
    };
    firstConsumer.assign([assignment]);
    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned([assignment]);
    await flushPromises();
    expect(firstConsumer.seek).toHaveBeenCalled();

    setWorkerKafkaDispatchAuthorized(true);
    expect(firstConsumer.resume).not.toHaveBeenCalled();

    completeSeek?.(null);
    await connected;
    expect(firstConsumer.resume).toHaveBeenCalledWith([
      { topic: assignment.topic, partition: assignment.partition },
    ]);
    consumer.disconnect();
  });

  it('replays revoked records from the committed offset before allowing a later commit', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    const replayConsumer = new FakeKafkaConsumer(false);
    firstConsumer.committedOffset = 37;
    replayConsumer.committedOffset = 37;
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(replayConsumer),
    };
    setWorkerKafkaDispatchAuthorized(true);
    const consumer = createConsumer(kafka as never, 'group-1', {
      startPosition: 'committed',
      requireDispatchAuthorization: true,
    }) as any;
    const receivedOffsets: number[] = [];
    const receivedEpochs: number[] = [];
    consumer.on(
      'data',
      (message: { offset: number; consumerAssignmentEpoch: number }) => {
        receivedOffsets.push(message.offset);
        receivedEpochs.push(message.consumerAssignmentEpoch);
      }
    );

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      jest.fn()
    );
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const assignment = {
      topic: 'worker.w1.send.message',
      partition: 0,
      offset: -1,
    };
    firstConsumer.assign([assignment]);
    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned([assignment]);
    await connected;

    firstConsumer.pause.mockClear();
    firstConsumer.resume.mockClear();
    for (const offset of [37, 38, 39, 40]) {
      firstConsumer.emit('data', {
        ...assignment,
        offset,
        value: Buffer.from('{}'),
      });
    }
    expect(receivedOffsets).toEqual([37, 38, 39, 40]);

    expect(consumer.__health()).toEqual(
      expect.objectContaining({ pending_count: 4 })
    );
    expect(firstConsumer.pause).toHaveBeenCalledWith([
      { topic: assignment.topic, partition: assignment.partition },
    ]);

    setWorkerKafkaDispatchAuthorized(false);
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        dispatch_authorized: false,
        dispatch_replay_required: true,
        pending_count: 4,
      })
    );

    firstConsumer.emit('data', {
      ...assignment,
      offset: 41,
      value: Buffer.from('{}'),
    });
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        pending_count: 4,
        pending_dispatch_authorization_count: 1,
      })
    );

    setWorkerKafkaDispatchAuthorized(true);
    expect(firstConsumer.resume).not.toHaveBeenCalled();
    expect(firstConsumer.commitSync).not.toHaveBeenCalled();
    expect(receivedOffsets).toEqual([37, 38, 39, 40]);
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        dispatch_authorized: true,
        dispatch_replay_required: true,
        connected: false,
        pending_count: 0,
        pending_dispatch_authorization_count: 0,
      })
    );

    // Even if the fenced native member leaks a queued data event before its
    // disconnect completes, it must never dispatch in the restored generation.
    firstConsumer.emit('data', {
      ...assignment,
      offset: 42,
      value: Buffer.from('{}'),
    });
    expect(receivedOffsets).toEqual([37, 38, 39, 40]);

    await jest.advanceTimersByTimeAsync(1000);
    await flushPromises(12);
    expect(firstConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);

    replayConsumer.emit('ready');
    await flushPromises();
    replayConsumer.assign([assignment]);
    kafka.createConsumer.mock.calls[1][1].onPartitionsAssigned([assignment]);
    await flushPromises();

    for (const offset of [37, 38, 39, 40, 41]) {
      replayConsumer.emit('data', {
        ...assignment,
        offset,
        value: Buffer.from('{}'),
      });
    }
    expect(receivedOffsets).toEqual([37, 38, 39, 40, 37, 38, 39, 40, 41]);

    const revokedEpoch = receivedEpochs[0];
    const replayEpoch = receivedEpochs.at(-1);
    expect(replayEpoch).not.toBe(revokedEpoch);
    expect(replayConsumer.commitSync).not.toHaveBeenCalled();

    // Model the business/provider operation: the durable offset is released
    // only after every replayed record has completed successfully.
    const replaySucceeded = deferred();
    const commitAfterSuccess = replaySucceeded.promise.then(() =>
      consumer.commitResolvedSync([
        {
          topic: assignment.topic,
          partition: assignment.partition,
          offset: 42,
          consumerAssignmentEpoch: replayEpoch,
        },
      ])
    );
    await flushPromises();
    expect(replayConsumer.commitSync).not.toHaveBeenCalled();

    replaySucceeded.resolve();
    await commitAfterSuccess;
    expect(replayConsumer.commitSync).toHaveBeenCalledWith([
      {
        topic: assignment.topic,
        partition: assignment.partition,
        offset: 42,
      },
    ]);

    consumer.disconnect();
  });

  it('redelivers ordered runner work and commits only after the replay succeeds', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const replayConsumer = new FakeKafkaConsumer();
    firstConsumer.committedOffset = 37;
    replayConsumer.committedOffset = 37;
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(replayConsumer),
      getBroker: jest.fn(() => 'kafka-a:9092,kafka-b:9092'),
    };
    const firstAttempt = deferred();
    const handledOffsets: number[] = [];
    let invocation = 0;
    setWorkerKafkaDispatchAuthorized(true);

    const runner = new KafkaConsumerRunner<{ offset: number }>({
      kafka: kafka as never,
      topic: 'worker.w1.send.message',
      groupId: 'group-runner-replay',
      startPosition: 'committed',
      requireDispatchAuthorization: true,
      preserveEntityOrder: true,
      resolveEntityKey: () => 'chat:1',
      parse: (message) => ({ offset: message.offset }),
      handle: async ({ offset }) => {
        invocation += 1;
        handledOffsets.push(offset);
        if (invocation === 1) {
          await firstAttempt.promise;
        }
      },
    });

    const started = runner.start();
    await flushPromises();
    firstConsumer.emit('ready');
    await started;

    for (const offset of [37, 38]) {
      firstConsumer.emit('data', {
        topic: 'worker.w1.send.message',
        partition: 0,
        offset,
        value: Buffer.from('{}'),
      });
    }
    await flushPromises(12);
    expect(handledOffsets).toEqual([37]);
    expect(firstConsumer.commitSync).not.toHaveBeenCalled();

    setWorkerKafkaDispatchAuthorized(false);
    setWorkerKafkaDispatchAuthorized(true);
    await jest.advanceTimersByTimeAsync(1000);
    await flushPromises(12);
    replayConsumer.emit('ready');
    await flushPromises(12);

    for (const offset of [37, 38]) {
      replayConsumer.emit('data', {
        topic: 'worker.w1.send.message',
        partition: 0,
        offset,
        value: Buffer.from('{}'),
      });
    }
    await flushPromises(12);

    // The abandoned attempt owns the entity fence until it really settles.
    // Its replacement cannot overlap the same chat or commit optimistically.
    expect(handledOffsets).toEqual([37]);
    expect(firstConsumer.commitSync).not.toHaveBeenCalled();
    expect(replayConsumer.commitSync).not.toHaveBeenCalled();

    firstAttempt.resolve();
    await flushPromises(24);
    await jest.advanceTimersByTimeAsync(1);
    await flushPromises(24);
    await jest.advanceTimersByTimeAsync(1);
    await flushPromises(24);

    expect(handledOffsets).toEqual([37, 37, 38]);
    expect(firstConsumer.commitSync).not.toHaveBeenCalled();
    expect(replayConsumer.commitSync).toHaveBeenLastCalledWith([
      {
        topic: 'worker.w1.send.message',
        partition: 0,
        offset: 39,
      },
    ]);

    await runner.close();
  });

  it('coalesces repeated authorization flips while a replay restart is already disconnecting', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const replayConsumer = new FakeKafkaConsumer();
    let finishFirstDisconnect: (() => void) | undefined;
    firstConsumer.disconnect.mockImplementation((callback?: () => void) => {
      finishFirstDisconnect = callback;
    });
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(replayConsumer),
    };
    setWorkerKafkaDispatchAuthorized(true);
    const consumer = createConsumer(kafka as never, 'group-flip-replay', {
      startPosition: 'committed',
      requireDispatchAuthorization: true,
    }) as any;

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      jest.fn()
    );
    await flushPromises();
    firstConsumer.emit('ready');
    await connected;

    setWorkerKafkaDispatchAuthorized(false);
    setWorkerKafkaDispatchAuthorized(true);
    await jest.advanceTimersByTimeAsync(1000);
    await flushPromises(12);

    expect(firstConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(1);

    // A second revoke/restore arrives while the first native disconnect is
    // still unresolved. It may request replay, but it must join the same
    // restart rather than creating a concurrent member.
    setWorkerKafkaDispatchAuthorized(false);
    setWorkerKafkaDispatchAuthorized(true);
    const timersAfterSecondFlip = jest.getTimerCount();
    await jest.advanceTimersByTimeAsync(2000);
    await flushPromises(12);

    expect(jest.getTimerCount()).toBeLessThanOrEqual(timersAfterSecondFlip);
    expect(firstConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(1);
    expect(firstConsumer.resume).not.toHaveBeenCalled();

    finishFirstDisconnect?.();
    await flushPromises(12);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);
    expect(firstConsumer.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      kafka.createConsumer.mock.invocationCallOrder[1]
    );

    replayConsumer.emit('ready');
    await flushPromises(12);
    await jest.advanceTimersByTimeAsync(5000);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);

    consumer.disconnect();
  });

  it('does not create a replay member when close wins during native disconnect', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const unexpectedReplayConsumer = new FakeKafkaConsumer();
    let finishFirstDisconnect: (() => void) | undefined;
    firstConsumer.disconnect.mockImplementation((callback?: () => void) => {
      finishFirstDisconnect = callback;
    });
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(unexpectedReplayConsumer),
    };
    setWorkerKafkaDispatchAuthorized(true);
    const consumer = createConsumer(kafka as never, 'group-close-replay', {
      startPosition: 'committed',
      requireDispatchAuthorization: true,
    }) as any;

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      jest.fn()
    );
    await flushPromises();
    firstConsumer.emit('ready');
    await connected;

    setWorkerKafkaDispatchAuthorized(false);
    setWorkerKafkaDispatchAuthorized(true);
    await jest.advanceTimersByTimeAsync(1000);
    await flushPromises(12);
    expect(firstConsumer.disconnect).toHaveBeenCalledTimes(1);

    consumer.disconnect();
    finishFirstDisconnect?.();
    await flushPromises(12);
    await jest.advanceTimersByTimeAsync(60_000);
    await flushPromises(12);

    expect(kafka.createConsumer).toHaveBeenCalledTimes(1);
    expect(unexpectedReplayConsumer.connect).not.toHaveBeenCalled();
    expect(firstConsumer.resume).not.toHaveBeenCalled();
  });

  it('recovers after one replacement connect failure without dispatching or looping', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const failedConsumer = new FakeKafkaConsumer();
    const recoveredConsumer = new FakeKafkaConsumer();
    failedConsumer.connect.mockImplementation(
      (_metadata: unknown, callback?: (error: Error | null) => void) => {
        callback?.(new Error('replacement connect failed'));
      }
    );
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(failedConsumer)
        .mockReturnValueOnce(recoveredConsumer),
    };
    const received = jest.fn();
    setWorkerKafkaDispatchAuthorized(true);
    const consumer = createConsumer(kafka as never, 'group-retry-replay', {
      startPosition: 'committed',
      requireDispatchAuthorization: true,
    }) as any;
    consumer.on('data', received);

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      jest.fn()
    );
    await flushPromises();
    firstConsumer.emit('ready');
    await connected;

    setWorkerKafkaDispatchAuthorized(false);
    setWorkerKafkaDispatchAuthorized(true);
    await jest.advanceTimersByTimeAsync(1000);
    await flushPromises(12);

    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);
    expect(failedConsumer.connect).toHaveBeenCalledTimes(1);
    failedConsumer.emit('data', {
      topic: 'worker.w1.send.message',
      partition: 0,
      offset: 37,
      value: Buffer.from('{}'),
    });
    expect(received).not.toHaveBeenCalled();

    // Reauthorization while the failed generation is waiting for its bounded
    // backoff must coalesce with that retry.
    const timerCountBeforeFlip = jest.getTimerCount();
    setWorkerKafkaDispatchAuthorized(false);
    setWorkerKafkaDispatchAuthorized(true);
    expect(jest.getTimerCount()).toBe(timerCountBeforeFlip);

    await jest.advanceTimersByTimeAsync(1999);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    await flushPromises(12);

    expect(kafka.createConsumer).toHaveBeenCalledTimes(3);
    expect(failedConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(failedConsumer.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      kafka.createConsumer.mock.invocationCallOrder[2]
    );
    expect(firstConsumer.resume).not.toHaveBeenCalled();
    expect(failedConsumer.resume).not.toHaveBeenCalled();

    recoveredConsumer.emit('ready');
    await flushPromises(12);
    recoveredConsumer.emit('data', {
      topic: 'worker.w1.send.message',
      partition: 0,
      offset: 37,
      value: Buffer.from('{}'),
    });
    expect(received).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(10_000);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(3);
    consumer.disconnect();
  });

  it('coalesces native rebalance failure with simultaneous authorization replay', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    const replayConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(replayConsumer),
    };
    setWorkerKafkaDispatchAuthorized(true);
    const consumer = createConsumer(kafka as never, 'group-rebalance-replay', {
      startPosition: 'committed',
      requireDispatchAuthorization: true,
    }) as any;

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      jest.fn()
    );
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    const assignment = {
      topic: 'worker.w1.send.message',
      partition: 0,
      offset: -1,
    };
    firstConsumer.assign([assignment]);
    const firstOptions = kafka.createConsumer.mock.calls[0][1];
    firstOptions.onPartitionsAssigned([assignment]);
    await connected;

    setWorkerKafkaDispatchAuthorized(false);
    firstOptions.onPartitionsRevoked([assignment]);
    firstConsumer.unassign();
    firstOptions.onRebalanceError(new Error('rebalance failed'));
    setWorkerKafkaDispatchAuthorized(true);

    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        connected: false,
        restart_count: 1,
      })
    );
    expect(firstConsumer.resume).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1000);
    await flushPromises(12);
    expect(firstConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);

    replayConsumer.emit('ready');
    await flushPromises(12);
    await jest.advanceTimersByTimeAsync(5000);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);

    consumer.disconnect();
  });

  it('backs off continuous failures but resets only after a stable healthy window', async () => {
    const nativeConsumers = Array.from(
      { length: 8 },
      () => new FakeKafkaConsumer()
    );
    const createConsumerMock = jest.fn();
    for (const nativeConsumer of nativeConsumers) {
      createConsumerMock.mockReturnValueOnce(nativeConsumer);
    }
    const kafka = { createConsumer: createConsumerMock };
    const received: Array<{
      topic: string;
      partition: number;
      offset: number;
      consumerAssignmentEpoch: number;
    }> = [];
    const consumer = createConsumer(
      kafka as never,
      'group-consecutive-restart-backoff'
    ) as any;
    consumer.on(
      'data',
      (message: {
        topic: string;
        partition: number;
        offset: number;
        consumerAssignmentEpoch: number;
      }) => received.push(message)
    );

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      jest.fn()
    );
    await flushPromises();
    nativeConsumers[0].emit('ready');
    await connected;

    const failAndReplace = async (
      nativeIndex: number,
      delayMs: number,
      expectedAttempt: number
    ): Promise<void> => {
      nativeConsumers[nativeIndex].emit(
        'event.error',
        new Error(`continuous failure ${expectedAttempt}`)
      );
      expect(consumer.__health()).toEqual(
        expect.objectContaining({
          restart_count: expectedAttempt,
          consecutive_restart_backoff_attempt: expectedAttempt,
        })
      );
      await jest.advanceTimersByTimeAsync(delayMs - 1);
      expect(createConsumerMock).toHaveBeenCalledTimes(nativeIndex + 1);
      await jest.advanceTimersByTimeAsync(1);
      await flushPromises(12);
      expect(createConsumerMock).toHaveBeenCalledTimes(nativeIndex + 2);
      nativeConsumers[nativeIndex + 1].emit('ready');
      await flushPromises(12);
    };

    await failAndReplace(0, 1000, 1);

    // Even real progress cannot reset the backoff before this generation has
    // remained connected for the complete stability window.
    nativeConsumers[1].emit('data', {
      topic: 'worker.w1.send.message',
      partition: 0,
      offset: 10,
      value: Buffer.from('{}'),
    });
    const earlyProgress = received.at(-1);
    if (!earlyProgress) {
      throw new Error('expected early consumer progress');
    }
    consumer.commitResolvedSync([
      {
        topic: earlyProgress.topic,
        partition: earlyProgress.partition,
        offset: earlyProgress.offset + 1,
        consumerAssignmentEpoch: earlyProgress.consumerAssignmentEpoch,
      },
    ]);
    await jest.advanceTimersByTimeAsync(29_999);
    await failAndReplace(1, 2000, 2);

    await failAndReplace(2, 4000, 3);
    await failAndReplace(3, 8000, 4);
    await failAndReplace(4, 16_000, 5);
    await failAndReplace(5, 30_000, 6);

    // The seventh native generation now proves durable progress and remains
    // stable for 30 seconds. The next independent incident must return to the
    // first 1-second delay while restart_count remains a historical total.
    nativeConsumers[6].emit('data', {
      topic: 'worker.w1.send.message',
      partition: 0,
      offset: 20,
      value: Buffer.from('{}'),
    });
    const stableProgress = received.at(-1);
    if (!stableProgress) {
      throw new Error('expected stable consumer progress');
    }
    consumer.commitResolvedSync([
      {
        topic: stableProgress.topic,
        partition: stableProgress.partition,
        offset: stableProgress.offset + 1,
        consumerAssignmentEpoch: stableProgress.consumerAssignmentEpoch,
      },
    ]);
    await jest.advanceTimersByTimeAsync(30_000);

    nativeConsumers[6].emit('event.error', new Error('new stable incident'));
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        restart_count: 7,
        consecutive_restart_backoff_attempt: 1,
      })
    );
    await jest.advanceTimersByTimeAsync(999);
    expect(createConsumerMock).toHaveBeenCalledTimes(7);
    await jest.advanceTimersByTimeAsync(1);
    await flushPromises(12);
    expect(createConsumerMock).toHaveBeenCalledTimes(8);
    nativeConsumers[7].emit('ready');
    await flushPromises(12);

    // A fresh flap before the stability window starts attempt two, and close
    // must cancel both that retry and all health/connect timers.
    nativeConsumers[7].emit('event.error', new Error('fresh flap'));
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        restart_count: 8,
        consecutive_restart_backoff_attempt: 2,
      })
    );
    consumer.disconnect();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        restart_count: 8,
        consecutive_restart_backoff_attempt: 0,
      })
    );
    await jest.advanceTimersByTimeAsync(60_000);
    expect(createConsumerMock).toHaveBeenCalledTimes(8);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects and closes a managed consumer that times out before readiness', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1', {
      startPosition: 'latest-on-assignment',
    }) as any;

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      jest.fn()
    );
    const rejection = expect(connected).rejects.toThrow(
      'Kafka consumer readiness timeout'
    );
    await flushPromises();

    jest.advanceTimersByTime(30_000);
    await rejection;

    expect(firstConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(consumer.__health()).toEqual(
      expect.objectContaining({ connected: false, consuming: false })
    );
  });

  it('surfaces a synchronous native consumer factory failure without an unhandled rejection', async () => {
    const kafka = {
      createConsumer: jest.fn(() => {
        throw new Error('native_consumer_factory_unavailable');
      }),
    };
    const consumer = createConsumer(kafka as never, 'group-1', {
      startPosition: 'committed',
    }) as any;

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      jest.fn()
    );
    const rejection = expect(connected).rejects.toThrow(
      'native_consumer_factory_unavailable'
    );
    await flushPromises();
    await rejection;

    expect(kafka.createConsumer).toHaveBeenCalledTimes(1);
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        connected: false,
        consuming: false,
        last_error: 'native_consumer_factory_unavailable',
      })
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('closes on readiness error and retries with a fresh native consumer', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    const secondConsumer = new FakeKafkaConsumer(false);
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(secondConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1', {
      startPosition: 'latest-on-assignment',
    }) as any;

    const firstAttempt = connectConsumer(
      consumer,
      'worker.w1.send.message',
      jest.fn()
    );
    const firstRejection =
      expect(firstAttempt).rejects.toThrow('assignment_failed');
    await flushPromises();
    firstConsumer.emit('event.error', new Error('assignment_failed'));
    await firstRejection;
    expect(firstConsumer.disconnect).toHaveBeenCalledTimes(1);

    const onConnected = jest.fn();
    const secondAttempt = connectConsumer(
      consumer,
      'worker.w1.send.message',
      onConnected
    );
    await flushPromises();
    secondConsumer.emit('ready');
    await flushPromises();
    kafka.createConsumer.mock.calls[1][1].onPartitionsAssigned([
      { topic: 'worker.w1.send.message', partition: 0, offset: -1 },
    ]);

    await expect(secondAttempt).resolves.toBeUndefined();
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);
    consumer.disconnect();
  });

  it('does not restart for stale commit generation errors', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1') as any;

    consumer.subscribe(['upsert.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();

    firstConsumer.emit('ready');
    await flushPromises();
    firstConsumer.emit('data', {
      topic: 'upsert.message',
      partition: 0,
      offset: 9,
      value: Buffer.from('{}'),
    });

    const error = new Error(
      'Broker: Specified group generation id is not valid'
    ) as Error & { code: number };
    error.code = 22;
    firstConsumer.commitSync.mockImplementationOnce(() => {
      throw error;
    });

    expect(() =>
      consumer.commitSync([
        { topic: 'upsert.message', partition: 0, offset: 10 },
      ])
    ).toThrow('Broker: Specified group generation id is not valid');

    jest.advanceTimersByTime(1000);
    await flushPromises();

    expect(kafka.createConsumer).toHaveBeenCalledTimes(1);
    expect(firstConsumer.disconnect).not.toHaveBeenCalled();
  });

  it('does not commit when commit is called without explicit offsets', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1') as any;

    consumer.subscribe(['upsert.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();

    firstConsumer.emit('ready');
    await flushPromises();

    consumer.commit();

    expect(firstConsumer.commitSync).not.toHaveBeenCalled();
  });

  it('commits only contiguous completed offsets', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1') as any;

    consumer.subscribe(['upsert.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();

    firstConsumer.emit('ready');
    await flushPromises();

    firstConsumer.emit('data', {
      topic: 'upsert.message',
      partition: 0,
      offset: 10,
      value: Buffer.from('{}'),
    });
    firstConsumer.emit('data', {
      topic: 'upsert.message',
      partition: 0,
      offset: 11,
      value: Buffer.from('{}'),
    });

    consumer.commitSync([
      { topic: 'upsert.message', partition: 0, offset: 12 },
    ]);
    expect(firstConsumer.commitSync).not.toHaveBeenCalled();

    consumer.commitSync([
      { topic: 'upsert.message', partition: 0, offset: 11 },
    ]);
    expect(firstConsumer.commitSync).toHaveBeenCalledTimes(1);
    expect(firstConsumer.commitSync).toHaveBeenCalledWith([
      { topic: 'upsert.message', partition: 0, offset: 12 },
    ]);
  });

  it('drops records until latest assignment is active and tags new records with its epoch', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const received = jest.fn();
    const ready = jest.fn();
    consumer.on('data', received);
    consumer.on('ready', ready);

    consumer.subscribe(['worker.w1.send.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    expect(ready).not.toHaveBeenCalled();

    const options = kafka.createConsumer.mock.calls[0][1];
    expect(options.startPosition).toBe('latest-on-assignment');

    firstConsumer.emit('data', {
      topic: 'worker.w1.send.message',
      partition: 0,
      offset: 90,
      value: Buffer.from('{}'),
    });
    expect(received).not.toHaveBeenCalled();

    options.onPartitionsAssigned([
      { topic: 'worker.w1.send.message', partition: 0, offset: -1 },
    ]);
    await flushPromises();
    expect(ready).toHaveBeenCalledTimes(1);
    firstConsumer.emit('data', {
      topic: 'worker.w1.send.message',
      partition: 0,
      offset: 91,
      value: Buffer.from('{}'),
    });

    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({
        offset: 91,
        consumerAssignmentEpoch: expect.any(Number),
      })
    );
  });

  it('rejects a completion from a revoked assignment epoch', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1', {
      startPosition: 'latest-on-assignment',
    }) as any;
    let assignmentEpoch = 0;
    consumer.on('data', (message: { consumerAssignmentEpoch?: number }) => {
      assignmentEpoch = message.consumerAssignmentEpoch ?? 0;
    });

    consumer.subscribe(['worker.w1.send.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const options = kafka.createConsumer.mock.calls[0][1];
    const assignment = {
      topic: 'worker.w1.send.message',
      partition: 0,
      offset: -1,
    };
    options.onPartitionsAssigned([assignment]);
    await flushPromises();
    firstConsumer.commitSync.mockClear();
    firstConsumer.emit('data', {
      ...assignment,
      offset: 12,
      value: Buffer.from('{}'),
    });
    expect(assignmentEpoch).toBeGreaterThan(1_000_000_000_000);

    options.onPartitionsRevoked([assignment]);
    consumer.commitResolvedSync([
      {
        topic: assignment.topic,
        partition: assignment.partition,
        offset: 13,
        consumerAssignmentEpoch: assignmentEpoch,
      },
    ]);

    expect(firstConsumer.commitSync).not.toHaveBeenCalled();
    expect(
      consumer.__isAssignmentEpochActive(
        assignment.topic,
        assignment.partition,
        assignmentEpoch
      )
    ).toBe(false);
  });

  it('restarts instead of leaving retained partitions paused after a partial revoke', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    const secondConsumer = new FakeKafkaConsumer(false);
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(secondConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1', {
      startPosition: 'latest-on-assignment',
    }) as any;

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      jest.fn()
    );
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    const options = kafka.createConsumer.mock.calls[0][1];
    options.onPartitionsAssigned([
      { topic: 'worker.w1.send.message', partition: 0, offset: -1 },
    ]);
    await connected;

    firstConsumer.queryWatermarkOffsets.mockImplementation(() => undefined);
    options.onPartitionsAssigned([
      { topic: 'worker.w1.send.message', partition: 1, offset: -1 },
      { topic: 'worker.w1.send.message', partition: 2, offset: -1 },
    ]);
    options.onPartitionsRevoked([
      { topic: 'worker.w1.send.message', partition: 1, offset: -1 },
    ]);

    expect(consumer.__health().restart_count).toBe(1);
    jest.advanceTimersByTime(1_000);
    await flushPromises(12);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);

    consumer.disconnect();
  });

  it('restarts fail closed when disjoint assignment preparations overlap', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    const secondConsumer = new FakeKafkaConsumer(false);
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(secondConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-overlap', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const received = jest.fn();
    consumer.on('data', received);

    const connected = connectConsumer(
      consumer,
      'worker.w1.send.message',
      jest.fn()
    );
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const firstOptions = kafka.createConsumer.mock.calls[0][1];
    const partition0 = {
      topic: 'worker.w1.send.message',
      partition: 0,
      offset: -1,
    };
    const partition1 = { ...partition0, partition: 1 };
    const partition2 = { ...partition0, partition: 2 };
    firstConsumer.assign([partition0]);
    firstOptions.onPartitionsAssigned([partition0]);
    await connected;

    let resolveFirstWatermark:
      | ((
          error: Error | null,
          offsets: { lowOffset: number; highOffset: number }
        ) => void)
      | undefined;
    firstConsumer.queryWatermarkOffsets.mockImplementationOnce(
      (
        _topic: string,
        _partition: number,
        _timeout: number,
        callback?: (
          error: Error | null,
          offsets: { lowOffset: number; highOffset: number }
        ) => void
      ) => {
        resolveFirstWatermark = callback;
      }
    );
    firstConsumer.resume.mockClear();
    firstConsumer.commitSync.mockClear();
    firstConsumer.assign([partition0, partition1, partition2]);

    firstOptions.onPartitionsAssigned([partition1]);
    await flushPromises();
    expect(consumer.__health().assignment_positioning_count).toBe(1);

    firstOptions.onPartitionsAssigned([partition2]);

    expect(firstConsumer.pause).toHaveBeenLastCalledWith([
      { topic: partition0.topic, partition: partition0.partition },
      { topic: partition1.topic, partition: partition1.partition },
      { topic: partition2.topic, partition: partition2.partition },
    ]);
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        assignments_ready: false,
        assignment_positioning_count: 0,
        restart_count: 1,
      })
    );

    firstConsumer.emit('data', {
      ...partition0,
      offset: 1,
      value: Buffer.from('{}'),
    });
    expect(received).not.toHaveBeenCalled();

    resolveFirstWatermark?.(null, { lowOffset: 0, highOffset: 41 });
    await flushPromises();
    expect(firstConsumer.resume).not.toHaveBeenCalled();
    expect(firstConsumer.commitSync).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000);
    await flushPromises(12);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);

    secondConsumer.highOffset = 52;
    secondConsumer.emit('ready');
    await flushPromises();
    secondConsumer.assign([partition0, partition1, partition2]);
    const secondOptions = kafka.createConsumer.mock.calls[1][1];
    secondOptions.onPartitionsAssigned([partition0, partition1, partition2]);
    await flushPromises(12);

    expect(secondConsumer.resume).toHaveBeenCalledWith([
      { topic: partition0.topic, partition: partition0.partition },
      { topic: partition1.topic, partition: partition1.partition },
      { topic: partition2.topic, partition: partition2.partition },
    ]);
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        assignments_ready: true,
        assignment_positioning_count: 0,
      })
    );

    consumer.disconnect();
  });

  it('prunes lag and pending state from revoked committed assignments', async () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    jest.setSystemTime(now);
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.committedOffset = 0;
    firstConsumer.highOffset = 18;
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-committed') as any;
    const topic = 'health.watchdog.test';

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    await consumer.runWatchdogCheck();
    firstConsumer.emit('data', {
      topic,
      partition: 0,
      offset: 0,
      value: Buffer.from('{}'),
    });
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        lag: 18,
        pending_count: 1,
        unhealthy: false,
        partitions: [expect.objectContaining({ topic, partition: 0, lag: 18 })],
      })
    );

    jest.setSystemTime(new Date(now.getTime() + 600_000));
    firstConsumer.assign([{ topic, partition: 16 }]);
    firstConsumer.committedOffset = 0;
    firstConsumer.highOffset = 0;

    await consumer.runWatchdogCheck();

    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        lag: 0,
        pending_count: 0,
        unhealthy: false,
        stall_reason: '',
        partitions: [expect.objectContaining({ topic, partition: 16, lag: 0 })],
      })
    );
    consumer.disconnect();
  });

  it('starts the lag stall window when backlog appears after a long idle', async () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    jest.setSystemTime(now);
    const firstConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-committed') as any;
    const topic = 'health.watchdog.test';

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    await consumer.runWatchdogCheck();

    jest.setSystemTime(new Date(now.getTime() + 600_000));
    firstConsumer.highOffset = 1;
    await consumer.runWatchdogCheck();

    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        lag: 1,
        unhealthy: false,
        stall_reason: '',
      })
    );

    jest.setSystemTime(new Date(now.getTime() + 689_999));
    await consumer.runWatchdogCheck();
    expect(consumer.__health().unhealthy).toBe(false);

    jest.setSystemTime(new Date(now.getTime() + 690_000));
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        unhealthy: true,
        stall_reason: 'lag_no_commit_progress',
      })
    );
    consumer.disconnect();
  });

  it('keeps the long-running handler budget when lag has a pending offset', async () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    jest.setSystemTime(now);
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.committedOffset = 0;
    firstConsumer.highOffset = 2;
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-committed') as any;
    const topic = 'worker.lifecycle.request';

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    await consumer.runWatchdogCheck();
    firstConsumer.emit('data', {
      topic,
      partition: 0,
      offset: 0,
      value: Buffer.from('{}'),
    });

    jest.setSystemTime(new Date(now.getTime() + 90_000));
    await consumer.runWatchdogCheck();

    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        lag: 2,
        pending_count: 1,
        unhealthy: false,
        stall_reason: '',
        restart_count: 0,
      })
    );
    consumer.disconnect();
  });

  it('keeps lifecycle work alive through its derived deadline before watchdog recovery', async () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    jest.setSystemTime(now);
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.committedOffset = 0;
    firstConsumer.highOffset = 2;
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-lifecycle') as any;
    const topic = 'worker.lifecycle.request';

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    firstConsumer.emit('data', {
      topic,
      partition: 0,
      offset: 0,
      value: Buffer.from('{}'),
    });
    expect(
      consumer.__markProcessingStarted(
        topic,
        0,
        0,
        consumer.__health().assignment_epoch
      )
    ).toBe(true);

    const pendingStallBudgetMs = workerLifecycleBudgets.pendingWatchdogMs;
    jest.setSystemTime(new Date(now.getTime() + pendingStallBudgetMs - 1));
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        pending_stall_budget_ms: pendingStallBudgetMs,
        pending_count: 1,
        unhealthy: false,
        restart_count: 0,
      })
    );

    jest.setSystemTime(new Date(now.getTime() + pendingStallBudgetMs));
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        pending_stall_budget_ms: pendingStallBudgetMs,
        unhealthy: true,
        stall_reason: 'pending_offset_stall',
        restart_count: 1,
      })
    );
    consumer.disconnect();
  });

  it('renews a pending watchdog only from explicit progress on the active offset', async () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    jest.setSystemTime(now);
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.committedOffset = 0;
    firstConsumer.highOffset = 2;
    const secondConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(secondConsumer),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-progress-lease'
    ) as any;
    const topic = 'config.channels.recreate.all';
    let trackedMessage:
      | {
          partition: number;
          offset: number;
          consumerAssignmentEpoch: number;
        }
      | undefined;
    consumer.on('data', (message: typeof trackedMessage) => {
      trackedMessage = message;
    });

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    firstConsumer.emit('data', {
      topic,
      partition: 0,
      offset: 0,
      value: Buffer.from('{}'),
    });
    expect(trackedMessage).toBeDefined();
    expect(
      consumer.__reportProcessingProgress(
        topic,
        0,
        0,
        trackedMessage?.consumerAssignmentEpoch
      )
    ).toBe(false);
    expect(
      consumer.__markProcessingStarted(
        topic,
        0,
        0,
        trackedMessage?.consumerAssignmentEpoch
      )
    ).toBe(true);

    jest.setSystemTime(new Date(now.getTime() + 299_999));
    expect(
      consumer.__reportProcessingProgress(
        topic,
        0,
        1,
        trackedMessage?.consumerAssignmentEpoch
      )
    ).toBe(false);
    expect(
      consumer.__reportProcessingProgress(
        topic,
        0,
        0,
        (trackedMessage?.consumerAssignmentEpoch as number) + 1
      )
    ).toBe(false);
    expect(
      consumer.__reportProcessingProgress(
        topic,
        0,
        0,
        trackedMessage?.consumerAssignmentEpoch
      )
    ).toBe(true);

    jest.setSystemTime(new Date(now.getTime() + 300_000));
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        oldest_pending_age_ms: 300_000,
        oldest_pending_no_progress_age_ms: 1,
        pending_queued_count: 0,
        pending_processing_count: 1,
        pending_settled_count: 0,
        unhealthy: false,
        restart_count: 0,
      })
    );

    jest.setSystemTime(new Date(now.getTime() + 599_998));
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        oldest_pending_no_progress_age_ms: 299_999,
        unhealthy: false,
        restart_count: 0,
      })
    );

    jest.setSystemTime(new Date(now.getTime() + 599_999));
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        oldest_pending_no_progress_age_ms: 300_000,
        unhealthy: true,
        stall_reason: 'pending_offset_stall',
        restart_count: 1,
      })
    );
    expect(firstConsumer.commitSync).not.toHaveBeenCalled();
    consumer.disconnect();
  });

  it('ignores queued offsets without letting one active offset mask a stalled sibling', async () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    jest.setSystemTime(now);
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.committedOffset = 0;
    firstConsumer.highOffset = 3;
    const secondConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(secondConsumer),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-progress-siblings'
    ) as any;
    const topic = 'config.channels.recreate.all';
    let assignmentEpoch = 0;
    consumer.on('data', (message: { consumerAssignmentEpoch?: number }) => {
      assignmentEpoch = message.consumerAssignmentEpoch ?? 0;
    });

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    for (const offset of [0, 1]) {
      firstConsumer.emit('data', {
        topic,
        partition: 0,
        offset,
        value: Buffer.from('{}'),
      });
    }

    expect(consumer.__markProcessingStarted(topic, 0, 0, assignmentEpoch)).toBe(
      true
    );
    expect(
      consumer.__reportProcessingProgress(topic, 0, 1, assignmentEpoch)
    ).toBe(false);
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        pending_count: 2,
        pending_queued_count: 1,
        pending_processing_count: 1,
      })
    );

    jest.setSystemTime(new Date(now.getTime() + 299_999));
    expect(
      consumer.__reportProcessingProgress(topic, 0, 0, assignmentEpoch)
    ).toBe(true);
    jest.setSystemTime(new Date(now.getTime() + 300_000));
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        pending_queued_count: 1,
        pending_processing_count: 1,
        oldest_pending_no_progress_age_ms: 1,
        unhealthy: false,
        restart_count: 0,
      })
    );

    expect(consumer.__markProcessingStarted(topic, 0, 1, assignmentEpoch)).toBe(
      true
    );
    expect(consumer.__markProcessingStarted(topic, 0, 0, assignmentEpoch)).toBe(
      false
    );

    jest.setSystemTime(new Date(now.getTime() + 599_999));
    expect(
      consumer.__reportProcessingProgress(topic, 0, 0, assignmentEpoch)
    ).toBe(true);
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        pending_queued_count: 0,
        pending_processing_count: 2,
        oldest_pending_no_progress_age_ms: 299_999,
        unhealthy: false,
        restart_count: 0,
      })
    );

    jest.setSystemTime(new Date(now.getTime() + 600_000));
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        oldest_pending_no_progress_age_ms: 300_000,
        unhealthy: true,
        stall_reason: 'pending_offset_stall',
        restart_count: 1,
        consecutive_stall_restart_count: 1,
      })
    );
    expect(firstConsumer.commitSync).not.toHaveBeenCalled();
    consumer.disconnect();
  });

  it('rejects processing progress after the exact assignment is revoked', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-progress-revoked'
    ) as any;
    const topic = 'config.channels.recreate.all';
    let assignmentEpoch = 0;
    consumer.on('data', (message: { consumerAssignmentEpoch?: number }) => {
      assignmentEpoch = message.consumerAssignmentEpoch ?? 0;
    });

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    firstConsumer.emit('data', {
      topic,
      partition: 0,
      offset: 7,
      value: Buffer.from('{}'),
    });
    expect(consumer.__markProcessingStarted(topic, 0, 7, assignmentEpoch)).toBe(
      true
    );

    kafka.createConsumer.mock.calls[0][1].onPartitionsRevoked([
      { topic, partition: 0 },
    ]);

    expect(
      consumer.__reportProcessingProgress(topic, 0, 7, assignmentEpoch)
    ).toBe(false);
    expect(consumer.__markProcessingSettled(topic, 0, 7, assignmentEpoch)).toBe(
      false
    );
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        pending_count: 0,
        pending_processing_count: 0,
      })
    );
    expect(firstConsumer.commitSync).not.toHaveBeenCalled();
    consumer.disconnect();
  });

  it('recovers a settled offset that never reaches a Kafka commit', async () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    jest.setSystemTime(now);
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.committedOffset = 0;
    firstConsumer.highOffset = 1;
    const secondConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(secondConsumer),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-settled-without-commit'
    ) as any;
    const topic = 'config.channels.recreate.all';
    let assignmentEpoch = 0;
    consumer.on('data', (message: { consumerAssignmentEpoch?: number }) => {
      assignmentEpoch = message.consumerAssignmentEpoch ?? 0;
    });

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    firstConsumer.emit('data', {
      topic,
      partition: 0,
      offset: 0,
      value: Buffer.from('{}'),
    });
    expect(consumer.__markProcessingStarted(topic, 0, 0, assignmentEpoch)).toBe(
      true
    );
    expect(consumer.__markProcessingSettled(topic, 0, 0, assignmentEpoch)).toBe(
      true
    );
    expect(
      consumer.__reportProcessingProgress(topic, 0, 0, assignmentEpoch)
    ).toBe(false);
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        pending_count: 1,
        pending_processing_count: 0,
        pending_settled_count: 1,
      })
    );

    jest.setSystemTime(new Date(now.getTime() + 299_999));
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        oldest_pending_no_progress_age_ms: 299_999,
        unhealthy: false,
        restart_count: 0,
      })
    );

    jest.setSystemTime(new Date(now.getTime() + 300_000));
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        oldest_pending_no_progress_age_ms: 300_000,
        unhealthy: true,
        stall_reason: 'pending_offset_stall',
        restart_count: 1,
      })
    );
    expect(firstConsumer.commitSync).not.toHaveBeenCalled();
    consumer.disconnect();
  });

  it('does not let healthy partition commits reset recovery for another stalled partition', async () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    jest.setSystemTime(now);
    const topic = 'worker.w1.send.message';
    const assignments = [
      { topic, partition: 0 },
      { topic, partition: 1 },
    ];
    const nativeConsumers = [
      new FakeKafkaConsumer(false),
      new FakeKafkaConsumer(false),
    ];
    for (const nativeConsumer of nativeConsumers) {
      nativeConsumer.committedOffset = 0;
      nativeConsumer.queryWatermarkOffsets.mockImplementation(
        (
          _topic: string,
          partition: number,
          _timeout: number,
          callback?: (
            error: Error | null,
            offsets: { lowOffset: number; highOffset: number }
          ) => void
        ) =>
          callback?.(null, {
            lowOffset: 0,
            highOffset: partition === 1 ? 1 : 0,
          })
      );
    }
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(nativeConsumers[0])
        .mockReturnValueOnce(nativeConsumers[1]),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-partition-stall'
    ) as any;
    let healthyMessage:
      | {
          topic: string;
          partition: number;
          offset: number;
          consumerAssignmentEpoch: number;
        }
      | undefined;
    consumer.on('data', (message: typeof healthyMessage) => {
      if (message?.partition === 0) {
        healthyMessage = message;
      }
    });

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    nativeConsumers[0].assign(assignments);
    nativeConsumers[0].emit('ready');
    await flushPromises();
    await consumer.runWatchdogCheck();

    jest.setSystemTime(new Date(now.getTime() + 90_000));
    await consumer.runWatchdogCheck();
    expect(consumer.__health().consecutive_stall_restart_count).toBe(1);

    jest.advanceTimersByTime(1_000);
    await flushPromises(12);
    nativeConsumers[1].assign(assignments);
    nativeConsumers[1].emit('ready');
    await flushPromises();
    await consumer.runWatchdogCheck();

    nativeConsumers[1].emit('data', {
      topic,
      partition: 0,
      offset: 0,
      value: Buffer.from('{}'),
    });
    expect(healthyMessage).toBeDefined();
    consumer.commitSync([
      {
        topic,
        partition: 0,
        offset: 1,
        consumerAssignmentEpoch: healthyMessage?.consumerAssignmentEpoch,
      },
    ]);
    expect(consumer.__health().consecutive_stall_restart_count).toBe(1);

    jest.setSystemTime(new Date(now.getTime() + 181_000));
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        stall_reason: 'lag_no_commit_progress',
        consecutive_stall_restart_count: 2,
      })
    );
    consumer.disconnect();
  });

  it.each(['worker.warm.replenish.request', 'worker.lifecycle.request'])(
    'restarts a stalled durable global consumer without committing %s',
    async (topic) => {
      const now = new Date('2026-07-17T12:00:00.000Z');
      jest.setSystemTime(now);
      const firstConsumer = new FakeKafkaConsumer();
      firstConsumer.committedOffset = 7;
      firstConsumer.highOffset = 9;
      const secondConsumer = new FakeKafkaConsumer();
      const kafka = {
        createConsumer: jest
          .fn()
          .mockReturnValueOnce(firstConsumer)
          .mockReturnValueOnce(secondConsumer),
      };
      const consumer = createConsumer(
        kafka as never,
        'group-durable-global'
      ) as any;

      consumer.subscribe([topic]);
      consumer.consume();
      consumer.connect({}, jest.fn());
      await flushPromises();
      firstConsumer.emit('ready');
      await flushPromises();
      await consumer.runWatchdogCheck();

      expect(consumer.__health()).toEqual(
        expect.objectContaining({
          stall_restart_enabled: true,
          stall_restart_scope: 'all',
          stall_restart_effective_scope: 'all',
        })
      );

      jest.setSystemTime(new Date(now.getTime() + 300_000));
      await consumer.runWatchdogCheck();
      expect(firstConsumer.commitSync).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1_000);
      await flushPromises(12);

      expect(kafka.createConsumer).toHaveBeenCalledTimes(2);
      expect(firstConsumer.disconnect).toHaveBeenCalled();
      expect(consumer.__health()).toEqual(
        expect.objectContaining({
          restart_count: 1,
          consecutive_stall_restart_count: 1,
        })
      );
      consumer.disconnect();
    }
  );

  it.each([
    'upsert.message',
    'update.message.status',
    'notification.message',
    'official.whatsapp.webhook.event',
  ])(
    'enables automatic stall recovery for durable global WhatsApp topic %s',
    async (topic) => {
      const nativeConsumer = new FakeKafkaConsumer();
      const kafka = {
        createConsumer: jest.fn().mockReturnValueOnce(nativeConsumer),
      };
      const consumer = createConsumer(
        kafka as never,
        'group-durable-whatsapp'
      ) as any;

      consumer.subscribe([topic]);
      consumer.consume();
      consumer.connect({}, jest.fn());
      await flushPromises();
      nativeConsumer.emit('ready');
      await flushPromises();

      expect(consumer.__health()).toEqual(
        expect.objectContaining({
          stall_restart_enabled: true,
          stall_restart_scope: 'all',
        })
      );
      consumer.disconnect();
    }
  );

  it('exposes exhausted stall recovery after repeated internal generation restarts', async () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    jest.setSystemTime(now);
    const nativeConsumers = Array.from(
      { length: 4 },
      () => new FakeKafkaConsumer()
    );
    for (const nativeConsumer of nativeConsumers) {
      nativeConsumer.committedOffset = 7;
      nativeConsumer.highOffset = 9;
    }
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(nativeConsumers[0])
        .mockReturnValueOnce(nativeConsumers[1])
        .mockReturnValueOnce(nativeConsumers[2])
        .mockReturnValueOnce(nativeConsumers[3]),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-durable-global'
    ) as any;
    const topic = 'worker.lifecycle.request';

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    nativeConsumers[0].emit('ready');
    await flushPromises();

    let currentTimeMs = now.getTime();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await consumer.runWatchdogCheck();
      currentTimeMs += 90_000;
      jest.setSystemTime(new Date(currentTimeMs));
      await consumer.runWatchdogCheck();

      expect(consumer.__health().stall_recovery_exhausted).toBe(attempt === 2);

      if (attempt < 2) {
        const restartDelayMs = 2 ** attempt * 1_000;
        jest.advanceTimersByTime(restartDelayMs);
        currentTimeMs += restartDelayMs;
        await flushPromises(12);
        nativeConsumers[attempt + 1].emit('ready');
        await flushPromises();
      }
    }

    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        unhealthy: true,
        stall_reason: 'lag_no_commit_progress_watchdog',
        restart_count: 3,
        consecutive_stall_restart_count: 3,
        stall_recovery_exhausted: true,
      })
    );

    jest.advanceTimersByTime(4_000);
    currentTimeMs += 4_000;
    await flushPromises(12);
    nativeConsumers[3].assign([]);
    nativeConsumers[3].emit('ready');
    await flushPromises();
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        unhealthy: true,
        consecutive_stall_restart_count: 3,
        stall_recovery_exhausted: true,
      })
    );

    const recoveredAssignments = [
      { topic, partition: 0 },
      { topic, partition: 1 },
    ];
    nativeConsumers[3].assign(recoveredAssignments);
    kafka.createConsumer.mock.calls[3][1].onPartitionsAssigned(
      recoveredAssignments
    );
    nativeConsumers[3].queryWatermarkOffsets.mockImplementation(
      (
        _topic: string,
        partition: number,
        _timeout: number,
        callback?: (
          error: Error | null,
          offsets: { lowOffset: number; highOffset: number }
        ) => void
      ) => {
        if (partition === 0) {
          callback?.(null, { lowOffset: 0, highOffset: 9 });
        }
      }
    );
    const incompleteWatchdog = consumer.runWatchdogCheck();
    await flushPromises();
    jest.advanceTimersByTime(2_000);
    currentTimeMs += 2_000;
    await incompleteWatchdog;
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        unhealthy: true,
        lag: null,
        lag_measurement_complete: false,
        lag_measurement_failure_count: 1,
        consecutive_stall_restart_count: 3,
        stall_recovery_exhausted: true,
      })
    );

    nativeConsumers[3].committedOffset = 9;
    nativeConsumers[3].highOffset = 9;
    nativeConsumers[3].queryWatermarkOffsets.mockImplementation(
      (
        _topic: string,
        _partition: number,
        _timeout: number,
        callback?: (
          error: Error | null,
          offsets: { lowOffset: number; highOffset: number }
        ) => void
      ) => callback?.(null, { lowOffset: 0, highOffset: 9 })
    );
    jest.setSystemTime(new Date(currentTimeMs + 1));
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        unhealthy: false,
        lag: 0,
        lag_measurement_complete: true,
        lag_measurement_failure_count: 0,
        consecutive_stall_restart_count: 0,
        stall_recovery_exhausted: false,
      })
    );
    consumer.disconnect();
  });

  it.each(['worker.config.recreate.all', 'asaas.nfse.webhook'])(
    'recovers a stalled global or administrative queue without committing %s',
    async (topic) => {
      const now = new Date('2026-07-17T12:00:00.000Z');
      jest.setSystemTime(now);
      const firstConsumer = new FakeKafkaConsumer();
      firstConsumer.committedOffset = 0;
      firstConsumer.highOffset = 2;
      const secondConsumer = new FakeKafkaConsumer();
      const kafka = {
        createConsumer: jest
          .fn()
          .mockReturnValueOnce(firstConsumer)
          .mockReturnValueOnce(secondConsumer),
      };
      const consumer = createConsumer(
        kafka as never,
        'group-global-config'
      ) as any;

      consumer.subscribe([topic]);
      consumer.consume();
      consumer.connect({}, jest.fn());
      await flushPromises();
      firstConsumer.emit('ready');
      await flushPromises();
      await consumer.runWatchdogCheck();

      expect(consumer.__health()).toEqual(
        expect.objectContaining({
          stall_restart_enabled: true,
          stall_restart_scope: 'all',
        })
      );
      jest.setSystemTime(new Date(now.getTime() + 90_000));
      await consumer.runWatchdogCheck();

      expect(firstConsumer.commitSync).not.toHaveBeenCalled();
      expect(consumer.__health()).toEqual(
        expect.objectContaining({
          unhealthy: true,
          stall_reason: 'lag_no_commit_progress',
          restart_count: 1,
        })
      );

      jest.advanceTimersByTime(1_000);
      await flushPromises(12);
      expect(kafka.createConsumer).toHaveBeenCalledTimes(2);
      consumer.disconnect();
    }
  );

  it('does not treat offsets removed by retention as consumable Asaas backlog', async () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    jest.setSystemTime(now);
    const topic = 'asaas.nfse.webhook';
    const assignments = [
      { topic, partition: 14 },
      { topic, partition: 29 },
    ];
    const firstConsumer = new FakeKafkaConsumer(false);
    firstConsumer.committed.mockImplementation(
      (
        requested: Array<{ topic: string; partition: number }>,
        _timeout: number,
        callback?: (
          error: Error | null,
          offsets: Array<{ topic: string; partition: number; offset: number }>
        ) => void
      ) =>
        callback?.(
          null,
          requested.map((assignment) => ({
            ...assignment,
            offset: assignment.partition === 14 ? 4 : 23,
          }))
        )
    );
    firstConsumer.queryWatermarkOffsets.mockImplementation(
      (
        _topic: string,
        partition: number,
        _timeout: number,
        callback?: (
          error: Error | null,
          offsets: { lowOffset: number; highOffset: number }
        ) => void
      ) =>
        callback?.(
          null,
          partition === 14
            ? { lowOffset: 22, highOffset: 22 }
            : { lowOffset: 30, highOffset: 30 }
        )
    );
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-asaas-retention-gap'
    ) as any;

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.assign(assignments);
    firstConsumer.emit('ready');
    await flushPromises();
    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned(assignments);

    await consumer.runWatchdogCheck();
    jest.setSystemTime(new Date(now.getTime() + 90_000));
    await consumer.runWatchdogCheck();

    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        lag: 0,
        lag_measurement_complete: true,
        restart_count: 0,
        unhealthy: false,
        low_watermark: 22,
        effective_progress_offset: 22,
        partitions: expect.arrayContaining([
          expect.objectContaining({
            partition: 14,
            committed_offset: 4,
            low_watermark: 22,
            high_watermark: 22,
            effective_progress_offset: 22,
            lag: 0,
          }),
          expect.objectContaining({
            partition: 29,
            committed_offset: 23,
            low_watermark: 30,
            high_watermark: 30,
            effective_progress_offset: 30,
            lag: 0,
          }),
        ]),
      })
    );
    consumer.disconnect();
  });

  it('clears unhealthy state when broker progress recovers without a local commit', async () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    jest.setSystemTime(now);
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.committedOffset = 0;
    firstConsumer.highOffset = 5;
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-committed') as any;
    const topic = 'health.watchdog.test';

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    await consumer.runWatchdogCheck();

    jest.setSystemTime(new Date(now.getTime() + 300_000));
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        unhealthy: true,
        stall_reason: 'lag_no_commit_progress',
      })
    );

    firstConsumer.committedOffset = 5;
    jest.setSystemTime(new Date(now.getTime() + 300_001));
    await consumer.runWatchdogCheck();

    expect(firstConsumer.commitSync).not.toHaveBeenCalled();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        lag: 0,
        unhealthy: false,
        stall_reason: '',
      })
    );
    consumer.disconnect();
  });

  it('keeps detecting a genuinely pending handler stall', async () => {
    const now = new Date('2026-07-17T12:00:00.000Z');
    jest.setSystemTime(now);
    const firstConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-committed') as any;
    const topic = 'health.watchdog.test';

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    firstConsumer.emit('data', {
      topic,
      partition: 0,
      offset: 0,
      value: Buffer.from('{}'),
    });
    expect(
      consumer.__markProcessingStarted(
        topic,
        0,
        0,
        consumer.__health().assignment_epoch
      )
    ).toBe(true);

    jest.setSystemTime(new Date(now.getTime() + 300_000));
    await consumer.runWatchdogCheck();

    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        pending_count: 1,
        unhealthy: true,
        stall_reason: 'pending_offset_stall',
      })
    );
    consumer.disconnect();
  });

  it('does not manufacture committed lag from unknown or transient offsets', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.committedOffset = -1;
    firstConsumer.highOffset = 10;
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-committed') as any;
    const topic = 'health.watchdog.test';

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    await consumer.runWatchdogCheck();

    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        committed_offset: null,
        low_watermark: 0,
        effective_progress_offset: 0,
        lag: 10,
        lag_measurement_complete: true,
        lag_measurement_failure_count: 0,
        unhealthy: false,
      })
    );

    firstConsumer.committedOffset = 0;
    firstConsumer.highOffset = 5;
    await consumer.runWatchdogCheck();
    expect(consumer.__health().lag).toBe(5);

    firstConsumer.committed.mockImplementationOnce(
      (
        _assignments: Array<{ topic: string; partition: number }>,
        _timeout: number,
        callback?: (error: Error | null, offsets: never[]) => void
      ) => callback?.(new Error('committed timeout'), [])
    );
    firstConsumer.highOffset = 100;
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        lag: null,
        lag_measurement_complete: false,
        lag_measurement_failure_count: 1,
        partitions: [expect.objectContaining({ lag: 5 })],
      })
    );

    firstConsumer.queryWatermarkOffsets.mockImplementationOnce(
      (
        _topic: string,
        _partition: number,
        _timeout: number,
        callback?: (
          error: Error | null,
          offsets: { lowOffset: number; highOffset: number }
        ) => void
      ) =>
        callback?.(new Error('watermark timeout'), {
          lowOffset: 0,
          highOffset: 0,
        })
    );
    await consumer.runWatchdogCheck();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        lag: null,
        lag_measurement_complete: false,
        lag_measurement_failure_count: 2,
        partitions: [expect.objectContaining({ lag: 5 })],
      })
    );
    consumer.disconnect();
  });

  it('preserves the last valid latest snapshot when reader position is transiently unavailable', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.highOffset = 25;
    firstConsumer.positionOffset = 25;
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-latest', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const topic = 'worker.w1.send.message';

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    const options = kafka.createConsumer.mock.calls[0][1];
    options.onPartitionsAssigned([{ topic, partition: 0, offset: -1 }]);
    await flushPromises();

    firstConsumer.positionOffset = 20;
    firstConsumer.highOffset = 25;
    await consumer.runWatchdogCheck();
    expect(consumer.__health().lag).toBe(5);

    firstConsumer.position.mockImplementationOnce(() => {
      throw new Error('position timeout');
    });
    firstConsumer.highOffset = 100;
    await consumer.runWatchdogCheck();

    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        position_offset: 20,
        high_watermark: 25,
        lag: null,
        lag_measurement_complete: false,
        lag_measurement_failure_count: 1,
        unhealthy: false,
      })
    );
    consumer.disconnect();
  });

  it('uses reader position instead of committed backlog for latest health lag', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.committedOffset = 0;
    firstConsumer.positionOffset = 25;
    firstConsumer.highOffset = 25;
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1', {
      startPosition: 'latest-on-assignment',
    }) as any;

    consumer.subscribe(['worker.w1.send.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    const options = kafka.createConsumer.mock.calls[0][1];
    options.onPartitionsAssigned([
      { topic: 'worker.w1.send.message', partition: 0, offset: -1 },
    ]);
    await flushPromises();

    jest.advanceTimersByTime(30_000);
    await flushPromises(12);

    expect(firstConsumer.committed).toHaveBeenCalledWith(
      [{ topic: 'worker.w1.send.message', partition: 0 }],
      expect.any(Number),
      expect.any(Function)
    );
    expect(firstConsumer.position).toHaveBeenCalled();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        start_position: 'latest-on-assignment',
        lag: 0,
        position_offset: 25,
        committed_offset: 25,
      })
    );

    consumer.disconnect();
  });

  it('reapplies latest-on-assignment when the managed consumer reconnects', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const secondConsumer = new FakeKafkaConsumer();
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(secondConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-1', {
      startPosition: 'latest-on-assignment',
    }) as any;

    consumer.subscribe(['worker.w1.send.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned([
      { topic: 'worker.w1.send.message', partition: 0, offset: -1 },
    ]);
    await flushPromises();

    firstConsumer.emit('disconnected');
    jest.advanceTimersByTime(1_000);
    await flushPromises(12);

    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);
    expect(kafka.createConsumer.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        startPosition: 'latest-on-assignment',
        onPartitionsAssigned: expect.any(Function),
        onPartitionsRevoked: expect.any(Function),
      })
    );

    consumer.disconnect();
  });

  it('resumes committed offsets unchanged when a managed consumer reconnects', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    const secondConsumer = new FakeKafkaConsumer(false);
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(secondConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-durable', {
      startPosition: 'committed',
    }) as any;
    const received: number[] = [];
    consumer.on('data', (message: { offset: number }) => {
      received.push(message.offset);
    });

    consumer.subscribe(['worker.w1.send.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned([
      { topic: 'worker.w1.send.message', partition: 0, offset: 41 },
    ]);

    firstConsumer.emit('disconnected');
    jest.advanceTimersByTime(1_000);
    await flushPromises(12);

    expect(kafka.createConsumer).toHaveBeenCalledTimes(2);
    expect(kafka.createConsumer.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        startPosition: 'committed',
        onPartitionsAssigned: expect.any(Function),
        onPartitionsRevoked: expect.any(Function),
      })
    );

    secondConsumer.emit('ready');
    await flushPromises();
    kafka.createConsumer.mock.calls[1][1].onPartitionsAssigned([
      { topic: 'worker.w1.send.message', partition: 0, offset: 41 },
    ]);
    secondConsumer.emit('data', {
      topic: 'worker.w1.send.message',
      partition: 0,
      offset: 41,
      value: Buffer.from('{}'),
    });

    expect(received).toEqual([41]);
    expect(secondConsumer.queryWatermarkOffsets).not.toHaveBeenCalled();
    expect(secondConsumer.seek).not.toHaveBeenCalled();
    expect(secondConsumer.commitSync).not.toHaveBeenCalled();
    consumer.disconnect();
  });

  it('bounds a metadata callback that never returns and schedules recovery', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const secondConsumer = new FakeKafkaConsumer();
    firstConsumer.getMetadata.mockImplementation(() => undefined);
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(secondConsumer),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-metadata-timeout'
    ) as any;

    consumer.subscribe(['upsert.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    jest.advanceTimersByTime(14_999);
    await flushPromises();
    expect(consumer.__health().restart_count).toBe(0);

    jest.advanceTimersByTime(1);
    await flushPromises();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        connected: false,
        restart_count: 1,
        last_error: expect.stringContaining(
          'Kafka metadata refresh for upsert.message callback timed out'
        ),
      })
    );
    consumer.disconnect();
  });

  it('waits for topic metadata after broker auto-creates a subscribed topic', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.getMetadata.mockImplementationOnce(
      (
        options: { topic?: string },
        cb?: (err: Error | null, metadata: unknown) => void
      ) => {
        cb?.(null, {
          topics: [{ name: options.topic, partitions: [] }],
          brokers: [],
        });
      }
    );
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-metadata-autocreate'
    ) as any;

    consumer.subscribe(['upsert.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    expect(firstConsumer.getMetadata).toHaveBeenCalledTimes(1);
    expect(firstConsumer.subscribe).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(250);
    await flushPromises();

    expect(firstConsumer.getMetadata).toHaveBeenCalledTimes(2);
    expect(firstConsumer.subscribe).toHaveBeenCalledWith(['upsert.message']);
    expect(firstConsumer.consume).toHaveBeenCalledTimes(1);
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        connected: true,
        last_error: '',
      })
    );
    consumer.disconnect();
  });

  it('bounds a committed-offset watchdog callback and recovers persistent measurement failure', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.committed.mockImplementation(() => undefined);
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-committed-timeout'
    ) as any;

    consumer.subscribe(['upsert.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const watchdog = consumer.runWatchdogCheck();
      await flushPromises();
      jest.advanceTimersByTime(2_000);
      await watchdog;

      expect(consumer.__health()).toEqual(
        expect.objectContaining({
          lag: null,
          lag_measurement_complete: false,
          lag_measurement_failure_count: attempt,
          restart_count: attempt === 3 ? 1 : 0,
        })
      );
    }

    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        unhealthy: true,
        stall_reason: 'lag_measurement_unavailable',
        stall_restart_enabled: true,
      })
    );
    consumer.disconnect();
  });

  it('bounds a watermark callback that never returns during latest assignment cutover', async () => {
    const firstConsumer = new FakeKafkaConsumer(false);
    firstConsumer.queryWatermarkOffsets.mockImplementation(() => undefined);
    const kafka = {
      createConsumer: jest.fn().mockReturnValueOnce(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-watermark-timeout', {
      startPosition: 'latest-on-assignment',
    }) as any;
    const topic = 'worker.w1.send.message';

    consumer.subscribe([topic]);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();
    kafka.createConsumer.mock.calls[0][1].onPartitionsAssigned([
      { topic, partition: 0, offset: -1 },
    ]);
    await flushPromises();

    jest.advanceTimersByTime(2_000);
    await flushPromises(12);

    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        assignments_ready: false,
        assignment_positioning_count: 0,
        restart_count: 1,
        last_error: expect.stringContaining(
          'Kafka high watermark query for worker.w1.send.message[0] callback timed out'
        ),
      })
    );
    consumer.disconnect();
  });

  it('requires pod replacement and blocks new native generations after disconnect timeout', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const secondConsumer = new FakeKafkaConsumer();
    const onProcessReplacementRequired = jest.fn();
    firstConsumer.disconnect.mockImplementation(() => undefined);
    const kafka = {
      createConsumer: jest
        .fn()
        .mockReturnValueOnce(firstConsumer)
        .mockReturnValueOnce(secondConsumer),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-native-disconnect-timeout',
      { onProcessReplacementRequired }
    ) as any;

    consumer.subscribe(['upsert.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    firstConsumer.emit('event.error', new Error('force generation restart'));
    jest.advanceTimersByTime(1_000);
    await flushPromises();
    expect(firstConsumer.disconnect).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(15_000);
    await flushPromises(12);
    expect(kafka.createConsumer).toHaveBeenCalledTimes(1);
    expect(onProcessReplacementRequired).toHaveBeenCalledTimes(1);
    expect(onProcessReplacementRequired).toHaveBeenCalledWith({
      groupId: 'group-native-disconnect-timeout',
      reason: expect.stringContaining('Kafka consumer disconnect timed out'),
    });
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        connected: false,
        unhealthy: true,
        stall_reason: 'native_disconnect_timeout',
        pod_replacement_required: true,
        pod_replacement_reason: 'native_disconnect_timeout',
        last_error: expect.stringContaining(
          'Kafka consumer disconnect timed out'
        ),
      })
    );

    jest.advanceTimersByTime(60_000);
    await flushPromises();
    expect(kafka.createConsumer).toHaveBeenCalledTimes(1);
    consumer.disconnect();
  });

  it('fail-stops when the public disconnect path cannot confirm native shutdown', async () => {
    const firstConsumer = new FakeKafkaConsumer();
    const onProcessReplacementRequired = jest.fn();
    const disconnected = jest.fn();
    firstConsumer.disconnect.mockImplementation(() => undefined);
    const kafka = {
      createConsumer: jest.fn().mockReturnValue(firstConsumer),
    };
    const consumer = createConsumer(kafka as never, 'group-public-disconnect', {
      onProcessReplacementRequired,
    }) as any;

    consumer.subscribe(['upsert.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    firstConsumer.emit('ready');
    await flushPromises();

    consumer.disconnect(disconnected);
    jest.advanceTimersByTime(15_000);
    await flushPromises(12);

    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(onProcessReplacementRequired).toHaveBeenCalledTimes(1);
    expect(onProcessReplacementRequired).toHaveBeenCalledWith({
      groupId: 'group-public-disconnect',
      reason: expect.stringContaining('Kafka consumer disconnect timed out'),
    });
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        connected: false,
        unhealthy: true,
        pod_replacement_required: true,
      })
    );
    expect(kafka.createConsumer).toHaveBeenCalledTimes(1);
  });

  it('contains a throwing public disconnect callback after native shutdown', async () => {
    const nativeConsumer = new FakeKafkaConsumer();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consumer = createConsumer(
      {
        createConsumer: jest.fn().mockReturnValue(nativeConsumer),
      } as never,
      'group-throwing-disconnect-callback'
    ) as any;
    consumer.subscribe(['upsert.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    nativeConsumer.emit('ready');
    await flushPromises();

    consumer.disconnect(() => {
      throw new Error('disconnect_callback_failed');
    });
    await flushPromises();

    expect(consoleError).toHaveBeenCalledWith(
      'Kafka disconnect callback failed',
      expect.objectContaining({
        group_id: 'group-throwing-disconnect-callback',
        error: 'disconnect_callback_failed',
      })
    );
    consoleError.mockRestore();
  });

  it('accepts a native disconnected state when the callback is lost', async () => {
    const nativeConsumer = new FakeKafkaConsumer();
    const onProcessReplacementRequired = jest.fn();
    const disconnected = jest.fn();
    nativeConsumer.disconnect.mockImplementation(() => undefined);
    Object.assign(nativeConsumer, {
      isConnected: jest.fn(() => false),
    });
    const consumer = createConsumer(
      {
        createConsumer: jest.fn().mockReturnValue(nativeConsumer),
      } as never,
      'group-lost-disconnect-callback',
      { onProcessReplacementRequired }
    ) as any;

    consumer.subscribe(['upsert.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    nativeConsumer.emit('ready');
    await flushPromises();

    consumer.disconnect(disconnected);
    jest.advanceTimersByTime(15_000);
    await flushPromises(12);

    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(onProcessReplacementRequired).not.toHaveBeenCalled();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        connected: false,
        pod_replacement_required: false,
      })
    );
  });

  it('does not start a replacement cycle during graceful process shutdown', async () => {
    const nativeConsumer = new FakeKafkaConsumer();
    const onProcessReplacementRequired = jest.fn();
    const disconnected = jest.fn();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    nativeConsumer.disconnect.mockImplementation(() => undefined);
    const consumer = createConsumer(
      {
        createConsumer: jest.fn().mockReturnValue(nativeConsumer),
      } as never,
      'group-graceful-process-shutdown',
      { onProcessReplacementRequired }
    ) as any;

    consumer.subscribe(['upsert.message']);
    consumer.consume();
    consumer.connect({}, jest.fn());
    await flushPromises();
    nativeConsumer.emit('ready');
    await flushPromises();

    beginKafkaConsumerGracefulProcessShutdown();
    consumer.disconnect(disconnected);
    jest.advanceTimersByTime(15_000);
    await flushPromises(12);

    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(onProcessReplacementRequired).not.toHaveBeenCalled();
    expect(consumer.__health()).toEqual(
      expect.objectContaining({
        connected: false,
        pod_replacement_required: false,
        last_error: expect.stringContaining(
          'Kafka consumer disconnect timed out'
        ),
      })
    );
    expect(consoleError).toHaveBeenCalledWith(
      'Kafka native consumer shutdown was not confirmed',
      expect.objectContaining({
        group_id: 'group-graceful-process-shutdown',
        graceful_process_shutdown: true,
      })
    );
    consoleError.mockRestore();
  });

  it('globally fences every new native generation while process replacement is pending', async () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const firstConsumer = new FakeKafkaConsumer();
    firstConsumer.disconnect.mockImplementation(() => undefined);
    const kafka = {
      createConsumer: jest.fn().mockReturnValue(firstConsumer),
    };

    try {
      process.env.NODE_ENV = 'production';
      const consumer = createConsumer(
        kafka as never,
        'group-global-process-replacement'
      ) as any;
      consumer.subscribe(['upsert.message']);
      consumer.consume();
      consumer.connect({}, jest.fn());
      await flushPromises();
      firstConsumer.emit('ready');
      await flushPromises();

      consumer.disconnect();
      jest.advanceTimersByTime(15_000);
      await flushPromises(12);

      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
      expect(() =>
        createConsumer(kafka as never, 'group-forbidden-replacement')
      ).toThrow(
        'Kafka process replacement in progress; refusing a new native consumer generation'
      );
      expect(kafka.createConsumer).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = 'test';
      resetKafkaConsumerProcessReplacementForTests();
      process.env.NODE_ENV = previousNodeEnvironment;
      kill.mockRestore();
    }
  });

  it('forces process exit at the hard boundary when native shutdown remains wedged', async () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    const previousExitCode = process.exitCode;
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const nativeConsumer = new FakeKafkaConsumer();
    nativeConsumer.disconnect.mockImplementation(() => undefined);
    const kafka = {
      createConsumer: jest.fn().mockReturnValue(nativeConsumer),
    };

    try {
      process.env.NODE_ENV = 'production';
      process.exitCode = undefined;
      const consumer = createConsumer(
        kafka as never,
        'group-hard-process-replacement'
      ) as any;
      consumer.subscribe(['upsert.message']);
      consumer.consume();
      consumer.connect({}, jest.fn());
      await flushPromises();
      nativeConsumer.emit('ready');
      await flushPromises();

      consumer.disconnect();
      await jest.advanceTimersByTimeAsync(15_000);
      await flushPromises(12);

      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
      expect(exit).not.toHaveBeenCalled();
      const hardExitTimerIndex = setTimeoutSpy.mock.calls.findIndex(
        ([, timeout]) => timeout === 45_000
      );
      const hardExitTimer = setTimeoutSpy.mock.results[hardExitTimerIndex]
        ?.value as NodeJS.Timeout | undefined;
      expect(hardExitTimerIndex).toBeGreaterThanOrEqual(0);
      expect(hardExitTimer?.hasRef()).toBe(false);

      await jest.advanceTimersByTimeAsync(44_999);
      expect(exit).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      process.env.NODE_ENV = 'test';
      resetKafkaConsumerProcessReplacementForTests();
      process.env.NODE_ENV = previousNodeEnvironment;
      process.exitCode = previousExitCode;
      setTimeoutSpy.mockRestore();
      exit.mockRestore();
      kill.mockRestore();
    }
  });

  it('cancels a pending unref hard-exit handle when replacement state is reset in tests', async () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    const previousExitCode = process.exitCode;
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const nativeConsumer = new FakeKafkaConsumer();
    nativeConsumer.disconnect.mockImplementation(() => undefined);

    try {
      process.env.NODE_ENV = 'production';
      process.exitCode = undefined;
      const consumer = createConsumer(
        {
          createConsumer: jest.fn().mockReturnValue(nativeConsumer),
        } as never,
        'group-hard-process-replacement-reset'
      ) as any;
      consumer.subscribe(['upsert.message']);
      consumer.consume();
      consumer.connect({}, jest.fn());
      await flushPromises();
      nativeConsumer.emit('ready');
      await flushPromises();

      consumer.disconnect();
      await jest.advanceTimersByTimeAsync(15_000);
      await flushPromises(12);

      const hardExitTimerIndex = setTimeoutSpy.mock.calls.findIndex(
        ([, timeout]) => timeout === 45_000
      );
      const hardExitTimer = setTimeoutSpy.mock.results[hardExitTimerIndex]
        ?.value as NodeJS.Timeout | undefined;
      expect(hardExitTimer?.hasRef()).toBe(false);

      process.env.NODE_ENV = 'test';
      resetKafkaConsumerProcessReplacementForTests();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(hardExitTimer);
    } finally {
      process.env.NODE_ENV = 'test';
      resetKafkaConsumerProcessReplacementForTests();
      process.env.NODE_ENV = previousNodeEnvironment;
      process.exitCode = previousExitCode;
      clearTimeoutSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      kill.mockRestore();
    }
  });

  it('lets an active signal shutdown deadline own the final process exit', async () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    const previousExitCode = process.exitCode;
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const firstConsumer = new FakeKafkaConsumer();
    const disconnected = jest.fn();
    firstConsumer.disconnect.mockImplementation(() => undefined);
    const kafka = {
      createConsumer: jest.fn().mockReturnValue(firstConsumer),
    };
    const consumer = createConsumer(
      kafka as never,
      'group-process-shutdown'
    ) as any;

    try {
      process.env.NODE_ENV = 'production';
      consumer.subscribe(['upsert.message']);
      consumer.consume();
      consumer.connect({}, jest.fn());
      await flushPromises();
      firstConsumer.emit('ready');
      await flushPromises();

      process.exitCode = 143;
      consumer.disconnect(disconnected);
      jest.advanceTimersByTime(15_000);
      await flushPromises(12);

      expect(disconnected).toHaveBeenCalledTimes(1);
      expect(kill).not.toHaveBeenCalled();
      expect(consumer.__health()).toEqual(
        expect.objectContaining({
          connected: false,
          pod_replacement_required: true,
          last_error: expect.stringContaining(
            'Kafka consumer disconnect timed out'
          ),
        })
      );
    } finally {
      process.env.NODE_ENV = previousNodeEnvironment;
      process.exitCode = previousExitCode;
      kill.mockRestore();
    }
  });
});
