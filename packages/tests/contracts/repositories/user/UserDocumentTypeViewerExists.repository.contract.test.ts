import 'reflect-metadata';
import { UserDocumentTypeViewerExistsRepository } from '@core/repositories/user/UserDocumentTypeViewerExists.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('UserDocumentTypeViewerExistsRepository', () => {
  it('returns false when query has no rows', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new UserDocumentTypeViewerExistsRepository(
      dbMock.db as never
    );

    await expect(repository.existsUserDocumentTypeById('type-1')).resolves.toBe(
      false
    );
  });

  it('returns false when total is zero', async () => {
    const dbMock = createSelectDbMock([{ total: 0 }]);
    const repository = new UserDocumentTypeViewerExistsRepository(
      dbMock.db as never
    );

    await expect(repository.existsUserDocumentTypeById('type-1')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const dbMock = createSelectDbMock([{ total: 1 }]);
    const repository = new UserDocumentTypeViewerExistsRepository(
      dbMock.db as never
    );

    await expect(repository.existsUserDocumentTypeById('type-1')).resolves.toBe(
      true
    );
  });
});
