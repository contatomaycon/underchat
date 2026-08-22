import 'reflect-metadata';

const mockCreateTopic = jest.fn();
const mockCreatePartitions = jest.fn();
const mockDisconnect = jest.fn();
const mockAdminCreate = jest.fn(() => ({
  createTopic: mockCreateTopic,
  createPartitions: mockCreatePartitions,
  disconnect: mockDisconnect,
}));

jest.mock('@core/config/environments', () => ({
  kafkaEnvironment: {
    securityProtocol: 'plaintext',
    saslMechanism: undefined,
    kafkaUsername: undefined,
    kafkaPassword: undefined,
    provisionerOperationsEnabled: true,
    provisionerUsername: undefined,
    provisionerPassword: undefined,
    provisionerSaslMechanism: undefined,
  },
}));

jest.mock('@core/common/vendors/nodeRdkafka', () => ({
  rdkafka: {
    AdminClient: {
      create: mockAdminCreate,
    },
  },
}));

import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';

const kafka = {
  getBroker: jest.fn(() => 'broker:9092'),
};

describe('ensureKafkaTopic', () => {
  beforeEach(() => {
    mockCreateTopic.mockReset();
    mockCreatePartitions.mockReset();
    mockDisconnect.mockReset();
    mockAdminCreate.mockClear();
  });

  it('creates a missing topic with the requested topology', async () => {
    mockCreateTopic.mockImplementation(
      (_input: unknown, _timeout: number, callback: (error: null) => void) =>
        callback(null)
    );

    await ensureKafkaTopic(
      kafka as never,
      'global.events.create',
      30,
      3,
      7_000
    );

    expect(mockCreateTopic).toHaveBeenCalledWith(
      {
        topic: 'global.events.create',
        num_partitions: 30,
        replication_factor: 3,
      },
      7_000,
      expect.any(Function)
    );
    expect(mockCreatePartitions).not.toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('expands an existing auto-created topic to the configured partition floor', async () => {
    mockCreateTopic.mockImplementation(
      (
        _input: unknown,
        _timeout: number,
        callback: (error: { code: number; message: string }) => void
      ) => callback({ code: 36, message: 'Topic already exists' })
    );
    mockCreatePartitions.mockImplementation(
      (
        _topic: string,
        _partitions: number,
        _timeout: number,
        callback: (error: null) => void
      ) => callback(null)
    );

    await ensureKafkaTopic(
      kafka as never,
      'user.phone.jid.update.expand',
      30,
      3
    );

    expect(mockCreatePartitions).toHaveBeenCalledWith(
      'user.phone.jid.update.expand',
      30,
      60_000,
      expect.any(Function)
    );
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('does not send a redundant createPartitions request for an existing one-partition worker topic', async () => {
    mockCreateTopic.mockImplementation(
      (
        _input: unknown,
        _timeout: number,
        callback: (error: { code: number; message: string }) => void
      ) => callback({ code: 36, message: 'Topic already exists' })
    );

    await ensureKafkaTopic(
      kafka as never,
      'worker.019f6ca3.send.message.one-partition',
      1,
      2
    );

    expect(mockCreatePartitions).not.toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('is idempotent when an existing topic already meets or exceeds the floor', async () => {
    mockCreateTopic.mockImplementation(
      (
        _input: unknown,
        _timeout: number,
        callback: (error: { code: number; message: string }) => void
      ) => callback({ code: 36, message: 'Topic already exists' })
    );
    mockCreatePartitions.mockImplementation(
      (
        _topic: string,
        _partitions: number,
        _timeout: number,
        callback: (error: { code: number; message: string }) => void
      ) => callback({ code: 37, message: 'Topic already has 30 partition(s).' })
    );

    await expect(
      ensureKafkaTopic(kafka as never, 'global.events.idempotent', 30, 3)
    ).resolves.toBeUndefined();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a partition expansion error and still disconnects', async () => {
    mockCreateTopic.mockImplementation(
      (
        _input: unknown,
        _timeout: number,
        callback: (error: { code: number; message: string }) => void
      ) => callback({ code: 36, message: 'Topic already exists' })
    );
    mockCreatePartitions.mockImplementation(
      (
        _topic: string,
        _partitions: number,
        _timeout: number,
        callback: (error: { code: number; message: string }) => void
      ) => callback({ code: 500, message: 'partition expansion failed' })
    );

    await expect(
      ensureKafkaTopic(kafka as never, 'global.events.failure', 30, 3)
    ).rejects.toThrow('partition expansion failed');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('fails closed when error 37 does not prove the topic already meets the floor', async () => {
    mockCreateTopic.mockImplementation(
      (
        _input: unknown,
        _timeout: number,
        callback: (error: { code: number; message: string }) => void
      ) => callback({ code: 36, message: 'Topic already exists' })
    );
    mockCreatePartitions.mockImplementation(
      (
        _topic: string,
        _partitions: number,
        _timeout: number,
        callback: (error: { code: number; message: string }) => void
      ) => callback({ code: 37, message: 'Number of partitions is invalid' })
    );

    await expect(
      ensureKafkaTopic(kafka as never, 'global.events.invalid', 30, 3)
    ).rejects.toThrow('Number of partitions is invalid');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent and repeated successful reconciliation in-process', async () => {
    let finishCreate: ((error: null) => void) | undefined;
    mockCreateTopic.mockImplementation(
      (_input: unknown, _timeout: number, callback: (error: null) => void) => {
        finishCreate = callback;
      }
    );

    const first = ensureKafkaTopic(
      kafka as never,
      'global.events.singleflight',
      30,
      3
    );
    const second = ensureKafkaTopic(
      kafka as never,
      'global.events.singleflight',
      30,
      3
    );

    expect(mockCreateTopic).toHaveBeenCalledTimes(1);
    finishCreate?.(null);
    await Promise.all([first, second]);
    await ensureKafkaTopic(kafka as never, 'global.events.singleflight', 30, 3);

    expect(mockCreateTopic).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed reconciliation', async () => {
    mockCreateTopic
      .mockImplementationOnce(
        (
          _input: unknown,
          _timeout: number,
          callback: (error: { code: number; message: string }) => void
        ) => callback({ code: 500, message: 'controller unavailable' })
      )
      .mockImplementationOnce(
        (_input: unknown, _timeout: number, callback: (error: null) => void) =>
          callback(null)
      );

    await expect(
      ensureKafkaTopic(kafka as never, 'global.events.retry', 30, 3)
    ).rejects.toThrow('controller unavailable');
    await expect(
      ensureKafkaTopic(kafka as never, 'global.events.retry', 30, 3)
    ).resolves.toBeUndefined();

    expect(mockCreateTopic).toHaveBeenCalledTimes(2);
    expect(mockDisconnect).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid topology before opening an admin connection', async () => {
    await expect(
      ensureKafkaTopic(kafka as never, 'global.events.invalid-input', 0, 3)
    ).rejects.toThrow('partition count must be a positive integer');
    expect(mockAdminCreate).not.toHaveBeenCalled();
  });

  it.each([
    'worker.019e4c0a-a74d-734e-8f30-5ecd1908ded8.send.message',
    'worker.019e4c0a-a74d-734e-8f30-5ecd1908ded8.send.message.dlq',
    'worker.019e4c0a-a74d-734e-8f30-5ecd1908ded8.consumer.dlq',
  ])(
    'rejects generic provisioning of durable worker topic %s',
    async (topic) => {
      await expect(
        ensureKafkaTopic(kafka as never, topic, 1, 2)
      ).rejects.toThrow('generic_durable_worker_topic_provisioning_disabled');

      expect(mockAdminCreate).not.toHaveBeenCalled();
    }
  );
});
