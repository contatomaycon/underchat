import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import {
  WorkerContainerAdmissionController,
  WorkerContainerAdmissionError,
} from '@core/common/functions/workerContainerAdmission';
import {
  type IWorkerContainerResourcePolicy,
  resolveWorkerContainerResourcePolicy,
  type WorkerContainerResourceProfile,
} from '@core/common/functions/workerContainerResourcePolicy';

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;
const IMAGE_ID = `sha256:${'a'.repeat(64)}`;
const ENV_NAMES = [
  'WORKER_CONTAINER_RESOURCE_LIMITS_ENABLED',
  'WORKER_CONTAINER_BAILEYS_MEMORY_MB',
  'WORKER_CONTAINER_BAILEYS_CPU_MILLIS',
  'WORKER_CONTAINER_WWEBJS_MEMORY_MB',
  'WORKER_CONTAINER_WWEBJS_CPU_MILLIS',
  'WORKER_CONTAINER_WHATSMEOW_MEMORY_MB',
  'WORKER_CONTAINER_WHATSMEOW_CPU_MILLIS',
  'WORKER_CONTAINER_PIDS_LIMIT',
  'WORKER_CONTAINER_WARM_BAILEYS_MEMORY_MB',
  'WORKER_CONTAINER_WARM_BAILEYS_CPU_MILLIS',
  'WORKER_CONTAINER_WARM_BAILEYS_PIDS_LIMIT',
  'WORKER_CONTAINER_WARM_WWEBJS_MEMORY_MB',
  'WORKER_CONTAINER_WARM_WWEBJS_CPU_MILLIS',
  'WORKER_CONTAINER_WARM_WWEBJS_PIDS_LIMIT',
  'WORKER_CONTAINER_WARM_WHATSMEOW_MEMORY_MB',
  'WORKER_CONTAINER_WARM_WHATSMEOW_CPU_MILLIS',
  'WORKER_CONTAINER_WARM_WHATSMEOW_PIDS_LIMIT',
  'WORKER_CONTAINER_ADMISSION_ENABLED',
  'WORKER_CONTAINER_HOST_RESERVED_MEMORY_MB',
  'WORKER_CONTAINER_HOST_RESERVED_MEMORY_PERCENT',
  'WORKER_CONTAINER_ADMISSION_RESERVATION_OVERCOMMIT_PERCENT',
  'WORKER_CONTAINER_ADMISSION_HARD_LIMIT_OVERCOMMIT_PERCENT',
  'WORKER_CONTAINER_ADMISSION_INVENTORY_LIMIT',
  'WORKER_CONTAINER_ADMISSION_INSPECT_CONCURRENCY',
  'WORKER_CONTAINER_ADMISSION_INSPECT_TIMEOUT_MS',
] as const;

interface FakeContainer {
  readonly id: string;
  readonly image: EWorkerImage;
  readonly imageId: string;
  readonly labels: Record<string, string>;
  readonly name: string;
  readonly state?: string;
  readonly hostConfig: Record<string, unknown>;
}

class FakeDocker {
  readonly containers = new Map<string, FakeContainer>();
  infoCalls = 0;
  infoError: Error | null = null;

  constructor(readonly totalMemoryBytes: number) {}

  add(container: FakeContainer): void {
    this.containers.set(container.id, container);
  }

  async info(): Promise<{ MemTotal: number }> {
    this.infoCalls += 1;
    if (this.infoError) {
      throw this.infoError;
    }
    return { MemTotal: this.totalMemoryBytes };
  }

  async listContainers(): Promise<
    Array<{
      Id: string;
      Image: string;
      Labels: Record<string, string>;
      Names: string[];
      State: string;
    }>
  > {
    return [...this.containers.values()].map((container) => ({
      Id: container.id,
      Image: container.image,
      Labels: container.labels,
      Names: [`/${container.name}`],
      State: container.state ?? 'running',
    }));
  }

