import 'reflect-metadata';

jest.mock('@core/services/serverBuild.service', () => ({
  ServerBuildService: class {},
}));
jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class {},
}));
jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class {},
}));

import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { ServerBuildGeneratorUseCase } from '@core/useCases/server/ServerBuildGenerator.useCase';

describe('ServerBuildGeneratorUseCase', () => {
  const t = ((key: string) => key) as never;

  const makeUseCase = () => {
    const serverBuildService = {
      createBuildJob: jest.fn(async (..._args: unknown[]) => ({
        conflict: false,
        server_build_job_id: 'job-1',
        version: 'v1',
      })),
      markJobItemFailed: jest.fn(async () => undefined),
      syncJobStatusFromItems: jest.fn(async () => undefined),
    };
    const streamProducerService = {
      send: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const kafkaServiceQueueService = {
      buildVersionGenerateRequest: jest.fn(
        () => 'build.version.generate.request'
      ),
    };

    const useCase = new ServerBuildGeneratorUseCase(
      serverBuildService as never,
      streamProducerService as never,
      kafkaServiceQueueService as never
    );

    return {
      useCase,
      serverBuildService,
      streamProducerService,
      kafkaServiceQueueService,
    };
  };

  it('creates and enqueues a single selected build target', async () => {
    const { useCase, serverBuildService, streamProducerService } =
      makeUseCase();

    await expect(
      useCase.execute(t, 'user-1', {
        build_types: [EServerBuildType.baileys],
      })
    ).resolves.toEqual({
      status: 'created',
      data: {
        server_build_job_id: 'job-1',
        version: 'v1',
      },
    });

    expect(serverBuildService.createBuildJob).toHaveBeenCalledWith(
      'user-1',
      [EServerBuildType.baileys],
      undefined
    );
    expect(streamProducerService.send).toHaveBeenCalledTimes(1);
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'build.version.generate.request',
      {
        server_build_job_id: 'job-1',
        build_type: EServerBuildType.baileys,
        trigger: 'initial',
      },
      'job-1:baileys'
    );
  });

  it('normalizes target order and enqueues multiple selected targets', async () => {
    const { useCase, serverBuildService, streamProducerService } =
      makeUseCase();

    await useCase.execute(t, 'user-1', {
      build_types: [EServerBuildType.balance_api, EServerBuildType.wwebjs],
    });

    expect(serverBuildService.createBuildJob).toHaveBeenCalledWith(
      'user-1',
      [EServerBuildType.wwebjs, EServerBuildType.balance_api],
      undefined
    );
    expect(streamProducerService.send).toHaveBeenCalledTimes(2);
    const sendCalls = streamProducerService.send.mock.calls;

    expect(sendCalls.map((call) => call[2])).toEqual(
      ['job-1:wwebjs', 'job-1:balance_api']
    );
  });

  it('passes all targets and existing version when completing a partial version', async () => {
    const { useCase, serverBuildService, streamProducerService } =
      makeUseCase();

    await useCase.execute(t, 'user-1', {
      version: 'v1',
      build_types: [
        EServerBuildType.baileys,
        EServerBuildType.wwebjs,
        EServerBuildType.whatsmeow,
        EServerBuildType.balance_api,
      ],
    });

    expect(serverBuildService.createBuildJob).toHaveBeenCalledWith(
      'user-1',
      [
        EServerBuildType.baileys,
        EServerBuildType.wwebjs,
        EServerBuildType.whatsmeow,
        EServerBuildType.balance_api,
      ],
      'v1'
    );
    expect(streamProducerService.send).toHaveBeenCalledTimes(4);
  });

  it('rejects duplicated targets before creating a job', async () => {
    const { useCase, serverBuildService, streamProducerService } =
      makeUseCase();

    await expect(
      useCase.execute(t, 'user-1', {
        build_types: [EServerBuildType.baileys, EServerBuildType.baileys],
      })
    ).resolves.toEqual({
      status: 'invalid',
      message: 'server_build_generate_invalid_targets',
    });

    expect(serverBuildService.createBuildJob).not.toHaveBeenCalled();
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('returns conflict when an active build already exists', async () => {
    const { useCase, serverBuildService } = makeUseCase();
    (serverBuildService.createBuildJob as jest.Mock).mockResolvedValueOnce({
      conflict: true,
    });

    await expect(
      useCase.execute(t, 'user-1', {
        build_types: [EServerBuildType.baileys],
      })
    ).resolves.toEqual({
      status: 'conflict',
    });
  });

  it('maps repository invalid reasons to generate errors', async () => {
    const { useCase, serverBuildService } = makeUseCase();
    (serverBuildService.createBuildJob as jest.Mock).mockResolvedValueOnce({
      conflict: false,
      invalid_reason: 'build_type_exists',
    });

    await expect(
      useCase.execute(t, 'user-1', {
        build_types: [EServerBuildType.baileys],
        version: 'v1',
      })
    ).resolves.toEqual({
      status: 'invalid',
      message: 'server_build_generate_target_exists',
    });
  });
});
