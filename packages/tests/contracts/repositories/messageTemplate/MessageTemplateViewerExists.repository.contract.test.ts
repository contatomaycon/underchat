import 'reflect-metadata';
import { MessageTemplateViewerExistsRepository } from '@core/repositories/messageTemplate/MessageTemplateViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('MessageTemplateViewerExistsRepository', () => {
  it('returns false when there are no rows', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new MessageTemplateViewerExistsRepository(db as never);

    await expect(repository.existsMessageTemplateById('tmpl-1')).resolves.toBe(
      false
    );
  });

  it('returns false when total is zero', async () => {
    const { db } = createSelectDbMock([{ total: 0 }]);
    const repository = new MessageTemplateViewerExistsRepository(db as never);

    await expect(repository.existsMessageTemplateById('tmpl-1')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const { db } = createSelectDbMock([{ total: 1 }]);
    const repository = new MessageTemplateViewerExistsRepository(db as never);

    await expect(repository.existsMessageTemplateById('tmpl-1')).resolves.toBe(
      true
    );
  });
});
