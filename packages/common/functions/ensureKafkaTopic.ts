import { Kafka } from 'kafkajs';
import { wait } from './wait';

export async function ensureKafkaTopic(
  kafka: Kafka,
  topic: string,
  numPartitions = 1,
  replicationFactor = 1,
  timeoutMs = 30000
): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();

  try {
    const meta = await admin
      .fetchTopicMetadata({ topics: [topic] })
      .catch(() => null);

    const exists =
      !!meta &&
      meta.topics.some((t) => t.name === topic && t.partitions.length > 0);

    if (!exists) {
      await admin.createTopics({
        topics: [{ topic, numPartitions, replicationFactor }],
        waitForLeaders: true,
      });
    }

    const start = Date.now();

    for (;;) {
      const check = await admin
        .fetchTopicMetadata({ topics: [topic] })
        .catch(() => null);

      const ok =
        !!check &&
        check.topics.some(
          (t) =>
            t.name === topic &&
            t.partitions.length >= numPartitions &&
            t.partitions.every(
              (p) => typeof p.leader === 'number' && p.leader >= 0
            )
        );
      if (ok) break;

      if (Date.now() - start > timeoutMs)
        throw new Error(`Topic not ready: ${topic}`);

      await wait(500);
    }
  } finally {
    await admin.disconnect();
  }
}
