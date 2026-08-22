import 'reflect-metadata';

const mockEnsureKafkaTopic = jest.fn(async () => undefined);

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: mockEnsureKafkaTopic,
}));

import { KafkaService } from '@core/services/kafka.service';

describe('KafkaService global topic boundary', () => {
  const kafka = { getBroker: jest.fn(() => 'broker:9092') };
  const service = new KafkaService(kafka as never);

  beforeEach(() => {
    mockEnsureKafkaTopic.mockClear();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates global topics with the shared topology default', async () => {
    await expect(
      service.createTopics(['global.events.first', 'global.events.second'])
    ).resolves.toBeUndefined();

    expect(mockEnsureKafkaTopic).toHaveBeenCalledTimes(2);
    expect(mockEnsureKafkaTopic).toHaveBeenNthCalledWith(
      1,
      kafka,
      'global.events.first',
      30,
      3,
      30_000
    );
    expect(mockEnsureKafkaTopic).toHaveBeenNthCalledWith(
      2,
      kafka,
      'global.events.second',
      30,
      3,
      30_000
    );
  });

  it('honors an explicit topology for a global topic', async () => {
    await service.createTopics(['global.events.custom'], 6, 2, 4_000);

    expect(mockEnsureKafkaTopic).toHaveBeenCalledWith(
      kafka,
      'global.events.custom',
      6,
      2,
      4_000
    );
  });

  it('returns early for an empty create request', async () => {
    await expect(service.createTopics([])).resolves.toBeUndefined();

    expect(mockEnsureKafkaTopic).not.toHaveBeenCalled();
  });

  it.each([
    'worker.worker-1.send.message',
    'worker.worker-1.schedule.send.message',
    'worker.worker-1.notification.message',
    'worker.worker-1.webhook.integration',
  ])(
    'rejects per-worker topic provisioning through the global API: %s',
    async (topic) => {
      await expect(service.createTopics([topic])).rejects.toThrow(
        `generic_durable_worker_topic_provisioning_disabled:${topic}`
      );

      expect(mockEnsureKafkaTopic).not.toHaveBeenCalled();
    }
  );

  it('fails before partial creation when a request mixes global and worker topics', async () => {
    await expect(
      service.createTopics([
        'global.events.must-not-be-created',
        'worker.worker-1.send.message',
      ])
    ).rejects.toThrow('generic_durable_worker_topic_provisioning_disabled');

    expect(mockEnsureKafkaTopic).not.toHaveBeenCalled();
  });

  it('returns early for an empty delete request', async () => {
    await expect(service.deleteTopics([])).resolves.toBeUndefined();

    expect(console.warn).not.toHaveBeenCalled();
  });

  it('keeps generic Kafka deletion disabled', async () => {
    await expect(service.deleteTopics(['global.events'])).rejects.toThrow(
      'runtime_generic_kafka_topic_deletion_disabled'
    );

    expect(console.warn).toHaveBeenCalledWith(
      '[worker-kafka-topic-audit]',
      expect.stringContaining('worker_topics.delete.admin_boundary_denied')
    );
  });
});
