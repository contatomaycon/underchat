import 'reflect-metadata';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import {
  DEFAULT_TYPING_SIMULATION_MAX_DELAY_MS,
  DEFAULT_TYPING_SIMULATION_SPEED,
  TYPING_SIMULATION_CACHE_TTL_SECONDS,
  resolveTypingSimulationMaxDelayMs,
  typingSimulationCacheKey,
} from '@core/common/functions/typingSimulationConfig';
import { defaultSecurityKeyConfig } from '@core/common/functions/securityKeyConfig';
import { WorkerConfigService } from '@core/services/workerConfig.service';

jest.mock('@core/repositories/worker/WorkerConfigViewer.repository', () => ({
  WorkerConfigViewerRepository: class WorkerConfigViewerRepository {},
}));

jest.mock('@core/repositories/worker/WorkerConfigUpserter.repository', () => ({
  WorkerConfigUpserterRepository: class WorkerConfigUpserterRepository {},
}));

jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class StreamProducerService {},
}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
}));

jest.mock('@core/services/passwordEncryptor.service', () => ({
  PasswordEncryptorService: class PasswordEncryptorService {},
}));

function buildService() {
  const workerConfigViewerRepository = {
    fetchConfigValueByType: jest.fn(),
  };
  const workerConfigUpserterRepository = {
    updateTypingSimulation: jest.fn(
      async () => DEFAULT_TYPING_SIMULATION_SPEED
    ),
    updateSecurityKey: jest.fn(async () => undefined),
    updateOperatorReplyPendingRedistribution: jest.fn(
      async (_workerId: string, value: string) => value
    ),
  };
  const redis = {
    del: jest.fn(async () => 1),
    set: jest.fn(async () => 'OK'),
  };
  const workerConfigRevisionService = {
    registerCurrent: jest.fn(async () => undefined),
  };

  const service = new WorkerConfigService(
    workerConfigViewerRepository as never,
    workerConfigUpserterRepository as never,
    {} as never,
    {} as never,
    workerConfigRevisionService as never,
    redis as never
  );

  return {
    redis,
    service,
    workerConfigUpserterRepository,
    workerConfigViewerRepository,
    workerConfigRevisionService,
  };
}

