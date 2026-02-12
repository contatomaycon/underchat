import type { KafkaConsumer } from 'node-rdkafka';

export function commitOffset(
  consumer: KafkaConsumer,
  topic: string,
  partition: number,
  offset: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        consumer.commitSync([
          {
            topic,
            partition,
            offset: offset + 1,
          },
        ]);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}
