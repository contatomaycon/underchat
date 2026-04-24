import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { IBuildVersionGeneratePayload } from '@core/common/interfaces/IBuildVersionGeneratePayload';
import { ServerBuildGenerateResponse } from '@core/schema/server/generateServerBuild/response.schema';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ServerBuildService } from '@core/services/serverBuild.service';
import { StreamProducerService } from '@core/services/streamProducer.service';

type ServerBuildGenerateResult =
  | {
      status: 'conflict';
    }
  | {
      status: 'created';
      data: ServerBuildGenerateResponse;
    };

@injectable()
export class ServerBuildGeneratorUseCase {
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
    requestedBy: string
  ): Promise<ServerBuildGenerateResult> {
    const created = await this.serverBuildService.createBuildJob(requestedBy);

    if (created.conflict) {
      return {
        status: 'conflict',
      };
    }

    const serverBuildJobId = created.server_build_job_id;
    const version = created.version;

    if (!serverBuildJobId || !version) {
      throw new Error(t('server_build_generate_failed'));
    }

    const buildTypes: EServerBuildType[] = [
      EServerBuildType.baileys,
      EServerBuildType.wwebjs,
      EServerBuildType.whatsmeow,
      EServerBuildType.balance_api,
    ];

    const enqueueResults = await Promise.allSettled(
      buildTypes.map((buildType) => {
        const payload: IBuildVersionGeneratePayload = {
          server_build_job_id: serverBuildJobId,
          build_type: buildType,
          trigger: 'initial',
        };

        return this.streamProducerService.send(
          this.kafkaServiceQueueService.buildVersionGenerateRequest(),
          payload,
          `${serverBuildJobId}:${buildType}`
        );
      })
    );

    const failedBuildTypes = enqueueResults
      .map((result, index) => ({ result, buildType: buildTypes[index] }))
      .filter((entry) => entry.result.status === 'rejected')
      .map((entry) => entry.buildType);

    if (failedBuildTypes.length > 0) {
      await Promise.all(
        failedBuildTypes.map((failedBuildType) =>
          this.serverBuildService.markJobItemFailed(
            serverBuildJobId,
            failedBuildType,
            t('kafka_error')
          )
        )
      );
      await this.serverBuildService.syncJobStatusFromItems(serverBuildJobId);

      if (failedBuildTypes.length === buildTypes.length) {
        throw new Error(t('kafka_error'));
      }
    }

    return {
      status: 'created',
      data: {
        server_build_job_id: serverBuildJobId,
        version,
      },
    };
  }
}
