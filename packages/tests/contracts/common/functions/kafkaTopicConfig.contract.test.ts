import {
  isRecoverableKafkaTopicError,
  isWorkerScopedKafkaTopic,
  resolveKafkaTopicConfig,
} from '@core/common/functions/kafkaTopicConfig';

describe('kafkaTopicConfig', () => {
  it('resolves worker scoped topics to 1 partition and replication factor 2', () => {
    expect(isWorkerScopedKafkaTopic('worker.w1.send.message')).toBe(true);
    expect(resolveKafkaTopicConfig('worker.w1.send.message')).toEqual({
      numPartitions: 1,
      replicationFactor: 2,
    });
    expect(resolveKafkaTopicConfig('worker.w1.connection.qrcode')).toEqual({
      numPartitions: 1,
      replicationFactor: 2,
    });
  });

  it('resolves global topics to 30 partitions and replication factor 3', () => {
    expect(isWorkerScopedKafkaTopic('worker.config.update')).toBe(false);
    expect(resolveKafkaTopicConfig('worker.config.update')).toEqual({
      numPartitions: 30,
      replicationFactor: 3,
    });
    expect(resolveKafkaTopicConfig('update.message')).toEqual({
      numPartitions: 30,
      replicationFactor: 3,
    });
  });

  it('detects recoverable topic metadata errors', () => {
    expect(
      isRecoverableKafkaTopicError(
        new Error('Broker: Unknown topic or partition')
      )
    ).toBe(true);
    expect(isRecoverableKafkaTopicError({ code: 3 })).toBe(true);
    expect(isRecoverableKafkaTopicError(new Error('permission denied'))).toBe(
      false
    );
  });
});
