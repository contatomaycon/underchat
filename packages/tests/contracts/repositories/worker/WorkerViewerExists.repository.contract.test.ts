import 'reflect-metadata';
import { WorkerViewerExistsRepository } from '@core/repositories/worker/WorkerViewerExists.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('WorkerViewerExistsRepository', () => {
  it('returns false when query has no rows', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new WorkerViewerExistsRepository(dbMock.db as never);

    await expect(repository.existsWorkerById('a-1', 'w-1')).resolves.toBe(
      false
    );
  });

  it('returns false when total is zero', async () => {
    const dbMock = createSelectDbMock([{ total: 0 }]);
    const repository = new WorkerViewerExistsRepository(dbMock.db as never);

    await expect(repository.existsWorkerById('a-1', 'w-1')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const dbMock = createSelectDbMock([{ total: 2 }]);
    const repository = new WorkerViewerExistsRepository(dbMock.db as never);

    await expect(repository.existsWorkerById('a-1', 'w-1')).resolves.toBe(true);
  });
});
