import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { IBuildVersionGeneratePayload } from '@core/common/interfaces/IBuildVersionGeneratePayload';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ServerBuildService } from '@core/services/serverBuild.service';
import { StreamProducerService } from '@core/services/streamProducer.service';

@injectable()
export class ServerBuildRetryItemUseCase {
  constructor(
    @inject(ServerBuildService)
    private readonly serverBuildService: ServerBuildService,
    @inject(StreamProducerService)
    private readonly streamProducerService: StreamProducerService,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): Promise<boolean> {
    const version = await this.serverBuildService.retryFailedJobItem(
      serverBuildJobId,
      buildType
    );
    if (!version) {
      return false;
    }

    const payload: IBuildVersionGeneratePayload = {
      server_build_job_id: serverBuildJobId,
      build_type: buildType,
      trigger: 'retry',
    };

    try {
      await this.streamProducerService.send(
        this.kafkaServiceQueueService.buildVersionGenerateRequest(),
        payload,
        `${serverBuildJobId}:${buildType}`
      );
    } catch {
      await this.serverBuildService.markJobItemFailed(
        serverBuildJobId,
        buildType,
        t('kafka_error')
      );
      await this.serverBuildService.syncJobStatusFromItems(serverBuildJobId);
      throw new Error(t('kafka_error'));
    }

    return true;
  }
}
