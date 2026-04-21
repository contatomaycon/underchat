import 'reflect-metadata';

const mockKafkaEnvironment = {
  securityProtocol: 'plaintext',
  saslMechanism: 'plain',
  kafkaUsername: 'user',
  kafkaPassword: 'pass',
};

const mockCreateTopic = jest.fn();
const mockDeleteTopic = jest.fn();
const mockDisconnect = jest.fn();
const mockAdminCreate = jest.fn(() => ({
  createTopic: mockCreateTopic,
  deleteTopic: mockDeleteTopic,
  disconnect: mockDisconnect,
}));

jest.mock('@core/config/environments', () => ({
  kafkaEnvironment: mockKafkaEnvironment,
}));

jest.mock('@core/common/vendors/nodeRdkafka', () => ({
  rdkafka: {
    AdminClient: {
      create: mockAdminCreate,
    },
  },
}));

import { KafkaService } from '@core/services/kafka.service';

describe('KafkaService', () => {
  const makeService = () => {
    const kafka = {
      getBroker: jest.fn(() => 'broker:9092'),
    };

    const service = new KafkaService(kafka as never);

    return {
      service,
      kafka,
    };
  };

  beforeEach(() => {
    mockKafkaEnvironment.securityProtocol = 'plaintext';
    mockKafkaEnvironment.saslMechanism = 'plain';
    mockKafkaEnvironment.kafkaUsername = 'user';
    mockKafkaEnvironment.kafkaPassword = 'pass';

    mockCreateTopic.mockReset();
    mockDeleteTopic.mockReset();
    mockDisconnect.mockReset();
    mockAdminCreate.mockClear();
  });

  it('builds admin config for plaintext protocol', () => {
    makeService();

    expect(mockAdminCreate).toHaveBeenCalledTimes(1);
    expect(mockAdminCreate).toHaveBeenCalledWith({
      'client.id': 'kafka-admin',
      'metadata.broker.list': 'broker:9092',
      'security.protocol': 'plaintext',
    });
  });

  it('builds admin config with sasl and ssl options when protocol is sasl_ssl', () => {
    mockKafkaEnvironment.securityProtocol = 'SASL_SSL';

    makeService();

    expect(mockAdminCreate).toHaveBeenCalledWith({
      'client.id': 'kafka-admin',
      'metadata.broker.list': 'broker:9092',
      'security.protocol': 'sasl_ssl',
      'sasl.mechanism': 'plain',
      'sasl.username': 'user',
      'sasl.password': 'pass',
      'enable.ssl.certificate.verification': false,
    });
  });

  it('does not include sasl credentials when protocol is not plaintext but credentials are incomplete', () => {
    mockKafkaEnvironment.securityProtocol = 'SASL_PLAINTEXT';
    mockKafkaEnvironment.kafkaPassword = '';

    makeService();

    expect(mockAdminCreate).toHaveBeenCalledWith({
      'client.id': 'kafka-admin',
      'metadata.broker.list': 'broker:9092',
      'security.protocol': 'sasl_plaintext',
    });
  });

  it('creates all topics and ignores already-existing errors', async () => {
    const { service } = makeService();

    mockCreateTopic.mockImplementation(
      (
        input: { topic: string },
        timeout: number,
        cb: (error: { message?: string; code?: number } | null) => void
      ) => {
        expect(timeout).toBe(4000);

        if (input.topic === 'topic-1') {
          cb(null);
          return;
        }

        cb({
          code: 36,
          message: 'Topic already exists',
        });
      }
    );

    await expect(
      service.createTopics(['topic-1', 'topic-2'], 2, 3, 4000)
    ).resolves.toBeUndefined();

    expect(mockCreateTopic).toHaveBeenCalledTimes(2);
    expect(mockCreateTopic).toHaveBeenNthCalledWith(
      1,
      {
        topic: 'topic-1',
        num_partitions: 2,
        replication_factor: 3,
      },
      4000,
      expect.any(Function)
    );
  });

  it('propagates create topic error when it is not an already-existing topic error', async () => {
    const { service } = makeService();

    mockCreateTopic.mockImplementation(
      (
        _: unknown,
        __: number,
        cb: (error: { message: string; code: number } | null) => void
      ) => {
        cb({
          code: 500,
          message: 'internal create failure',
        });
      }
    );

    await expect(service.createTopics(['topic-err'])).rejects.toThrow(
      'internal create failure'
    );
  });

  it('returns early when createTopics receives empty list', async () => {
    const { service } = makeService();

    await expect(service.createTopics([])).resolves.toBeUndefined();

    expect(mockCreateTopic).not.toHaveBeenCalled();
  });

  it('deletes topics and treats unknown topic/partition errors as success', async () => {
    const { service } = makeService();

    mockDeleteTopic.mockImplementation(
      (
        topic: string,
        timeout: number,
        cb: (error: { message?: string; code?: number } | null) => void
      ) => {
        expect(timeout).toBe(5000);

        if (topic === 'topic-1') {
          cb(null);
          return;
        }

        cb({
          code: 3,
          message: 'Unknown topic or partition',
        });
      }
    );

    await expect(
      service.deleteTopics(['topic-1', 'topic-unknown'])
    ).resolves.toBeUndefined();

    expect(mockDeleteTopic).toHaveBeenCalledTimes(2);
    expect(mockDeleteTopic).toHaveBeenNthCalledWith(
      1,
      'topic-1',
      5000,
      expect.any(Function)
    );
  });

  it('propagates delete topic error for non-retryable failures', async () => {
    const { service } = makeService();

    mockDeleteTopic.mockImplementation(
      (
        _: string,
        __: number,
        cb: (error: { message: string; code: number } | null) => void
      ) => {
        cb({
          code: 2,
          message: 'broker failure',
        });
      }
    );

    await expect(service.deleteTopics(['topic-err'])).rejects.toThrow(
      'broker failure'
    );
  });

  it('returns early when deleteTopics receives empty list', async () => {
    const { service } = makeService();

    await expect(service.deleteTopics([])).resolves.toBeUndefined();

    expect(mockDeleteTopic).not.toHaveBeenCalled();
  });

  it('disconnects admin client on close', async () => {
    const { service } = makeService();

    await expect(service.close()).resolves.toBeUndefined();

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
