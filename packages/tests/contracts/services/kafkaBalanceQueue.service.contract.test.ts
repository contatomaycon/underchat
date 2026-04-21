import 'reflect-metadata';
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
import { KafkaBalanceQueueService } from '@core/services/kafkaBalanceQueue.service';

describe('KafkaBalanceQueueService', () => {
  it('builds worker topics and delegates delete/close', async () => {
    const deleteTopics = jest.fn(async () => undefined);
    const close = jest.fn(async () => undefined);
    const service = new KafkaBalanceQueueService({
      deleteTopics,
      close,
    } as never);

    expect(service.getNumPartitions()).toBe(1);
    expect(service.getReplicationFactor()).toBe(2);
    expect(service.worker('s1')).toBe('worker.s1');
    expect(service.all('s1')).toEqual(['worker.s1']);

    await expect(service.delete('s1')).resolves.toBeUndefined();
    expect(deleteTopics).toHaveBeenCalledWith(['worker.s1']);
    await expect(service.close()).resolves.toBeUndefined();
  });
});
