import 'reflect-metadata';
import { UserNamePhotoViewerRepository } from '@core/repositories/user/UserNamePhotoViewer.repository';
import { createSelectDbMock } from '../../../helpers/drizzleMock';

describe('UserNamePhotoViewerRepository', () => {
  it('returns null when query returns no rows', async () => {
    const dbMock = createSelectDbMock([]);
    const repository = new UserNamePhotoViewerRepository(dbMock.db as never);

    await expect(repository.viewUserNamePhoto('user-1')).resolves.toBeNull();
  });

  it('returns first row as name/photo payload', async () => {
    const expected = {
      id: 'user-1',
      name: 'John',
      photo: 'https://cdn/photo.png',
    };
    const dbMock = createSelectDbMock([expected]);
    const repository = new UserNamePhotoViewerRepository(dbMock.db as never);

    await expect(repository.viewUserNamePhoto('user-1')).resolves.toEqual(
      expected
    );
  });
});
