import 'reflect-metadata';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { NODE_WORKER_CONTAINER_STOP_TIMEOUT_SECONDS } from '@core/common/functions/nodeWorkerGracefulShutdown';
import {
  type WorkerContainerInspection,
  WorkerService,
} from '@core/services/worker.service';

const TEST_IMAGE_CONTENT_ID = `sha256:${'a'.repeat(64)}`;

interface WorkerServiceHarness {
  createWarmContainerWorker: WorkerService['createWarmContainerWorker'];
  inspectImageContentId: WorkerService['inspectImageContentId'];
  inspectContainerWorkerByIdStrict: jest.Mock<
    Promise<WorkerContainerInspection>,
    [string]
  >;
  checkVolumeNameAndCreate: jest.Mock<Promise<void>, [string, boolean]>;
  removeContainerWorkerById: jest.Mock<Promise<boolean>, [string]>;
}

function buildHarness(
  inspection: (workerId: string) => Promise<WorkerContainerInspection>
): {
  service: WorkerServiceHarness;
  createContainer: jest.Mock;
  getImage: jest.Mock;
} {
  const service = Object.create(
    WorkerService.prototype
  ) as WorkerServiceHarness;
  const createContainer = jest.fn();
  const getImage = jest.fn(() => ({
    inspect: jest.fn(async () => ({ Id: TEST_IMAGE_CONTENT_ID })),
  }));

  service.inspectContainerWorkerByIdStrict = jest.fn<
    Promise<WorkerContainerInspection>,
    [string]
  >(inspection);
  service.checkVolumeNameAndCreate = jest.fn<Promise<void>, [string, boolean]>(
    async () => undefined
  );
  service.removeContainerWorkerById = jest.fn<Promise<boolean>, [string]>(
    async () => true
  );
  Object.defineProperty(service, 'docker', {
    configurable: true,
    value: {
      createContainer,
      getImage,
      info: jest.fn(async () => ({ MemTotal: 32 * 1024 * 1024 * 1024 })),
      listContainers: jest.fn(async () => []),
    },
  });

  return { service, createContainer, getImage };
}

const createInput = {
  imageName: EWorkerImage.baileys,
  imageContentId: TEST_IMAGE_CONTENT_ID,
  warmPoolId: 'warm-pool-1',
  serverId: 'server-1',
  workerTypeId: 'worker-type-1',
  runtimeCapability: 'c'.repeat(48),
  writerEpoch: '018f0000-0000-7000-8000-000000000001',
};

const DATABASE_ENVIRONMENT_KEYS = [
  'UNDERCHAT_ENV_SCOPE',
  'DB_PUBLIC_HOST_RW',
  'DB_PUBLIC_PORT_RW',
  'DB_HOST_RW',
  'DB_PORT_RW',
  'DB_USER',
  'DB_PASSWORD',
  'WORKER_DB_USER',
  'WORKER_DB_PASSWORD',
  'DB_DATABASE',
  'DB_SSLMODE',
  'DB_PUBLIC_DATABASE_URL',
  'DB_DATABASE_URL',
] as const;

function restoreEnvironmentValue(
  key: (typeof DATABASE_ENVIRONMENT_KEYS)[number],
  value: string | undefined
): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

