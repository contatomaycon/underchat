import { singleton, inject } from 'tsyringe';
import { IWorkerConfigUpdateEvent } from '@core/common/interfaces/IWorkerConfigUpdateEvent';
import { WwebjsIncomingMessageService } from '@core/services/wwebjs/methods/incoming.service';
import { wwebjsEnvironment } from '@core/config/environments';
import { WorkerConfigRevisionService } from '@core/services/workerConfigRevision.service';

@singleton()
export class WorkerConfigUpdateWwebjsConsume {
  constructor(
    @inject(WwebjsIncomingMessageService)
    private readonly wwebjsIncomingMessageService: WwebjsIncomingMessageService,
    @inject(WorkerConfigRevisionService)
    private readonly workerConfigRevisionService: WorkerConfigRevisionService
  ) {}

  private parseMessage(value: Buffer | null): IWorkerConfigUpdateEvent | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IWorkerConfigUpdateEvent;
      return parsed ?? null;
    } catch {
      return null;
    }
  }

  public async handleJetStreamCommand(
    payload: unknown,
    assertActive: () => void
  ): Promise<void> {
    const data = this.parseMessage(
      Buffer.from(JSON.stringify(payload), 'utf8')
    );
    if (!data) throw new Error('worker_command_config_payload_invalid');
    await this.processWorkerConfig(data, assertActive);
  }

  private async processWorkerConfig(
    data: IWorkerConfigUpdateEvent,
    assertActive: () => void
  ): Promise<void> {
    assertActive();
    if (data.worker_id !== wwebjsEnvironment.wwebjsWorkerId) return;
    if (
      !(await this.workerConfigRevisionService.isCurrent(
        data.worker_id,
        data.revision
      ))
    ) {
      return;
    }
    assertActive();
    this.wwebjsIncomingMessageService.updateRejectCallConfig(
      data.reject_call ?? false
    );
  }
}
