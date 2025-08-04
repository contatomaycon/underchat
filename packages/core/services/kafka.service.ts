import { injectable, inject } from 'tsyringe';
import { Admin, Kafka } from 'kafkajs';

@injectable()
export class KafkaService {
  private readonly admin: Admin;

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

  async close(): Promise<void> {
    await this.admin.disconnect();
  }
}