  getContainer(reference: string): {
    inspect: () => Promise<unknown>;
  } {
    return {
      inspect: async () => {
        const container = this.containers.get(reference);
        if (!container) {
          throw Object.assign(new Error('No such container'), {
            statusCode: 404,
          });
        }
        const state = container.state ?? 'running';
        return {
          Id: container.id,
          Image: container.imageId,
          Name: `/${container.name}`,
          Config: {
            Image: container.imageId,
            Labels: container.labels,
          },
          HostConfig: container.hostConfig,
          State: {
            Paused: state === 'paused',
            Restarting: state === 'restarting',
            Running: state === 'running',
            Status: state,
          },
        };
      },
    };
  }
}

function requiredPolicy(
  image: EWorkerImage,
  profile: WorkerContainerResourceProfile
): IWorkerContainerResourcePolicy {
  const policy = resolveWorkerContainerResourcePolicy(image, profile);
  if (!policy) {
    throw new Error('resource policy unexpectedly disabled');
  }
  return policy;
}

function managedContainer(input: {
  idSeed: string;
  image: EWorkerImage;
  name: string;
  profile: WorkerContainerResourceProfile;
}): FakeContainer {
  const policy = requiredPolicy(input.image, input.profile);
  return {
    id: input.idSeed.padStart(64, '0').slice(-64),
    image: input.image,
    imageId: IMAGE_ID,
    labels: {
      'underchat.worker_image': input.image,
      'underchat.worker_image_content_id': IMAGE_ID,
      ...(input.profile === 'warm'
        ? {
            'underchat.warm_pool_id': '019fa877-2825-741a-a3b2-2b48fdd47ac0',
            'underchat.warm_standby': 'true',
          }
        : {
            'underchat.worker_id': '019fa877-9f95-7518-9753-3f4e32569dee',
            'underchat.warm_standby': 'false',
          }),
      ...policy.labels,
    },
    name: input.name,
    hostConfig: { ...policy.hostConfig },
  };
}

