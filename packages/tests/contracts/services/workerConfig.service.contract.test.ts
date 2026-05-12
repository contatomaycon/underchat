import 'reflect-metadata';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import {
  DEFAULT_TYPING_SIMULATION_SPEED,
  TYPING_SIMULATION_CACHE_TTL_SECONDS,
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
  };
  const redis = {
    del: jest.fn(async () => 1),
    set: jest.fn(async () => 'OK'),
  };

  const service = new WorkerConfigService(
    workerConfigViewerRepository as never,
    workerConfigUpserterRepository as never,
    {} as never,
    {} as never,
    {} as never,
    redis as never
  );

  return {
    redis,
    service,
    workerConfigUpserterRepository,
    workerConfigViewerRepository,
  };
}

describe('WorkerConfigService typing simulation defaults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
