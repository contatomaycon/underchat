import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DashboardOfflineChannelsRepository } from '@core/repositories/dashboard/DashboardOfflineChannels.repository';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

const repositorySource = readFileSync(
  resolve(
    process.cwd(),
    'packages/repositories/dashboard/DashboardOfflineChannels.repository.ts'
  ),
  'utf8'
);

function createChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const orderBy = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ orderBy }));
  const queryBuilder = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where,
  } as any;
  queryBuilder.innerJoin.mockReturnValue(queryBuilder);
  queryBuilder.leftJoin.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue({ orderBy });
  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('DashboardOfflineChannelsRepository', () => {
  it('does not list lifecycle deletion channels in the offline banner source', () => {
    expect(repositorySource).toContain('notInArray(worker.worker_status_id');
    expect(repositorySource).toContain('EWorkerStatus.deleting');
    expect(repositorySource).toContain('EWorkerStatus.delete');
  });

  it('returns empty list when no offline channels are found', async () => {
    const chain = createChain([]);
    const repository = new DashboardOfflineChannelsRepository({
      select: chain.select,
    } as never);

    await expect(repository.listOfflineChannels('acc-1')).resolves.toEqual([]);
  });

  it('maps offline channels response', async () => {
    const chain = createChain([
      {
        id: 'w1',
        name: 'Channel',
        worker_type_id: EWorkerType.baileys,
        session_identity_present: false,
        status: { id: 'offline', name: 'Offline' },
        runtime_generation: 3,
        lifecycle_operation_id: '33333333-3333-7333-8333-333333333333',
      },
    ]);
    const repository = new DashboardOfflineChannelsRepository({
      select: chain.select,
    } as never);

    await expect(repository.listOfflineChannels('acc-1')).resolves.toEqual([
      {
        id: 'w1',
        name: 'Channel',
        worker_type_id: EWorkerType.baileys,
        session_identity_present: false,
        status: { id: 'offline', name: 'Offline' },
        connection_status: null,
        connection_status_source_id: null,
        connection_status_sequence: null,
        connection_status_changed_at: null,
        connection_status_order: null,
        connection_online_acknowledged: false,
        runtime_generation: 3,
        lifecycle_operation_id: '33333333-3333-7333-8333-333333333333',
        connection_status_observed_at: undefined,
        connection_disconnected_at: undefined,
        worker_status_observed_at: undefined,
      },
    ]);
  });

  it('keeps native ordering metadata diagnostic without replacing persisted status', async () => {
    const chain = createChain([
      {
        id: 'w1',
        name: 'Channel',
        worker_type_id: EWorkerType.wwebjs,
        session_identity_present: false,
        status: { id: EWorkerStatus.offline, name: 'Offline' },
        native_connection_status_source_id:
          '11111111-1111-4111-8111-111111111111',
        native_connection_status: {
          provider: 'wwebjs',
          status: 'lease_lost',
          connected: false,
          authenticated: true,
          sessionValid: true,
          recoverable: true,
          qrAvailable: false,
          sequence: 8,
          changedAt: '2026-08-04T12:00:08.000Z',
        },
        native_connection_status_order: 42n,
        native_connection_online_acknowledged: false,
        runtime_generation: 4,
      },
    ]);
    const repository = new DashboardOfflineChannelsRepository({
      select: chain.select,
    } as never);

    await expect(repository.listOfflineChannels('acc-1')).resolves.toEqual([
      {
        id: 'w1',
        name: 'Channel',
        worker_type_id: EWorkerType.wwebjs,
        session_identity_present: false,
        status: { id: EWorkerStatus.offline, name: 'Offline' },
        connection_status: null,
        connection_status_source_id: '11111111-1111-4111-8111-111111111111',
        connection_status_sequence: 8,
        connection_status_changed_at: '2026-08-04T12:00:08.000Z',
        connection_status_order: '42',
        connection_online_acknowledged: false,
        runtime_generation: 4,
        connection_status_observed_at: undefined,
        connection_disconnected_at: undefined,
        worker_status_observed_at: undefined,
      },
    ]);
  });

  it('excludes persisted ONLINE even when its native source proof is invalid', async () => {
    const chain = createChain([
      {
        id: 'w1',
        name: 'Channel',
        worker_type_id: EWorkerType.baileys,
        status: { id: EWorkerStatus.online, name: 'Online' },
        native_connection_status_source_id: 'not-a-runtime-source',
        native_connection_status: {
          provider: 'baileys',
          status: 'online',
          connected: true,
          authenticated: true,
          sessionValid: true,
          recoverable: true,
          qrAvailable: false,
          sequence: 12,
          changedAt: '2026-08-04T12:00:12.000Z',
        },
        native_connection_status_order: 43n,
        native_connection_online_acknowledged: false,
        runtime_generation: 5,
      },
    ]);
    const repository = new DashboardOfflineChannelsRepository({
      select: chain.select,
    } as never);

    await expect(repository.listOfflineChannels('acc-1')).resolves.toEqual([]);
  });

  it('keeps recreating visible while exposing its phase separately', async () => {
    const chain = createChain([
      {
        id: 'w-recreate',
        name: 'Recreate',
        worker_type_id: EWorkerType.whatsmeow,
        session_identity_present: true,
        status: { id: EWorkerStatus.recreating, name: 'recreating' },
        runtime_generation: 9,
        lifecycle_operation_id: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
        worker_container_id: 'a'.repeat(64),
        runtime_container_id: 'b'.repeat(64),
        recreate_bootstrap_operation_id: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
        recreate_bootstrap_runtime_generation: 9,
        recreate_bootstrap_container_id: 'b'.repeat(64),
        recreate_bootstrap_started_at: '2026-08-07T12:00:01.000Z',
      },
    ]);
    const repository = new DashboardOfflineChannelsRepository({
      select: chain.select,
    } as never);

    await expect(repository.listOfflineChannels('acc-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'w-recreate',
        status: { id: EWorkerStatus.recreating, name: 'recreating' },
        session_identity_present: true,
        connection_status: null,
        recreate_phase: 'connecting',
        recreate_phase_observed_at: '2026-08-07T12:00:01.000Z',
        recreate_runtime_retired: false,
      }),
    ]);
  });
});
