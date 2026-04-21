import 'reflect-metadata';
import { ReleaseDeleterRepository } from '@core/repositories/release/ReleaseDeleter.repository';

function createSelectStep(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const limit = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

function createDeleteStep(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  return { where };
}

describe('ReleaseDeleterRepository', () => {
  it('returns not_found when release does not exist', async () => {
    const selectStep = createSelectStep([]);
    const repository = new ReleaseDeleterRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          select: selectStep.select,
          delete: jest.fn(),
        })
      ),
    } as never);

    await expect(repository.deleteById('release-1', 'user-1')).resolves.toBe(
      'not_found'
    );
  });

  it('returns forbidden when release is owned by another user', async () => {
    const selectStep = createSelectStep([{ created_by_user_id: 'user-2' }]);
    const repository = new ReleaseDeleterRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          select: selectStep.select,
          delete: jest.fn(),
        })
      ),
    } as never);

    await expect(repository.deleteById('release-1', 'user-1')).resolves.toBe(
      'forbidden'
    );
  });

  it('returns true when release and related records are deleted', async () => {
    const selectStep = createSelectStep([{ created_by_user_id: 'user-1' }]);
    const deleteView = createDeleteStep(2);
    const deleteAccess = createDeleteStep(1);
    const deleteRelease = createDeleteStep(1);

    const del = jest
      .fn()
      .mockReturnValueOnce({ where: deleteView.where })
      .mockReturnValueOnce({ where: deleteAccess.where })
      .mockReturnValueOnce({ where: deleteRelease.where });

    const repository = new ReleaseDeleterRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          select: selectStep.select,
          delete: del,
        })
      ),
    } as never);

    await expect(repository.deleteById('release-1', 'user-1')).resolves.toBe(
      true
    );
  });

  it('returns not_found when final release delete affects no rows', async () => {
    const selectStep = createSelectStep([{ created_by_user_id: 'user-1' }]);
    const deleteView = createDeleteStep(2);
    const deleteAccess = createDeleteStep(1);
    const deleteRelease = createDeleteStep(0);

    const del = jest
      .fn()
      .mockReturnValueOnce({ where: deleteView.where })
      .mockReturnValueOnce({ where: deleteAccess.where })
      .mockReturnValueOnce({ where: deleteRelease.where });

    const repository = new ReleaseDeleterRepository({
      transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          select: selectStep.select,
          delete: del,
        })
      ),
    } as never);

    await expect(repository.deleteById('release-1', 'user-1')).resolves.toBe(
      'not_found'
    );
  });
});
