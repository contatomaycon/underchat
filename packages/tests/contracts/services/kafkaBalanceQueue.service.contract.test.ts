import 'reflect-metadata';
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
import { KafkaBalanceQueueService } from '@core/services/kafkaBalanceQueue.service';

describe('KafkaBalanceQueueService', () => {
  it('builds worker topics while runtime deletion remains disabled', async () => {
    const service = new KafkaBalanceQueueService();

    expect(service.getNumPartitions()).toBe(1);
    expect(service.getReplicationFactor()).toBe(2);
    expect(service.worker('s1')).toBe('worker.s1');
    expect(service.all('s1')).toEqual(['worker.s1']);

    await expect(service.delete('s1')).rejects.toThrow(
      'runtime_balance_kafka_topic_deletion_disabled'
    );
    expect('close' in service).toBe(false);
  });
});
