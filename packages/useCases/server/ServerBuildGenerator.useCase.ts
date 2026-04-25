import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { IBuildVersionGeneratePayload } from '@core/common/interfaces/IBuildVersionGeneratePayload';
import {
  TCreateServerBuildJobInvalidReason,
} from '@core/common/interfaces/ICreateServerBuildJobResult';
import { ServerBuildGenerateRequest } from '@core/schema/server/generateServerBuild/request.schema';
import { ServerBuildGenerateResponse } from '@core/schema/server/generateServerBuild/response.schema';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ServerBuildService } from '@core/services/serverBuild.service';
import { StreamProducerService } from '@core/services/streamProducer.service';

type ServerBuildGenerateInvalidMessage =
  | 'server_build_generate_invalid_targets'
  | 'server_build_generate_version_not_found'
  | 'server_build_generate_target_exists';

type ServerBuildGenerateResult =
  | {
      status: 'conflict';
    }
  | {
      status: 'invalid';
      message: ServerBuildGenerateInvalidMessage;
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

  private readonly buildTypes: EServerBuildType[] = [
    EServerBuildType.baileys,
    EServerBuildType.wwebjs,
    EServerBuildType.whatsmeow,
    EServerBuildType.balance_api,
  ];

  private getInvalidMessage(
    reason: TCreateServerBuildJobInvalidReason
  ): ServerBuildGenerateInvalidMessage {
    if (reason === 'version_not_found') {
      return 'server_build_generate_version_not_found';
    }

    if (reason === 'build_type_exists') {
      return 'server_build_generate_target_exists';
    }

    return 'server_build_generate_invalid_targets';
  }

  private normalizeBuildTypes(
    buildTypes: EServerBuildType[]
  ): EServerBuildType[] | null {
    const selectedBuildTypes = new Set(buildTypes);
    const hasInvalidBuildType = buildTypes.some(
      (buildType) => !this.buildTypes.includes(buildType)
    );

    if (
      buildTypes.length === 0 ||
      selectedBuildTypes.size !== buildTypes.length ||
      hasInvalidBuildType
    ) {
      return null;
    }

    return this.buildTypes.filter((buildType) =>
      selectedBuildTypes.has(buildType)
    );
  }

  async execute(
    t: TFunction<'translation', undefined>,
    requestedBy: string,
    input: ServerBuildGenerateRequest
  ): Promise<ServerBuildGenerateResult> {
    const buildTypes = this.normalizeBuildTypes(input.build_types);
    if (!buildTypes) {
      return {
        status: 'invalid',
        message: 'server_build_generate_invalid_targets',
      };
    }

    const version = input.version?.trim() || undefined;
    const created = await this.serverBuildService.createBuildJob(
      requestedBy,
      buildTypes,
      version
    );

    if (created.conflict) {
      return {
        status: 'conflict',
      };
    }

    if (created.invalid_reason) {
      return {
        status: 'invalid',
        message: this.getInvalidMessage(created.invalid_reason),
      };
    }

    const serverBuildJobId = created.server_build_job_id;
    const createdVersion = created.version;

    if (!serverBuildJobId || !createdVersion) {
      throw new Error(t('server_build_generate_failed'));
    }

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
        version: createdVersion,
      },
    };
  }
}
