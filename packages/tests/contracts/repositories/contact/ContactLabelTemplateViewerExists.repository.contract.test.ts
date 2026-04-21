import 'reflect-metadata';
import { ContactLabelTemplateViewerExistsRepository } from '@core/repositories/contact/ContactLabelTemplateViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('ContactLabelTemplateViewerExistsRepository', () => {
  it('returns false when there are no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new ContactLabelTemplateViewerExistsRepository(
      db as never
    );

    await expect(
      repository.existsContactLabelTemplate('contact-1', 'label-1')
    ).resolves.toBe(false);
  });

  it('returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new ContactLabelTemplateViewerExistsRepository(
      db as never
    );

    await expect(
      repository.existsContactLabelTemplate('contact-1', 'label-1')
    ).resolves.toBe(false);
  });

  it('returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new ContactLabelTemplateViewerExistsRepository(
      db as never
    );

    await expect(
      repository.existsContactLabelTemplate('contact-1', 'label-1')
    ).resolves.toBe(true);
  });
});
