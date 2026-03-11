import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ServerBuildGenerateResponse } from '@core/schema/server/generateServerBuild/response.schema';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ServerBuildService } from '@core/services/serverBuild.service';
import { StreamProducerService } from '@core/services/streamProducer.service';

interface IServerBuildGeneratePayload {
  server_build_job_id: string;
}

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

    const payload: IServerBuildGeneratePayload = {
      server_build_job_id: serverBuildJobId,
    };

    try {
      await this.streamProducerService.send(
        this.kafkaServiceQueueService.buildVersionGenerateRequest(),
        payload,
        serverBuildJobId
      );
    } catch {
      await this.serverBuildService.markJobFailed(
        serverBuildJobId,
        t('kafka_error')
      );
      throw new Error(t('kafka_error'));
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
