import 'reflect-metadata';
import { WorkerService } from '@core/services/worker.service';

function buildWorkerService(): WorkerService {
  return Object.create(WorkerService.prototype) as WorkerService;
}

describe('WorkerService strict warm deletion', () => {
  it('removes the canonical container and volume without a lossy existence preflight', async () => {
    const service = buildWorkerService();
    service.existsContainerWorkerById = jest.fn(async () => {
      throw new Error('non-strict container preflight must not run');
    });
    service.existsVolumeByName = jest.fn(async () => {
      throw new Error('non-strict volume preflight must not run');
    });
    service.removeContainerWorkerById = jest.fn(async () => true);
    service.removeVolumeByName = jest.fn(async () => true);

    await expect(
      service.removeContainerByNameAndVolume(
        'warm-canonical',
        'warm-volume',
        true
      )
    ).resolves.toBe(true);

    expect(service.existsContainerWorkerById).not.toHaveBeenCalled();
    expect(service.existsVolumeByName).not.toHaveBeenCalled();
    expect(service.removeContainerWorkerById).toHaveBeenCalledWith(
      'warm-canonical'
    );
    expect(service.removeVolumeByName).toHaveBeenCalledWith('warm-volume');
  });

  it('keeps a volume-in-use conflict retryable instead of treating it as removed', async () => {
    const service = buildWorkerService();
    (
      service as unknown as {
        docker: {
          getVolume: jest.Mock;
        };
      }
    ).docker = {
      getVolume: jest.fn(() => ({
        remove: jest.fn(async () => {
          throw Object.assign(new Error('volume is in use'), {
            statusCode: 409,
          });
        }),
      })),
    };

    await expect(service.removeVolumeByName('warm-in-use')).rejects.toThrow(
      'The worker volume removal failed'
    );
  });

  it('does not mask a Docker 409 removal-in-progress conflict as an idempotent success', async () => {
    const service = buildWorkerService();
    (
      service as unknown as {
        docker: {
          getContainer: jest.Mock;
        };
      }
    ).docker = {
      getContainer: jest.fn(() => ({
        remove: jest.fn(async () => {
          throw Object.assign(
            new Error('removal of container warm-1 is already in progress'),
            { statusCode: 409 }
          );
        }),
      })),
    };

    await expect(service.removeContainerWorkerById('warm-1')).rejects.toThrow(
      'The worker removal failed'
    );
  });

  it('does not mask a statusless removal-in-progress message as success', async () => {
    const service = buildWorkerService();
    (
      service as unknown as {
        docker: {
          getContainer: jest.Mock;
        };
      }
    ).docker = {
      getContainer: jest.fn(() => ({
        remove: jest.fn(async () => {
          throw new Error('removal of container warm-1 is already in progress');
        }),
      })),
    };

    await expect(service.removeContainerWorkerById('warm-1')).rejects.toThrow(
      'The worker removal failed'
    );
  });

  it('still treats a confirmed missing Docker resource as an idempotent success', async () => {
    const service = buildWorkerService();
    const notFound = Object.assign(new Error('not found'), {
      statusCode: 404,
    });
    (
      service as unknown as {
        docker: {
          getContainer: jest.Mock;
          getVolume: jest.Mock;
        };
      }
    ).docker = {
      getContainer: jest.fn(() => ({
        remove: jest.fn(async () => {
          throw notFound;
        }),
      })),
      getVolume: jest.fn(() => ({
        remove: jest.fn(async () => {
          throw notFound;
        }),
      })),
    };

    await expect(
      service.removeContainerWorkerById('warm-missing')
    ).resolves.toBe(true);
    await expect(service.removeVolumeByName('warm-missing')).resolves.toBe(
      true
    );
  });

  it('removes a PostgreSQL warm container with anonymous volumes without addressing any named volume', async () => {
    const service = buildWorkerService();
    const remove = jest.fn(async () => undefined);
    const getVolume = jest.fn(() => ({
      remove: jest.fn(async () => undefined),
    }));
    (
      service as unknown as {
        docker: {
          getContainer: jest.Mock;
          getVolume: jest.Mock;
        };
      }
    ).docker = {
      getContainer: jest.fn(() => ({ remove })),
      getVolume,
    };

    await expect(
      service.removePostgresWarmContainerWithAnonymousVolumesById(
        'postgres-warm-container'
      )
    ).resolves.toBe(true);

    expect(remove).toHaveBeenCalledWith({ force: true, v: true });
    expect(getVolume).not.toHaveBeenCalled();
  });

  it('removes a legacy warm volume only after an all-container zero-mount snapshot and exact reinspection', async () => {
    const service = buildWorkerService();
    const order: string[] = [];
    const remove = jest.fn(async () => {
      order.push('remove');
    });
    const inspect = jest.fn(async () => {
      order.push('inspect');
      return {
        Name: 'warm-proof',
        CreatedAt: '2026-07-30T10:00:00Z',
        Driver: 'local',
        Labels: {},
        Mountpoint: '/var/lib/docker/volumes/warm-proof/_data',
        Scope: 'local',
      };
    });
    const listContainers = jest.fn(async () => {
      order.push('list');
      return [];
    });
    (
      service as unknown as {
        docker: {
          getVolume: jest.Mock;
          listContainers: jest.Mock;
        };
      }
    ).docker = {
      getVolume: jest.fn(() => ({ inspect, remove })),
      listContainers,
    };

    const before = await service.inspectVolumeByNameStrict('warm-proof');
    order.length = 0;
    await expect(
      service.removeLegacyWarmVolumeByProof('warm-proof', before.signature)
    ).resolves.toBe(true);

    expect(listContainers).toHaveBeenCalledWith({ all: true });
    expect(order).toEqual(['list', 'inspect', 'remove']);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('preserves a legacy warm volume when any running or stopped container still mounts it', async () => {
    const service = buildWorkerService();
    const remove = jest.fn(async () => undefined);
    const inspect = jest.fn(async () => ({
      Name: 'warm-proof',
      Driver: 'local',
      Labels: {},
      Mountpoint: '/var/lib/docker/volumes/warm-proof/_data',
      Scope: 'local',
    }));
    (
      service as unknown as {
        docker: {
          getVolume: jest.Mock;
          listContainers: jest.Mock;
        };
      }
    ).docker = {
      getVolume: jest.fn(() => ({ inspect, remove })),
      listContainers: jest.fn(async () => [
        {
          Id: 'c'.repeat(64),
          State: 'exited',
          Mounts: [{ Type: 'volume', Name: 'warm-proof' }],
        },
      ]),
    };

    await expect(
      service.removeLegacyWarmVolumeByProof('warm-proof', 'any-signature')
    ).rejects.toThrow('legacy_warm_reclaim_volume_still_mounted');

    expect(inspect).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('uses the same strict mount fence for converted warm cleanup without falling back to generic volume removal', async () => {
    const service = buildWorkerService();
    const remove = jest.fn(async () => undefined);
    (
      service as unknown as {
        docker: {
          getVolume: jest.Mock;
          listContainers: jest.Mock;
        };
      }
    ).docker = {
      getVolume: jest.fn(() => ({
        inspect: jest.fn(async () => ({
          Name: 'warm-converted',
          Driver: 'local',
          Labels: {},
          Mountpoint: '/var/lib/docker/volumes/warm-converted/_data',
          Scope: 'local',
        })),
        remove,
      })),
      listContainers: jest.fn(async () => [
        {
          Id: 'd'.repeat(64),
          State: 'running',
          Mounts: [{ Type: 'volume', Name: 'warm-converted' }],
        },
      ]),
    };

    await expect(
      service.removeConvertedWarmVolumeByProof(
        'warm-converted',
        'expected-signature'
      )
    ).rejects.toThrow('converted_warm_reclaim_volume_still_mounted');

    expect(remove).not.toHaveBeenCalled();
  });

  it('preserves a replacement volume whose strict identity changed before removal', async () => {
    const service = buildWorkerService();
    const remove = jest.fn(async () => undefined);
    (
      service as unknown as {
        docker: {
          getVolume: jest.Mock;
          listContainers: jest.Mock;
        };
      }
    ).docker = {
      getVolume: jest.fn(() => ({
        inspect: jest.fn(async () => ({
          Name: 'warm-proof',
          CreatedAt: '2026-07-30T10:01:00Z',
          Driver: 'local',
          Labels: {},
          Mountpoint: '/var/lib/docker/volumes/warm-proof/_data',
          Scope: 'local',
        })),
        remove,
      })),
      listContainers: jest.fn(async () => []),
    };

    await expect(
      service.removeLegacyWarmVolumeByProof(
        'warm-proof',
        JSON.stringify({
          name: 'warm-proof',
          created_at: '2026-07-30T10:00:00Z',
          driver: 'local',
          labels: [],
          mountpoint: '/var/lib/docker/volumes/warm-proof/_data',
          scope: 'local',
        })
      )
    ).rejects.toThrow('legacy_warm_reclaim_volume_identity_changed');

    expect(remove).not.toHaveBeenCalled();
  });
});
