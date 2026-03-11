import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ServerBuildService } from '@core/services/serverBuild.service';
import { StreamProducerService } from '@core/services/streamProducer.service';

interface IServerBuildCancelPayload {
  server_build_job_id: string;
}

@injectable()
export class ServerBuildCancellerUseCase {
  constructor(
    @inject(ServerBuildService)
    private readonly serverBuildService: ServerBuildService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  async execute(t: TFunction<'translation', undefined>): Promise<boolean> {
    const cancel = await this.serverBuildService.requestCancelForActiveJob();

    if (!cancel) {
      return false;
    }

    const payload: IServerBuildCancelPayload = {
      server_build_job_id: cancel.server_build_job_id,
    };

    try {
      await this.streamProducerService.send(
        this.kafkaServiceQueueService.buildVersionCancelRequest(),
        payload,
        cancel.server_build_job_id
      );
    } catch {
      await this.serverBuildService.rollbackCancelRequest(
        cancel.server_build_job_id,
        cancel.previous_status
      );

      throw new Error(t('kafka_error'));
    }

    return true;
  }
}
