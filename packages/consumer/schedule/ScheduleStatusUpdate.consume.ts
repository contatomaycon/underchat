import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IScheduleStatusUpdate } from '@core/common/interfaces/IScheduleStatusUpdate';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { scheduleMappings } from '@core/mappings/schedule.mappings';
import { ScheduleStatusUpdaterRepository } from '@core/repositories/schedule/ScheduleStatusUpdater.repository';
import { IScheduleTracker } from '@core/common/interfaces/IScheduleTracker';

@singleton()
export class ScheduleStatusUpdateConsume {
  private consumer: Consumer | null = null;
  private readonly scheduleTrackers: Map<string, IScheduleTracker> = new Map();
  private readonly TIMEOUT_MS = 5 * 60 * 1000;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly elasticDatabaseService: ElasticDatabaseService,
    private readonly scheduleStatusUpdaterRepository: ScheduleStatusUpdaterRepository
  ) {}

  private get consumerOrThrow(): Consumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-schedule-status-update'
    );

    const topic = this.kafkaServiceQueueService.scheduleStatusUpdate();

    await ensureKafkaTopic(this.kafka, topic);
    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: true });

    await this.consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        const data = this.parseMessage(message.value);

        if (!data) {
          await this.commitNext(topic, partition, message.offset);
          return;
        }

        const stop = startHeartbeat(heartbeat);
        try {
          await this.handleStatusUpdate(data);
        } catch (error) {
          console.error(
            `Error processing schedule status update for schedule ${data.schedule_id}, contact ${data.contact_id}:`,
            error
          );
        } finally {
          stop();
        }

        await this.commitNext(topic, partition, message.offset);
      },
    });
  }

  public async close(): Promise<void> {
    for (const tracker of this.scheduleTrackers.values()) {
      if (tracker.timeoutTimer) {
        clearTimeout(tracker.timeoutTimer);
      }
    }

    this.scheduleTrackers.clear();

    if (!this.consumer) {
      return;
    }

    try {
      await this.consumer.stop();
    } finally {
      await this.consumer.disconnect();
      this.consumer = null;
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: string
  ): Promise<void> {
    const next = (BigInt(offset) + 1n).toString();

    await this.consumerOrThrow.commitOffsets([
      { topic, partition, offset: next },
    ]);
  }

  private parseMessage(value: Buffer | null): IScheduleStatusUpdate | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IScheduleStatusUpdate;
      if (
        parsed &&
        'schedule_id' in parsed &&
        'contact_id' in parsed &&
        'message_id' in parsed &&
        'status' in parsed
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async handleStatusUpdate(data: IScheduleStatusUpdate): Promise<void> {
    await this.updateMessageStatusInElasticsearch(data);

    const tracker = await this.getOrCreateTracker(data.schedule_id);

    const messageKey = `${data.contact_id}:${data.message_id}`;

    if (data.status === EScheduleStatus.sent) {
      tracker.completedMessages.add(messageKey);
    }

    if (data.status === EScheduleStatus.failed) {
      tracker.failedMessages.add(messageKey);
    }

    tracker.lastUpdateTime = Date.now();

    this.resetTimeout(tracker);

    await this.checkAndFinalizeSchedule(tracker);
  }

  private async getOrCreateTracker(
    scheduleId: string
  ): Promise<IScheduleTracker> {
    let tracker = this.scheduleTrackers.get(scheduleId);

    if (!tracker) {
      const totalMessages = await this.getTotalMessagesForSchedule(scheduleId);

      tracker = {
        scheduleId,
        totalMessages,
        completedMessages: new Set(),
        failedMessages: new Set(),
        lastUpdateTime: Date.now(),
        timeoutTimer: null,
      };

      this.scheduleTrackers.set(scheduleId, tracker);
      this.resetTimeout(tracker);
    }

    return tracker;
  }

  private async getTotalMessagesForSchedule(
    scheduleId: string
  ): Promise<number> {
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const query = {
      size: 0,
      query: {
        term: {
          schedule_id: scheduleId,
        },
      },
    };

    const result = await this.elasticDatabaseService.select<{
      hits: { total: { value: number } | number };
    }>(EElasticIndex.schedule, query);

    if (!result) {
      return 0;
    }

    const total = result.hits.total as { value: number } | number;

    if (typeof total === 'number') {
      return total;
    }

    return total.value;
  }

  private resetTimeout(tracker: IScheduleTracker): void {
    if (tracker.timeoutTimer) {
      clearTimeout(tracker.timeoutTimer);
    }

    tracker.timeoutTimer = setTimeout(async () => {
      await this.handleTimeout(tracker);
    }, this.TIMEOUT_MS);
  }

  private async handleTimeout(tracker: IScheduleTracker): Promise<void> {
    const pendingMessages = await this.getPendingMessages(tracker.scheduleId);

    for (const message of pendingMessages) {
      await this.updateMessageStatusInElasticsearch({
        schedule_id: tracker.scheduleId,
        contact_id: message.contact_id,
        message_id: message.message_id,
        status: EScheduleStatus.failed,
      });

      const messageKey = `${message.contact_id}:${message.message_id}`;
      tracker.failedMessages.add(messageKey);
    }

    await this.finalizeSchedule(tracker);
  }

  private async getPendingMessages(
    scheduleId: string
  ): Promise<Array<{ contact_id: string; message_id: string }>> {
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const query = {
      size: 10000,
      query: {
        bool: {
          must: [
            {
              term: {
                schedule_id: scheduleId,
              },
            },
            {
              term: {
                status: EScheduleStatus.processing,
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<{
      id: string;
      contact: { id: string };
    }>(EElasticIndex.schedule, query);

    if (!result) {
      return [];
    }

    return result.hits.hits
      .filter((hit) => hit._source)
      .map((hit) => ({
        contact_id: hit._source!.contact.id,
        message_id: hit._source!.id,
      }));
  }

  private async checkAndFinalizeSchedule(
    tracker: IScheduleTracker
  ): Promise<void> {
    const totalProcessed =
      tracker.completedMessages.size + tracker.failedMessages.size;

    if (totalProcessed >= tracker.totalMessages) {
      await this.finalizeSchedule(tracker);
    }
  }

  private async finalizeSchedule(tracker: IScheduleTracker): Promise<void> {
    if (tracker.timeoutTimer) {
      clearTimeout(tracker.timeoutTimer);
      tracker.timeoutTimer = null;
    }

    const allFailed = tracker.failedMessages.size === tracker.totalMessages;
    const finalStatus = allFailed
      ? EScheduleStatus.failed
      : EScheduleStatus.sent;

    await this.scheduleStatusUpdaterRepository.updateScheduleStatus(
      tracker.scheduleId,
      finalStatus
    );

    this.scheduleTrackers.delete(tracker.scheduleId);
  }

  private async updateMessageStatusInElasticsearch(
    data: IScheduleStatusUpdate
  ): Promise<void> {
    await this.elasticDatabaseService.indices(
      EElasticIndex.schedule,
      scheduleMappings()
    );

    const document = {
      status: data.status,
      updated_at: new Date().toISOString(),
    };

    await this.elasticDatabaseService.update(
      EElasticIndex.schedule,
      document,
      data.message_id
    );
  }
}
