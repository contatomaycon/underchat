import 'reflect-metadata';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import {
  DEFAULT_TYPING_SIMULATION_SPEED,
  TYPING_SIMULATION_CACHE_TTL_SECONDS,
  typingSimulationCacheKey,
} from '@core/common/functions/typingSimulationConfig';
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
});
