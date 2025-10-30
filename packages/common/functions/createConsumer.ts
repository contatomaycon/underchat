import { Consumer, Kafka } from 'kafkajs';

export function createConsumer(kafka: Kafka, groupId: string): Consumer {
  const consumer = kafka.consumer({
    groupId,
    retry: { retries: 20, initialRetryTime: 500 },
    allowAutoTopicCreation: true,
    sessionTimeout: 30_000,
    rebalanceTimeout: 60_000,
    heartbeatInterval: 3_000,
    metadataMaxAge: 10_000,
  });

  return consumer;
}
