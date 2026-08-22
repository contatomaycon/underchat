import 'reflect-metadata';
import { DashboardChannelsStatusRepository } from '@core/repositories/dashboard/DashboardChannelsStatus.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

describe('DashboardChannelsStatusRepository', () => {
  it('returns mapped channels status data', async () => {
    const { db, execute, from, innerJoin, where, orderBy } = createSelectDbMock(
      [
        {
          id: 'worker-1',
          name: 'Support',
          worker_type_id: EWorkerType.baileys,
          runtime_generation: 3,
          lifecycle_operation_id: '33333333-3333-7333-8333-333333333333',
          status: {
            id: 'status-1',
            name: 'Online',
          },
        },
        {
          id: 'worker-2',
          name: 'Sales',
          worker_type_id: EWorkerType.whatsapp,
          runtime_generation: 1,
          status: null,
        },
      ]
    );

    const repository = new DashboardChannelsStatusRepository(db as never);

    await expect(repository.listChannelsStatus('account-1')).resolves.toEqual([
      {
        id: 'worker-1',
        name: 'Support',
        worker_type_id: EWorkerType.baileys,
        session_identity_present: false,
        runtime_generation: 3,
        lifecycle_operation_id: '33333333-3333-7333-8333-333333333333',
        status: {
          id: 'status-1',
          name: 'Online',
        },
        connection_status_source_id: null,
        connection_status_order: null,
      },
      {
        id: 'worker-2',
        name: 'Sales',
        worker_type_id: EWorkerType.whatsapp,
        session_identity_present: false,
        runtime_generation: 1,
        status: null,
        connection_status_source_id: null,
        connection_status_order: null,
      },
    ]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(innerJoin).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when the query returns no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new DashboardChannelsStatusRepository(db as never);

    await expect(repository.listChannelsStatus('account-1')).resolves.toEqual(
      []
    );
  });

  it('exposes the persisted unofficial ONLINE pointer without read-side rewriting', async () => {
    const { db } = createSelectDbMock([
      {
        id: 'worker-unofficial',
        name: 'Browser',
        worker_type_id: EWorkerType.wwebjs,
        session_identity_present: false,
        runtime_generation: 4,
        status: { id: EWorkerStatus.online, name: 'online' },
      },
    ]);
    const repository = new DashboardChannelsStatusRepository(db as never);

    await expect(repository.listChannelsStatus('account-1')).resolves.toEqual([
      {
        id: 'worker-unofficial',
        name: 'Browser',
        worker_type_id: EWorkerType.wwebjs,
        session_identity_present: false,
        runtime_generation: 4,
        status: { id: EWorkerStatus.online, name: 'online' },
        connection_status_source_id: null,
        connection_status_order: null,
        connection_status_observed_at: undefined,
        connection_disconnected_at: undefined,
        worker_status_observed_at: undefined,
      },
    ]);
  });

  it('returns the native high-watermark for every channel snapshot', async () => {
    const { db } = createSelectDbMock([
      {
        id: 'worker-online',
        name: 'Realtime',
        worker_type_id: EWorkerType.baileys,
        session_identity_present: false,
        runtime_generation: 5,
        status: { id: EWorkerStatus.online, name: 'online' },
        effective_status_id: EWorkerStatus.online,
        connection_status_source_id: '11111111-1111-4111-8111-111111111111',
        connection_status_order: 10n,
      },
    ]);
    const repository = new DashboardChannelsStatusRepository(db as never);

    await expect(repository.listChannelsStatus('account-1')).resolves.toEqual([
      {
        id: 'worker-online',
        name: 'Realtime',
        worker_type_id: EWorkerType.baileys,
        session_identity_present: false,
        runtime_generation: 5,
        status: { id: EWorkerStatus.online, name: 'online' },
        connection_status_source_id: '11111111-1111-4111-8111-111111111111',
        connection_status_order: '10',
      },
    ]);
  });

  it('includes the derived recreate phase without exposing physical identities', async () => {
    const { db } = createSelectDbMock([
      {
        id: 'worker-recreate',
        name: 'Bootstrap',
        worker_type_id: EWorkerType.wwebjs,
        session_identity_present: true,
        runtime_generation: 12,
        lifecycle_operation_id: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
        status: { id: EWorkerStatus.recreating, name: 'recreating' },
        effective_status_id: EWorkerStatus.recreating,
        worker_container_id: 'a'.repeat(64),
        runtime_container_id: 'b'.repeat(64),
        recreate_bootstrap_operation_id: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
        recreate_bootstrap_runtime_generation: 12,
        recreate_bootstrap_container_id: 'b'.repeat(64),
        recreate_bootstrap_started_at: '2026-08-07T12:00:01.000Z',
      },
    ]);
    const repository = new DashboardChannelsStatusRepository(db as never);

    const [result] = await repository.listChannelsStatus('account-1');

    expect(result).toMatchObject({
      id: 'worker-recreate',
      status: { id: EWorkerStatus.recreating },
      session_identity_present: true,
      recreate_phase: 'connecting',
      recreate_phase_observed_at: '2026-08-07T12:00:01.000Z',
      recreate_runtime_retired: false,
    });
    expect(result).not.toHaveProperty('worker_container_id');
    expect(result).not.toHaveProperty('runtime_container_id');
  });
});
