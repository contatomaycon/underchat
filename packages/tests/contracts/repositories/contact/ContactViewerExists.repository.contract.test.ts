import 'reflect-metadata';
import { ContactViewerExistsRepository } from '@core/repositories/contact/ContactViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ContactViewerExistsRepository', () => {
  it('returns false when there are no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ContactViewerExistsRepository(db as never);

    await expect(repository.existsContactById('contact-1')).resolves.toBe(
      false
    );
  });

  it('returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new ContactViewerExistsRepository(db as never);

    await expect(repository.existsContactById('contact-1')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new ContactViewerExistsRepository(db as never);

    await expect(repository.existsContactById('contact-1')).resolves.toBe(true);
  });
});
