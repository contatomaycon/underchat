import { injectable, inject } from 'tsyringe';
import { Admin, Consumer, Kafka } from 'kafkajs';

@injectable()
export class KafkaService {
  private readonly admin: Admin;
  private readonly consumers = new Map<string, Consumer>();

  constructor(@inject('Kafka') private readonly kafka: Kafka) {
    this.admin = this.kafka.admin();
  }

  async createTopics(
    topics: string[],
    numPartitions = 1,
    replicationFactor = 1
  ): Promise<void> {
    await this.admin.connect();
    const existingTopics = await this.admin.listTopics();

    const topicsToCreate = topics.filter(
      (topic) => !existingTopics.includes(topic)
    );

    if (topicsToCreate.length > 0) {
      await this.admin.createTopics({
        topics: topicsToCreate.map((topic) => ({
          topic,
          numPartitions,
          replicationFactor,
        })),
      });
    }

    await this.close();
  }

  async registerConsumer(
    groupId: string,
    topics: string[],
    fromBeginning = true
  ): Promise<void> {
    const consumer = this.kafka.consumer({ groupId });
    await consumer.connect();

    for (const topic of topics) {
      await consumer.subscribe({ topic, fromBeginning });
    }

    this.consumers.set(groupId, consumer);
  }

  async close(): Promise<void> {
    await this.admin.disconnect();

    for (const consumer of this.consumers.values()) {
      await consumer.disconnect();
    }
  }
}
