import type { KafkaConsumer } from 'node-rdkafka';

function kafkaErrorCode(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'number') {
    return code;
  }
  if (typeof code === 'string' && code.trim() !== '') {
    const parsed = Number(code);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function isRecoverableCommitOffsetError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  const code = kafkaErrorCode(error);

  return (
    code === 22 ||
    code === 25 ||
    code === 27 ||
    message.includes('specified group generation id is not valid') ||
    message.includes('illegal generation') ||
    message.includes('rebalance in progress') ||
    message.includes('kafka consumer is not connected') ||
    message.includes('consumer is not connected')
  );
}

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
        if (isRecoverableCommitOffsetError(error)) {
          resolve();
          return;
        }

        reject(error);
      }
    });
  });
}
