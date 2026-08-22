import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { resolveWorkerContainerResourcePolicy } from '@core/common/functions/workerContainerResourcePolicy';

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
] as const;

describe('worker container resource policy contract', () => {
  const original = new Map(
    ENV_NAMES.map((name) => [name, process.env[name]] as const)
  );

  beforeEach(() => {
    for (const name of ENV_NAMES) {
      delete process.env[name];
    }
  });

  afterAll(() => {
    for (const [name, value] of original) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it.each([
    [EWorkerImage.baileys, 1_536, 1_500],
    [EWorkerImage.wwebjs, 3_072, 2_000],
    [EWorkerImage.whatsmeow, 1_024, 1_000],
  ])('bounds %s without host swap by default', (image, memoryMb, cpuMillis) => {
    const policy = resolveWorkerContainerResourcePolicy(image);
    const memoryBytes = memoryMb * 1024 * 1024;

    expect(policy?.hostConfig).toEqual({
      Memory: memoryBytes,
      MemoryReservation: memoryBytes / 2,
      MemorySwap: memoryBytes,
      NanoCpus: cpuMillis * 1_000_000,
      OomKillDisable: false,
      OomScoreAdj: 250,
      PidsLimit: 512,
    });
    expect(policy?.labels).toEqual(
      expect.objectContaining({
        'underchat.resource_policy': 'v2',
        'underchat.resource_profile': 'active',
        'underchat.resource_memory_bytes': String(memoryBytes),
        'underchat.resource_memory_reservation_bytes': String(memoryBytes / 2),
        'underchat.resource_memory_swap_bytes': String(memoryBytes),
        'underchat.resource_nano_cpus': String(cpuMillis * 1_000_000),
        'underchat.resource_oom_kill_disable': 'false',
        'underchat.resource_oom_score_adj': '250',
        'underchat.resource_pids_limit': '512',
      })
    );
  });

  it.each([
    [EWorkerImage.baileys, 256, 250, 128],
    [EWorkerImage.wwebjs, 384, 250, 256],
    [EWorkerImage.whatsmeow, 192, 250, 128],
  ])(
    'uses a replaceable bootstrap boundary for %s warm standbys',
    (image, memoryMb, cpuMillis, pidsLimit) => {
      const policy = resolveWorkerContainerResourcePolicy(image, 'warm');
      const memoryBytes = memoryMb * 1024 * 1024;

      expect(policy).toEqual(
        expect.objectContaining({
          image,
          profile: 'warm',
          hostConfig: {
            Memory: memoryBytes,
            MemoryReservation: Math.max(128 * 1024 * 1024, memoryBytes / 2),
            MemorySwap: memoryBytes,
            NanoCpus: cpuMillis * 1_000_000,
            OomKillDisable: false,
            OomScoreAdj: 750,
            PidsLimit: pidsLimit,
          },
          labels: expect.objectContaining({
            'underchat.resource_policy': 'v2',
            'underchat.resource_profile': 'warm',
            'underchat.resource_oom_score_adj': '750',
          }),
        })
      );
    }
  );

  it('allows bounded per-provider overrides', () => {
    process.env.WORKER_CONTAINER_WWEBJS_MEMORY_MB = '6144';
    process.env.WORKER_CONTAINER_WWEBJS_CPU_MILLIS = '2500';
    process.env.WORKER_CONTAINER_PIDS_LIMIT = '768';

    expect(
      resolveWorkerContainerResourcePolicy(EWorkerImage.wwebjs)?.hostConfig
    ).toEqual(
      expect.objectContaining({
        Memory: 6_144 * 1024 * 1024,
        MemorySwap: 6_144 * 1024 * 1024,
        NanoCpus: 2_500_000_000,
        PidsLimit: 768,
      })
    );
  });

  it('fails closed on unsafe limits and can be explicitly disabled', () => {
    process.env.WORKER_CONTAINER_WWEBJS_MEMORY_MB = '128';
    expect(() =>
      resolveWorkerContainerResourcePolicy(EWorkerImage.wwebjs)
    ).toThrow('WORKER_CONTAINER_WWEBJS_MEMORY_MB');

    process.env.WORKER_CONTAINER_RESOURCE_LIMITS_ENABLED = 'false';
    expect(
      resolveWorkerContainerResourcePolicy(EWorkerImage.wwebjs)
    ).toBeNull();
  });
});