describe('WorkerConfigService typing simulation defaults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bounds typing simulation without requiring an environment override', () => {
    expect(resolveTypingSimulationMaxDelayMs(undefined)).toBe(
      DEFAULT_TYPING_SIMULATION_MAX_DELAY_MS
    );
    expect(resolveTypingSimulationMaxDelayMs('invalid')).toBe(
      DEFAULT_TYPING_SIMULATION_MAX_DELAY_MS
    );
    expect(resolveTypingSimulationMaxDelayMs('1')).toBe(1_000);
    expect(resolveTypingSimulationMaxDelayMs('999999')).toBe(60_000);
  });

  it('creates typing simulation active with speed 50 when a worker has no config yet', async () => {
    const {
      redis,
      service,
      workerConfigUpserterRepository,
      workerConfigViewerRepository,
    } = buildService();

    workerConfigViewerRepository.fetchConfigValueByType
      .mockResolvedValueOnce({ statusId: null, value: null })
      .mockResolvedValueOnce({
        statusId: EWorkerConfigStatus.active,
        value: String(DEFAULT_TYPING_SIMULATION_SPEED),
      });

    await expect(
      service.ensureTypingSimulationDefault('worker-1')
    ).resolves.toEqual({
      enabled: true,
      speed: DEFAULT_TYPING_SIMULATION_SPEED,
    });

    expect(
      workerConfigUpserterRepository.updateTypingSimulation
    ).toHaveBeenCalledWith(
      'worker-1',
      DEFAULT_TYPING_SIMULATION_SPEED,
      EWorkerConfigStatus.active
    );
    expect(redis.set).toHaveBeenCalledWith(
      typingSimulationCacheKey('worker-1'),
      JSON.stringify({
        enabled: true,
        speed: DEFAULT_TYPING_SIMULATION_SPEED,
      }),
      'EX',
      TYPING_SIMULATION_CACHE_TTL_SECONDS
    );
  });

  it('creates security key defaults when a worker has no config yet', async () => {
    const {
      redis,
      service,
      workerConfigUpserterRepository,
      workerConfigViewerRepository,
    } = buildService();

    workerConfigViewerRepository.fetchConfigValueByType
      .mockResolvedValueOnce({ statusId: null, value: null })
      .mockResolvedValueOnce({ statusId: null, value: null })
      .mockResolvedValueOnce({ statusId: null, value: null })
      .mockResolvedValueOnce({ statusId: null, value: null })
      .mockResolvedValueOnce({
        statusId: EWorkerConfigStatus.active,
        value: String(DEFAULT_TYPING_SIMULATION_SPEED),
      });

    await expect(service.ensureSecurityKeyDefault('worker-1')).resolves.toEqual(
      defaultSecurityKeyConfig()
    );

    expect(
      workerConfigUpserterRepository.updateSecurityKey
    ).toHaveBeenCalledWith('worker-1', defaultSecurityKeyConfig());
    expect(redis.del).toHaveBeenCalledWith('worker:worker-1:config_fields');
    expect(redis.del).toHaveBeenCalledWith('worker:worker-1:mark_as_read');
  });

  it('views security key config from active and inactive status rows', async () => {
    const { service, workerConfigViewerRepository } = buildService();

    workerConfigViewerRepository.fetchConfigValueByType
      .mockResolvedValueOnce({
        statusId: EWorkerConfigStatus.active,
        value: null,
      })
      .mockResolvedValueOnce({
        statusId: EWorkerConfigStatus.active,
        value: null,
      })
      .mockResolvedValueOnce({
        statusId: EWorkerConfigStatus.inactive,
        value: null,
      })
      .mockResolvedValueOnce({
        statusId: EWorkerConfigStatus.active,
        value: null,
      });

    await expect(service.viewSecurityKey('worker-1')).resolves.toEqual({
      enabled: true,
      chatbot: true,
      schedule: false,
      quick_message: true,
    });
  });

  it('rejects enabling security key without an active option', async () => {
    const { service } = buildService();

    await expect(
      service.updateSecurityKey('worker-1', {
        enabled: true,
        chatbot: false,
        schedule: false,
        quick_message: false,
      })
    ).rejects.toThrow('security_key_requires_active_option');
  });

  it('persists and returns the normalized operator reply sector scope', async () => {
    const {
      service,
      workerConfigUpserterRepository,
      workerConfigViewerRepository,
    } = buildService();
    workerConfigViewerRepository.fetchConfigValueByType.mockResolvedValue({
      statusId: EWorkerConfigStatus.active,
      value: String(DEFAULT_TYPING_SIMULATION_SPEED),
    });

    await expect(
      service.updateOperatorReplyPendingRedistribution('worker-1', {
        enabled: true,
        time_minutes: 12,
        sector_ids: ['sector-1', 'sector-2'],
      })
    ).resolves.toEqual({
      enabled: true,
      time_minutes: 12,
      sector_ids: ['sector-1', 'sector-2'],
    });

    expect(
      workerConfigUpserterRepository.updateOperatorReplyPendingRedistribution
    ).toHaveBeenCalledWith(
      'worker-1',
      JSON.stringify({
        time_minutes: 12,
        sector_ids: ['sector-1', 'sector-2'],
      }),
      EWorkerConfigStatus.active
    );
  });

  it('keys worker config events by worker so all providers observe one order', async () => {
    const workerConfigViewerRepository = {
      viewWorkerConfigByWorkerId: jest.fn(async () => ({
        worker_config_id: 'config-1',
        worker_id: 'worker-1',
        reject_call: true,
      })),
      fetchConfigValueByType: jest.fn(async () => ({
        statusId: EWorkerConfigStatus.active,
        value: String(DEFAULT_TYPING_SIMULATION_SPEED),
      })),
    };
    const workerConfigUpserterRepository = {
      upsertWorkerConfig: jest.fn(async () => ({
        reject_call_revision: '1777777777000000',
      })),
      viewRejectCallRevision: jest.fn(async () => '1777777777000000'),
    };
    const workerCommandAdmissionService = {
      admit: jest.fn(async () => undefined),
    };
    const redis = {
      del: jest.fn(async () => 1),
      set: jest.fn(async () => 'OK'),
    };
    const workerConfigRevisionService = {
      registerCurrent: jest.fn(async () => undefined),
    };
    const service = new WorkerConfigService(
      workerConfigViewerRepository as never,
      workerConfigUpserterRepository as never,
      workerCommandAdmissionService as never,
      {} as never,
      workerConfigRevisionService as never,
      redis as never
    );

    await service.upsertWorkerConfig(
      jest.fn((key: string) => key) as never,
      'account-1',
      'worker-1',
      { reject_call: true } as never
    );

    expect(workerCommandAdmissionService.admit).toHaveBeenCalledWith({
      accountId: 'account-1',
      workerId: 'worker-1',
      commandType: 'worker_config',
      entityKey: 'control:account-1:worker-1:config',
      operationId: '1777777777000000',
      payload: {
        worker_id: 'worker-1',
        reject_call: true,
        revision: '1777777777000000',
      },
      source: 'worker_config',
    });
    expect(workerConfigRevisionService.registerCurrent).toHaveBeenCalledWith(
      'worker-1',
      '1777777777000000'
    );
  });

  it('does not publish a revision superseded by another API pod', async () => {
    const workerConfigViewerRepository = {
      viewWorkerConfigByWorkerId: jest.fn(async () => ({
        worker_config_id: 'config-1',
        worker_id: 'worker-1',
        reject_call: false,
      })),
      fetchConfigValueByType: jest.fn(async () => ({
        statusId: EWorkerConfigStatus.active,
        value: String(DEFAULT_TYPING_SIMULATION_SPEED),
      })),
    };
    const workerConfigUpserterRepository = {
      upsertWorkerConfig: jest.fn(async () => ({
        reject_call_revision: '1777777777000000',
      })),
      viewRejectCallRevision: jest.fn(async () => '1777777777000001'),
    };
    const workerCommandAdmissionService = {
      admit: jest.fn(async () => undefined),
    };
    const workerConfigRevisionService = {
      registerCurrent: jest.fn(async () => undefined),
    };
    const service = new WorkerConfigService(
      workerConfigViewerRepository as never,
      workerConfigUpserterRepository as never,
      workerCommandAdmissionService as never,
      {} as never,
      workerConfigRevisionService as never,
      {
        del: jest.fn(async () => 1),
        set: jest.fn(async () => 'OK'),
      } as never
    );

    await service.upsertWorkerConfig(
      jest.fn((key: string) => key) as never,
      'account-1',
      'worker-1',
      { reject_call: true } as never
    );

    expect(workerConfigRevisionService.registerCurrent).not.toHaveBeenCalled();
    expect(workerCommandAdmissionService.admit).not.toHaveBeenCalled();
  });
});