describe('worker container physical admission contract', () => {
  const originalEnvironment = new Map(
    ENV_NAMES.map((name) => [name, process.env[name]] as const)
  );

  beforeEach(() => {
    for (const name of ENV_NAMES) {
      delete process.env[name];
    }
    process.env.WORKER_CONTAINER_ADMISSION_ENABLED = 'true';
  });

  afterAll(() => {
    for (const [name, value] of originalEnvironment) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('reports the default-disabled policy before the first admission attempt', () => {
    delete process.env.WORKER_CONTAINER_ADMISSION_ENABLED;

    const controller = new WorkerContainerAdmissionController();

    expect(controller.getStatus()).toEqual(
      expect.objectContaining({
        enabled: false,
        last_attempt_at: null,
        last_outcome: 'disabled',
        last_reason: 'disabled_by_default',
      })
    );
  });

  it('bypasses Docker inventory when admission is not explicitly enabled', async () => {
    delete process.env.WORKER_CONTAINER_ADMISSION_ENABLED;
    expect(ENV_NAMES.every((name) => process.env[name] === undefined)).toBe(
      true
    );
    const docker = new FakeDocker(4 * GIBIBYTE);
    const controller = new WorkerContainerAdmissionController(
      async () => 3 * GIBIBYTE
    );
    const operation = jest.fn(async () => undefined);

    await expect(
      controller.run(
        docker,
        {
          image: EWorkerImage.baileys,
          profile: 'warm',
          policy: requiredPolicy(EWorkerImage.baileys, 'warm'),
        },
        operation
      )
    ).resolves.toBeUndefined();

    expect(operation).toHaveBeenCalledTimes(1);
    expect(docker.infoCalls).toBe(0);
    expect(controller.getStatus()).toEqual(
      expect.objectContaining({
        enabled: false,
        last_outcome: 'disabled',
        last_reason: 'disabled_by_default',
      })
    );
  });

  it('reports an explicit false admission setting without consulting Docker', async () => {
    process.env.WORKER_CONTAINER_ADMISSION_ENABLED = 'false';
    const docker = new FakeDocker(4 * GIBIBYTE);
    const controller = new WorkerContainerAdmissionController(
      async () => 3 * GIBIBYTE
    );
    const operation = jest.fn(async () => 'created');

    await expect(
      controller.run(
        docker,
        {
          image: EWorkerImage.baileys,
          profile: 'warm',
          policy: requiredPolicy(EWorkerImage.baileys, 'warm'),
        },
        operation
      )
    ).resolves.toBe('created');

    expect(operation).toHaveBeenCalledTimes(1);
    expect(docker.infoCalls).toBe(0);
    expect(controller.getStatus()).toEqual(
      expect.objectContaining({
        enabled: false,
        last_outcome: 'disabled',
        last_reason: 'explicitly_disabled',
      })
    );
  });

  it('admits warm 4/2/2 and one active runtime per provider on the 4 GiB test host', async () => {
    const hostTotalBytes = 4_106_108_928;
    const docker = new FakeDocker(hostTotalBytes);
    const controller = new WorkerContainerAdmissionController(
      async () => 2_500 * MEBIBYTE
    );
    const topology: Array<{
      count: number;
      image: EWorkerImage;
      profile: WorkerContainerResourceProfile;
    }> = [
      { count: 4, image: EWorkerImage.baileys, profile: 'warm' },
      { count: 2, image: EWorkerImage.wwebjs, profile: 'warm' },
      { count: 2, image: EWorkerImage.whatsmeow, profile: 'warm' },
      { count: 1, image: EWorkerImage.baileys, profile: 'active' },
      { count: 1, image: EWorkerImage.wwebjs, profile: 'active' },
      { count: 1, image: EWorkerImage.whatsmeow, profile: 'active' },
    ];
    let sequence = 0;

    for (const target of topology) {
      for (let index = 0; index < target.count; index += 1) {
        sequence += 1;
        const seed = sequence.toString(16);
        const policy = requiredPolicy(target.image, target.profile);
        await controller.run(
          docker,
          {
            image: target.image,
            profile: target.profile,
            policy,
          },
          async () => {
            docker.add(
              managedContainer({
                idSeed: seed,
                image: target.image,
                name: `${target.profile}-${sequence}`,
                profile: target.profile,
              })
            );
          }
        );
      }
    }

    expect(controller.getStatus()).toEqual(
      expect.objectContaining({
        last_outcome: 'succeeded',
        managed_container_count: 10,
        projected_hard_limit_bytes: 7_808 * MEBIBYTE,
        projected_reservation_bytes: 3_968 * MEBIBYTE,
        requested_image: EWorkerImage.whatsmeow,
        requested_profile: 'active',
      })
    );
  });

  it('serializes concurrent claims so two requests cannot spend the same headroom', async () => {
    process.env.WORKER_CONTAINER_HOST_RESERVED_MEMORY_MB = '256';
    process.env.WORKER_CONTAINER_HOST_RESERVED_MEMORY_PERCENT = '5';
    process.env.WORKER_CONTAINER_ADMISSION_RESERVATION_OVERCOMMIT_PERCENT =
      '100';
    process.env.WORKER_CONTAINER_ADMISSION_HARD_LIMIT_OVERCOMMIT_PERCENT =
      '100';
    const docker = new FakeDocker(700 * MEBIBYTE);
    const controller = new WorkerContainerAdmissionController(
      async () => 600 * MEBIBYTE
    );
    const policy = requiredPolicy(EWorkerImage.baileys, 'warm');
    let releaseFirst: (() => void) | undefined;
    let notifyFirstEntered: (() => void) | undefined;
    const firstEntered = new Promise<void>((resolve) => {
      notifyFirstEntered = resolve;
    });
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = controller.run(
      docker,
      { image: EWorkerImage.baileys, profile: 'warm', policy },
      async () => {
        docker.add(
          managedContainer({
            idSeed: 'a',
            image: EWorkerImage.baileys,
            name: 'warm-first',
            profile: 'warm',
          })
        );
        notifyFirstEntered?.();
        await holdFirst;
      }
    );
    await firstEntered;
    const secondOperation = jest.fn(async () => undefined);
    const second = controller.run(
      docker,
      { image: EWorkerImage.baileys, profile: 'warm', policy },
      secondOperation
    );
    await Promise.resolve();
    expect(docker.infoCalls).toBe(1);
    expect(controller.getStatus()).toEqual(
      expect.objectContaining({
        evaluating: true,
        queued_claims: 1,
      })
    );

    releaseFirst?.();
    await first;
    await expect(second).rejects.toThrow(
      'worker_container_admission_capacity_hard_limit_exhausted'
    );
    expect(secondOperation).not.toHaveBeenCalled();
    expect(docker.infoCalls).toBe(2);
  });

  it('fails closed when Docker inventory is unavailable', async () => {
    const docker = new FakeDocker(4 * GIBIBYTE);
    docker.infoError = new Error('sensitive daemon failure');
    const controller = new WorkerContainerAdmissionController(
      async () => 2 * GIBIBYTE
    );
    const operation = jest.fn(async () => undefined);

    await expect(
      controller.run(
        docker,
        {
          image: EWorkerImage.baileys,
          profile: 'warm',
          policy: requiredPolicy(EWorkerImage.baileys, 'warm'),
        },
        operation
      )
    ).rejects.toThrow('worker_container_admission_inventory_unavailable');
    expect(operation).not.toHaveBeenCalled();
    expect(controller.getStatus()).toEqual(
      expect.objectContaining({
        last_outcome: 'rejected',
        last_reason: 'inventory_unavailable',
      })
    );
  });

  it('charges a conservative provider weight for a running legacy container without labels', async () => {
    const docker = new FakeDocker(8 * GIBIBYTE);
    docker.add({
      id: 'b'.repeat(64),
      image: EWorkerImage.baileys,
      imageId: IMAGE_ID,
      labels: {},
      name: 'legacy-baileys',
      hostConfig: {
        Memory: 0,
        MemoryReservation: 0,
        MemorySwap: 0,
        NanoCpus: 0,
        OomKillDisable: false,
        OomScoreAdj: 0,
        PidsLimit: 0,
      },
    });
    const controller = new WorkerContainerAdmissionController(
      async () => 5 * GIBIBYTE
    );
    const operation = jest.fn(async () => undefined);

    await controller.run(
      docker,
      {
        image: EWorkerImage.whatsmeow,
        profile: 'warm',
        policy: requiredPolicy(EWorkerImage.whatsmeow, 'warm'),
      },
      operation
    );

    expect(operation).toHaveBeenCalledTimes(1);
    expect(controller.getStatus()).toEqual(
      expect.objectContaining({
        existing_hard_limit_bytes: 1_536 * MEBIBYTE,
        existing_reservation_bytes: 768 * MEBIBYTE,
        legacy_container_count: 1,
      })
    );
  });

  it('rejects authoritative resource-label drift before the operation', async () => {
    const docker = new FakeDocker(8 * GIBIBYTE);
    const drifted = managedContainer({
      idSeed: 'c',
      image: EWorkerImage.wwebjs,
      name: 'wweb-drifted',
      profile: 'active',
    });
    docker.add({
      ...drifted,
      labels: {
        ...drifted.labels,
        'underchat.resource_memory_bytes': String(2 * GIBIBYTE),
      },
    });
    const controller = new WorkerContainerAdmissionController(
      async () => 5 * GIBIBYTE
    );
    const operation = jest.fn(async () => undefined);

    await expect(
      controller.run(
        docker,
        {
          image: EWorkerImage.baileys,
          profile: 'warm',
          policy: requiredPolicy(EWorkerImage.baileys, 'warm'),
        },
        operation
      )
    ).rejects.toThrow('worker_container_admission_resource_label_drift');
    expect(operation).not.toHaveBeenCalled();
  });

  it('credits only the exact replacement so low MemAvailable cannot block its recovery', async () => {
    const hostTotalBytes = 4_106_108_928;
    const docker = new FakeDocker(hostTotalBytes);
    const existing = managedContainer({
      idSeed: 'd',
      image: EWorkerImage.wwebjs,
      name: 'worker-exact',
      profile: 'active',
    });
    docker.add(existing);
    const reservedBytes = Math.ceil((hostTotalBytes * 15) / 100);
    const controller = new WorkerContainerAdmissionController(
      async () => reservedBytes + 1
    );
    const operation = jest.fn(async () => {
      docker.containers.delete(existing.id);
    });

    await controller.run(
      docker,
      {
        image: EWorkerImage.wwebjs,
        profile: 'active',
        policy: requiredPolicy(EWorkerImage.wwebjs, 'active'),
        replacingContainerName: 'worker-exact',
      },
      operation
    );

    expect(operation).toHaveBeenCalledTimes(1);
    expect(controller.getStatus()).toEqual(
      expect.objectContaining({
        last_outcome: 'succeeded',
        replacement_credit_count: 1,
      })
    );
  });

  it('releases the serialized claim after a container operation fails', async () => {
    const docker = new FakeDocker(4 * GIBIBYTE);
    const controller = new WorkerContainerAdmissionController(
      async () => 3 * GIBIBYTE
    );
    const policy = requiredPolicy(EWorkerImage.baileys, 'warm');
    let releaseFailure: (() => void) | undefined;
    let notifyFailureEntered: (() => void) | undefined;
    const failureEntered = new Promise<void>((resolve) => {
      notifyFailureEntered = resolve;
    });
    const holdFailure = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    const first = controller.run(
      docker,
      { image: EWorkerImage.baileys, profile: 'warm', policy },
      async () => {
        notifyFailureEntered?.();
        await holdFailure;
        throw new Error('create failed');
      }
    );
    await failureEntered;
    const secondOperation = jest.fn(async () => undefined);
    const second = controller.run(
      docker,
      { image: EWorkerImage.baileys, profile: 'warm', policy },
      secondOperation
    );

    releaseFailure?.();
    await expect(first).rejects.toThrow('create failed');
    await expect(second).resolves.toBeUndefined();
    expect(secondOperation).toHaveBeenCalledTimes(1);
  });

  it('does not misclassify a later inventory failure after an operation failure', async () => {
    const docker = new FakeDocker(4 * GIBIBYTE);
    const controller = new WorkerContainerAdmissionController(
      async () => 3 * GIBIBYTE
    );
    const request = {
      image: EWorkerImage.baileys,
      profile: 'warm' as const,
      policy: requiredPolicy(EWorkerImage.baileys, 'warm'),
    };

    await expect(
      controller.run(docker, request, async () => {
        throw new Error('create failed');
      })
    ).rejects.toThrow('create failed');

    docker.infoError = new Error('sensitive daemon failure');
    await expect(
      controller.run(docker, request, async () => undefined)
    ).rejects.toThrow('worker_container_admission_inventory_unavailable');
    expect(controller.getStatus()).toEqual(
      expect.objectContaining({
        last_outcome: 'rejected',
        last_reason: 'inventory_unavailable',
      })
    );
  });

  it('rejects an impossible host headroom configuration with a capacity reason', async () => {
    const docker = new FakeDocker(400 * MEBIBYTE);
    const controller = new WorkerContainerAdmissionController(
      async () => 300 * MEBIBYTE
    );

    await expect(
      controller.run(
        docker,
        {
          image: EWorkerImage.whatsmeow,
          profile: 'warm',
          policy: requiredPolicy(EWorkerImage.whatsmeow, 'warm'),
        },
        async () => undefined
      )
    ).rejects.toThrow(
      'worker_container_admission_capacity_host_headroom_configuration_impossible'
    );
  });
});
