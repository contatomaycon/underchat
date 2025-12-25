import { Consumer, Kafka } from 'kafkajs';

export function createConsumer(kafka: Kafka, groupId: string): Consumer {
  const consumer = kafka.consumer({
    groupId,
    retry: { retries: 20, initialRetryTime: 500 },
    allowAutoTopicCreation: true,
    sessionTimeout: 60 * 1000,
    rebalanceTimeout: 90 * 1000,
    heartbeatInterval: 10 * 1000,
    metadataMaxAge: 10 * 1000,
  });

  return consumer;
}
