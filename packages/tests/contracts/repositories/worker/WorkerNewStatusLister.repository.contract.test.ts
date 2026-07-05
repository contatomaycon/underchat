import 'reflect-metadata';
import { WorkerNewStatusListerRepository } from '@core/repositories/worker/WorkerNewStatusLister.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';
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

describe('WorkerNewStatusListerRepository', () => {
  it('returns empty list when there are no workers in new status', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerNewStatusListerRepository(dbMock.db as never);

    await expect(repository.listWorkerNewStatus()).resolves.toEqual([]);
  });

  it('returns workers in new status', async () => {
    const rows = [
      {
        worker_id: 'w-1',
        server_id: 's-1',
        account_id: 'a-1',
        worker_status_id: 'new',
        number: null,
        connection_date: null,
      },
    ];
    const dbMock = createSelectDbMock(rows);
    const repository = new WorkerNewStatusListerRepository(dbMock.db as never);

    await expect(repository.listWorkerNewStatus()).resolves.toEqual(rows);
    const whereSql = collectSqlParts(dbMock.where.mock.calls[0][0]).join(' ');
    expect(whereSql).toContain('server_id');
    expect(whereSql).toContain(EWorkerType.whatsapp);
  });
});