describe('WorkerService warm container creation boundary', () => {
  const originalDatabaseEnvironment = new Map(
    DATABASE_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]] as const)
  );

  beforeAll(() => {
    process.env.UNDERCHAT_ENV_SCOPE = 'public';
    process.env.DB_PUBLIC_HOST_RW = 'public-worker-db.invalid';
    process.env.DB_PUBLIC_PORT_RW = '15432';
    process.env.DB_HOST_RW = 'legacy-worker-db.invalid';
    process.env.DB_PORT_RW = '5432';
    process.env.DB_USER = 'control-plane-user';
    process.env.DB_PASSWORD = 'control-plane-password';
    process.env.WORKER_DB_USER = 'worker-user';
    process.env.WORKER_DB_PASSWORD = 'worker-password';
    process.env.DB_DATABASE = 'underchat';
    process.env.DB_SSLMODE = 'false';
  });

  afterAll(() => {
    for (const [key, value] of originalDatabaseEnvironment) {
      restoreEnvironmentValue(key, value);
    }
  });

  it('resolves the immutable Docker image content ID behind a mutable tag', async () => {
    const { service, getImage } = buildHarness(async () => ({
      exists: false,
    }));
    const imageId = `sha256:${'a'.repeat(64)}`;
    getImage.mockReturnValue({
      inspect: jest.fn(async () => ({ Id: imageId })),
    });

    await expect(
      service.inspectImageContentId(EWorkerImage.baileys)
    ).resolves.toBe(imageId);
    expect(getImage).toHaveBeenCalledWith(EWorkerImage.baileys);
  });

  it('fails closed when Docker cannot provide a canonical image content ID', async () => {
    const { service, getImage } = buildHarness(async () => ({
      exists: false,
    }));
    getImage.mockReturnValue({
      inspect: jest.fn(async () => ({ Id: 'under-worker-baileys:latest' })),
    });

    await expect(
      service.inspectImageContentId(EWorkerImage.baileys)
    ).rejects.toThrow('worker_image_content_id_invalid');
  });

  it.each([
    [EWorkerImage.baileys, 1_536, 1_500, 512],
    [EWorkerImage.wwebjs, 3_072, 2_000, 512],
    [EWorkerImage.whatsmeow, 1_024, 1_000, 512],
  ])(
    'creates reusable PostgreSQL %s warms with the active resource boundary',
    async (imageName, memoryMb, cpuMillis, pidsLimit) => {
      const { service, createContainer } = buildHarness(async () => ({
        exists: false,
      }));
      const start = jest.fn(async () => undefined);
      const memoryBytes = memoryMb * 1024 * 1024;
      createContainer.mockResolvedValue({
        id: 'new-container',
        start,
      });

      await service.createWarmContainerWorker({
        ...createInput,
        imageName,
      });

      expect(createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Image: createInput.imageContentId,
          StopTimeout: NODE_WORKER_CONTAINER_STOP_TIMEOUT_SECONDS,
          HostConfig: expect.objectContaining({
            Init: false,
            Memory: memoryBytes,
            MemoryReservation: Math.max(128 * 1024 * 1024, memoryBytes / 2),
            MemorySwap: memoryBytes,
            NanoCpus: cpuMillis * 1_000_000,
            OomKillDisable: false,
            OomScoreAdj: 250,
            PidsLimit: pidsLimit,
          }),
          Labels: expect.objectContaining({
            'underchat.worker_image_content_id': createInput.imageContentId,
            'underchat.resource_policy': 'v2',
            'underchat.resource_profile': 'active',
            'underchat.resource_memory_bytes': String(memoryBytes),
            'underchat.resource_memory_reservation_bytes': String(
              Math.max(128 * 1024 * 1024, memoryBytes / 2)
            ),
            'underchat.resource_memory_swap_bytes': String(memoryBytes),
            'underchat.resource_nano_cpus': String(cpuMillis * 1_000_000),
            'underchat.resource_oom_kill_disable': 'false',
            'underchat.resource_oom_score_adj': '250',
            'underchat.resource_pids_limit': String(pidsLimit),
          }),
        })
      );
      expect(start).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps the smaller bootstrap boundary and operational DSN for a legacy-volume warm', async () => {
    const { service, createContainer } = buildHarness(async () => ({
      exists: false,
    }));
    const start = jest.fn(async () => undefined);
    createContainer.mockResolvedValue({ id: 'new-container', start });

    await service.createWarmContainerWorker({
      ...createInput,
      workerTypeId: EWorkerType.baileys,
      sessionStorage: EWorkerSessionStorage.legacy_volume,
    });

    expect(createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          Memory: 256 * 1024 * 1024,
          NanoCpus: 250 * 1_000_000,
          OomScoreAdj: 750,
          PidsLimit: 128,
        }),
        Labels: expect.objectContaining({
          'underchat.resource_profile': 'warm',
        }),
      })
    );
    const env = (createContainer.mock.calls[0]?.[0] as { Env?: string[] }).Env;
    expect(env).toContain(
      'WORKER_DATABASE_URL=postgresql://worker-user:worker-password@public-worker-db.invalid:15432/underchat?sslmode=disable'
    );
  });

  it('fails closed without deleting an existing warm container', async () => {
    const { service, createContainer } = buildHarness(async () => ({
      exists: true,
      container_id: 'existing-container',
      container_name: 'warm-warm-pool-1',
      running: true,
    }));

    await expect(
      service.createWarmContainerWorker(createInput)
    ).rejects.toThrow('warm_container_already_exists');

    expect(service.inspectContainerWorkerByIdStrict).toHaveBeenCalledWith(
      'warm-warm-pool-1'
    );
    expect(service.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(service.checkVolumeNameAndCreate).not.toHaveBeenCalled();
    expect(createContainer).not.toHaveBeenCalled();
  });

  it('rejects an invalid immutable image ID before any Docker or volume mutation', async () => {
    const { service, createContainer } = buildHarness(async () => ({
      exists: false,
    }));

    await expect(
      service.createWarmContainerWorker({
        ...createInput,
        imageContentId: 'under-worker-baileys:latest',
      })
    ).rejects.toThrow('imageContentId must be a canonical Docker image ID');

    expect(service.inspectContainerWorkerByIdStrict).not.toHaveBeenCalled();
    expect(service.checkVolumeNameAndCreate).not.toHaveBeenCalled();
    expect(createContainer).not.toHaveBeenCalled();
  });

  it('injects a DSN composed from the preferred public discrete endpoint', async () => {
    const { service, createContainer } = buildHarness(async () => ({
      exists: false,
    }));
    const start = jest.fn(async () => undefined);
    createContainer.mockResolvedValue({
      id: 'new-container',
      start,
    });

    await service.createWarmContainerWorker({
      ...createInput,
      workerTypeId: EWorkerType.baileys,
    });

    const env = (createContainer.mock.calls[0]?.[0] as { Env?: string[] }).Env;
    expect(env).toContain(
      'WORKER_DATABASE_URL=postgresql://worker-user:worker-password@public-worker-db.invalid:15432/underchat?sslmode=disable'
    );
    expect(env).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('legacy-worker-db.invalid'),
      ])
    );
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('injects the shared PostgreSQL DSN into a Whatsmeow warm', async () => {
    const { service, createContainer } = buildHarness(async () => ({
      exists: false,
    }));
    const start = jest.fn(async () => undefined);
    createContainer.mockResolvedValue({ id: 'new-container', start });

    await service.createWarmContainerWorker({
      ...createInput,
      imageName: EWorkerImage.whatsmeow,
      workerTypeId: EWorkerType.whatsmeow,
    });

    const env = (createContainer.mock.calls[0]?.[0] as { Env?: string[] }).Env;
    expect(env).toContain(
      'WORKER_DATABASE_URL=postgresql://worker-user:worker-password@public-worker-db.invalid:15432/underchat?sslmode=disable'
    );
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('uses the canonical discrete legacy endpoint fallback when scoped host keys are absent', async () => {
    const { service, createContainer } = buildHarness(async () => ({
      exists: false,
    }));
    const publicHost = process.env.DB_PUBLIC_HOST_RW;
    const publicPort = process.env.DB_PUBLIC_PORT_RW;
    const start = jest.fn(async () => undefined);
    createContainer.mockResolvedValue({ id: 'new-container', start });
    delete process.env.DB_PUBLIC_HOST_RW;
    delete process.env.DB_PUBLIC_PORT_RW;

    try {
      await service.createWarmContainerWorker({
        ...createInput,
        workerTypeId: EWorkerType.baileys,
      });

      const env = (createContainer.mock.calls[0]?.[0] as { Env?: string[] })
        .Env;
      expect(env).toContain(
        'WORKER_DATABASE_URL=postgresql://worker-user:worker-password@legacy-worker-db.invalid:5432/underchat?sslmode=disable'
      );
      expect(start).toHaveBeenCalledTimes(1);
    } finally {
      restoreEnvironmentValue('DB_PUBLIC_HOST_RW', publicHost);
      restoreEnvironmentValue('DB_PUBLIC_PORT_RW', publicPort);
    }
  });

  it('ignores composite URLs and fails before Docker mutation when the discrete endpoint is missing', async () => {
    const { service, createContainer } = buildHarness(async () => ({
      exists: false,
    }));
    const previous = new Map(
      [
        'DB_PUBLIC_HOST_RW',
        'DB_HOST_RW',
        'DB_PUBLIC_DATABASE_URL',
        'DB_DATABASE_URL',
      ].map((key) => [key, process.env[key]] as const)
    );
    delete process.env.DB_PUBLIC_HOST_RW;
    delete process.env.DB_HOST_RW;
    process.env.DB_PUBLIC_DATABASE_URL =
      'postgresql://must-not-be-used.invalid/underchat';
    process.env.DB_DATABASE_URL =
      'postgresql://legacy-must-not-be-used.invalid/underchat';

    try {
      await expect(
        service.createWarmContainerWorker({
          ...createInput,
          workerTypeId: EWorkerType.baileys,
        })
      ).rejects.toThrow('postgres_worker_database_url_missing');
      expect(service.inspectContainerWorkerByIdStrict).not.toHaveBeenCalled();
      expect(service.checkVolumeNameAndCreate).not.toHaveBeenCalled();
      expect(createContainer).not.toHaveBeenCalled();
    } finally {
      for (const [key, value] of previous) {
        restoreEnvironmentValue(
          key as (typeof DATABASE_ENVIRONMENT_KEYS)[number],
          value
        );
      }
    }
  });

  it('fails before Docker mutation when the dedicated worker credential is absent', async () => {
    const { service, createContainer } = buildHarness(async () => ({
      exists: false,
    }));
    const previousUser = process.env.WORKER_DB_USER;
    const previousPassword = process.env.WORKER_DB_PASSWORD;
    delete process.env.WORKER_DB_USER;
    delete process.env.WORKER_DB_PASSWORD;

    try {
      await expect(
        service.createWarmContainerWorker({
          ...createInput,
          workerTypeId: EWorkerType.baileys,
        })
      ).rejects.toThrow('postgres_worker_database_url_missing');
      expect(service.inspectContainerWorkerByIdStrict).not.toHaveBeenCalled();
      expect(service.checkVolumeNameAndCreate).not.toHaveBeenCalled();
      expect(createContainer).not.toHaveBeenCalled();
    } finally {
      restoreEnvironmentValue('WORKER_DB_USER', previousUser);
      restoreEnvironmentValue('WORKER_DB_PASSWORD', previousPassword);
    }
  });

  it('does not create, delete or touch the volume when Docker inspection is uncertain', async () => {
    const { service, createContainer } = buildHarness(async () => {
      throw new Error('docker daemon unavailable');
    });

    await expect(
      service.createWarmContainerWorker(createInput)
    ).rejects.toThrow('docker daemon unavailable');

    expect(service.removeContainerWorkerById).not.toHaveBeenCalled();
    expect(service.checkVolumeNameAndCreate).not.toHaveBeenCalled();
    expect(createContainer).not.toHaveBeenCalled();
  });
});
