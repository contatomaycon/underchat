import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { workerConfig } from '@core/models';
import { WorkerConfigViewerRepository } from '@core/repositories/worker/WorkerConfigViewer.repository';
import { WorkerConfigUpserterRepository } from '@core/repositories/worker/WorkerConfigUpserter.repository';
import { IUpdateWorkerConfig } from '@core/common/interfaces/IUpdateWorkerConfig';
import { ViewWorkerConfigResponse } from '@core/schema/worker/viewWorkerConfig/response.schema';
import { WorkerConfig } from '@core/schema/worker/updateWorkerConfig/response.schema';
import Redis from 'ioredis';

@injectable()
export class WorkerConfigService {
  constructor(
    private readonly workerConfigViewerRepository: WorkerConfigViewerRepository,
    private readonly workerConfigUpserterRepository: WorkerConfigUpserterRepository,
    @inject('Redis') private readonly redis: Redis
  ) {}

  async viewWorkerConfig(workerId: string): Promise<ViewWorkerConfigResponse> {
    const result =
      await this.workerConfigViewerRepository.viewWorkerConfigByWorkerId(
        workerId
      );

    if (!result) {
      return null;
    }

    return this.mapToWorkerConfig(result);
  }

  async upsertWorkerConfig(
    t: TFunction<'translation', undefined>,
    workerId: string,
    input: IUpdateWorkerConfig
  ): Promise<WorkerConfig> {
    await this.workerConfigUpserterRepository.upsertWorkerConfig(
      workerId,
      input
    );

    await this.invalidateWorkerConfigCache(workerId);

    const result =
      await this.workerConfigViewerRepository.viewWorkerConfigByWorkerId(
        workerId
      );

    if (!result) {
      throw new Error(t('worker_config_not_found'));
    }

    return this.mapToWorkerConfig(result);
  }

  private mapToWorkerConfig(
    result: typeof workerConfig.$inferSelect
  ): WorkerConfig {
    return {
      worker_config_id: result.worker_config_id,
      worker_id: result.worker_id,
      is_automatic_attendance: result.is_automatic_attendance ?? false,
      show_attendee_name: result.show_attendee_name ?? false,
      show_worker_name: result.show_worker_name ?? false,
      allow_attendance_only_online:
        result.allow_attendance_only_online ?? false,
      simultaneous_attendance: result.simultaneous_attendance ?? null,
      generate_protocol_at_ura: result.generate_protocol_at_ura,
      generate_protocol_at_start: result.generate_protocol_at_start,
      generate_protocol_at_transfer: result.generate_protocol_at_transfer,
      show_message_on_call: result.show_message_on_call,
      auto_save_contacts: result.auto_save_contacts ?? false,
      chatbot_id: result.chatbot_id ?? null,
      created_at: result.created_at ?? null,
      updated_at: result.updated_at ?? null,
    };
  }

  async updateTransferProtocolText(
    workerId: string,
    text: string | null
  ): Promise<string | null> {
    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateTransferProtocolText(
        workerId,
        text
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return result;
  }

  async viewTransferProtocolText(workerId: string): Promise<string | null> {
    const result =
      await this.workerConfigViewerRepository.viewWorkerConfigByWorkerId(
        workerId
      );

    if (!result) {
      return null;
    }

    return result.generate_protocol_at_transfer || null;
  }

  async updateStartProtocolText(
    workerId: string,
    text: string | null
  ): Promise<string | null> {
    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateStartProtocolText(
        workerId,
        text
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return result;
  }

  async viewStartProtocolText(workerId: string): Promise<string | null> {
    const result =
      await this.workerConfigViewerRepository.viewWorkerConfigByWorkerId(
        workerId
      );

    if (!result) {
      return null;
    }

    return result.generate_protocol_at_start || null;
  }

  async updateUraProtocolText(
    workerId: string,
    text: string | null
  ): Promise<string | null> {
    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateUraProtocolText(workerId, text),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return result;
  }

  async viewUraProtocolText(workerId: string): Promise<string | null> {
    const result =
      await this.workerConfigViewerRepository.viewWorkerConfigByWorkerId(
        workerId
      );

    if (!result) {
      return null;
    }

    return result.generate_protocol_at_ura || null;
  }

  async updateSimultaneousAttendance(
    workerId: string,
    quantity: number | null
  ): Promise<number | null> {
    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateSimultaneousAttendance(
        workerId,
        quantity
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return result;
  }

  async viewSimultaneousAttendance(workerId: string): Promise<number | null> {
    const result =
      await this.workerConfigViewerRepository.viewWorkerConfigByWorkerId(
        workerId
      );

    if (!result) {
      return null;
    }

    return result.simultaneous_attendance || null;
  }

  async updateShowMessageOnCall(
    workerId: string,
    text: string | null
  ): Promise<string | null> {
    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateShowMessageOnCall(
        workerId,
        text
      ),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return result;
  }

  async viewShowMessageOnCall(workerId: string): Promise<string | null> {
    const result =
      await this.workerConfigViewerRepository.viewWorkerConfigByWorkerId(
        workerId
      );

    if (!result) {
      return null;
    }

    return result.show_message_on_call || null;
  }

  async updateChatbot(
    workerId: string,
    chatbotId: string | null
  ): Promise<string | null> {
    const [result] = await Promise.all([
      this.workerConfigUpserterRepository.updateChatbot(workerId, chatbotId),
      this.invalidateWorkerConfigCache(workerId),
    ]);

    return result;
  }

  async viewChatbot(workerId: string): Promise<string | null> {
    const result =
      await this.workerConfigViewerRepository.viewWorkerConfigByWorkerId(
        workerId
      );

    if (!result) {
      return null;
    }

    return result.chatbot_id || null;
  }

  private async invalidateWorkerConfigCache(workerId: string): Promise<void> {
    await this.redis.del(`worker:${workerId}:config_fields`);
  }
}
