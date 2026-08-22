import 'reflect-metadata';
import { WorkerMonitorViewerRepository } from '@core/repositories/worker/WorkerMonitorViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

function collectSqlParts(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (typeof value !== 'object') {
    return [String(value)];
  }

  const record = value as {
    queryChunks?: unknown[];
    value?: unknown;
    name?: unknown;
    columnType?: unknown;
  };

  if (Array.isArray(record.queryChunks)) {
    return record.queryChunks.flatMap((chunk) => collectSqlParts(chunk));
  }

  if (Array.isArray(record.value)) {
    return record.value.map(String);
  }

  if ('value' in record && typeof record.value !== 'object') {
    return [String(record.value)];
  }

  if (
    typeof record.name === 'string' &&
    typeof record.columnType === 'string'
  ) {
    return [record.name];
  }

  return [];
}

describe('WorkerMonitorViewerRepository', () => {
  it('listWorkers returns empty array when query has no rows', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerMonitorViewerRepository(
      dbMock.db as never,
      dbMock.db as never
    );

    await expect(repository.listWorkers()).resolves.toEqual([]);
  });

  it('listWorkers returns monitor data when query has rows', async () => {
    const rows = [
      {
        worker_id: 'w-1',
        name: 'Canal 1',
        account_id: 'a-1',
        server_id: 's-1',
        worker_status_id: 'online',
        worker_type_id: 'baileys',
        created_at: '2026-04-21T10:00:00.000Z',
        updated_at: '2026-04-21T10:10:00.000Z',
        deleted_at: null,
        container_id: 'container-1',
        last_connection_check_at: '2026-04-21T10:11:00.000Z',
      },
    ];
    const dbMock = createSelectDbMock(rows);
    const repository = new WorkerMonitorViewerRepository(
      dbMock.db as never,
      dbMock.db as never
    );

    await expect(repository.listWorkers()).resolves.toEqual(rows);
    expect(collectSqlParts(dbMock.where.mock.calls[0][0]).join(' ')).toContain(
      EWorkerType.whatsapp
    );
    expect(collectSqlParts(dbMock.where.mock.calls[0][0]).join(' ')).toContain(
      'server_id'
    );
  });

  it('viewWorker returns null when worker is not found', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerMonitorViewerRepository(
      dbMock.db as never,
      dbMock.db as never
    );

    await expect(repository.viewWorker('w-1')).resolves.toBeNull();
  });

  it('viewWorker returns first row when worker exists', async () => {
    const row = {
      worker_id: 'w-1',
      name: 'Canal 1',
      account_id: 'a-1',
      server_id: 's-1',
      worker_status_id: 'online',
      worker_type_id: 'baileys',
      created_at: '2026-04-21T10:00:00.000Z',
      updated_at: '2026-04-21T10:10:00.000Z',
      deleted_at: null,
      container_id: 'container-1',
      last_connection_check_at: '2026-04-21T10:11:00.000Z',
    };
    const dbMock = createSelectDbMock([row]);
    const repository = new WorkerMonitorViewerRepository(
      dbMock.db as never,
      dbMock.db as never
    );

    await expect(repository.viewWorker('w-1')).resolves.toEqual(row);
  });

  it('reads lifecycle fencing snapshots from the primary database', async () => {
    const staleReplica = createSelectDbMock([
      {
        worker_id: 'w-1',
        lifecycle_operation_id: 'operation-old',
        worker_type_id: EWorkerType.wwebjs,
      },
    ]);
    const primaryRow = {
      worker_id: 'w-1',
      lifecycle_operation_id: 'operation-new',
      worker_type_id: EWorkerType.whatsmeow,
    };
    const primary = createSelectDbMock([primaryRow]);
    const repository = new WorkerMonitorViewerRepository(
      staleReplica.db as never,
      primary.db as never
    );

    await expect(repository.viewWorkerConsistent('w-1')).resolves.toEqual(
      primaryRow
    );

    expect(primary.db.select).toHaveBeenCalledTimes(1);
    expect(staleReplica.db.select).not.toHaveBeenCalled();
  });

  it('pages bounded online runtime identities from primary for missing-Docker recovery', async () => {
    const rows = [
      {
        worker_id: '019f609a-3675-7698-ae1d-690cf4dd69b4',
        worker_status_id: EWorkerStatus.online,
        worker_type_id: EWorkerType.wwebjs,
        container_id: 'a'.repeat(64),
        runtime_container_id: 'a'.repeat(64),
        runtime_generation: 2,
        lifecycle_operation_id: null,
      },
    ];
    const replica = createSelectDbMock([]);
    const primary = createSelectDbMock(rows);
    const repository = new WorkerMonitorViewerRepository(
      replica.db as never,
      primary.db as never
    );

    await expect(
      repository.listMissingRuntimeRecoveryCandidates(5_000, 'worker-after')
    ).resolves.toEqual(rows);

    expect(primary.db.select).toHaveBeenCalledTimes(1);
    expect(replica.db.select).not.toHaveBeenCalled();
    expect(primary.innerJoin).toHaveBeenCalledTimes(1);
    expect(primary.limit).toHaveBeenCalledWith(500);
    const filters = collectSqlParts(primary.where.mock.calls[0][0]).join(' ');
    expect(filters).toContain(EWorkerStatus.online);
    expect(filters).toContain(EWorkerType.whatsapp);
    expect(filters).toContain('worker-after');
    expect(filters).toContain('container_id');
    expect(filters).toContain('lifecycle_operation_id');
    expect(filters).toContain('runtime_generation');
  });
});
