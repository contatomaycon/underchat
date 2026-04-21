import 'reflect-metadata';
import { MessageTemplateDeleterRepository } from '@core/repositories/messageTemplate/MessageTemplateDeleter.repository';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(() => '2026-04-21T12:00:00.000Z'),
}));

function createUpdateChain(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));

  return {
    dbRw: { update },
    set,
  };
}

describe('MessageTemplateDeleterRepository', () => {
  it('returns true when one row is soft deleted', async () => {
    const { dbRw, set } = createUpdateChain(1);
    const repository = new MessageTemplateDeleterRepository(dbRw as never);

    await expect(repository.deleteMessageTemplateById('tmpl-1')).resolves.toBe(
      true
    );
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: '2026-04-21T12:00:00.000Z' })
    );
  });

  it('returns false when no row is updated', async () => {
    const { dbRw } = createUpdateChain(0);
    const repository = new MessageTemplateDeleterRepository(dbRw as never);

    await expect(repository.deleteMessageTemplateById('tmpl-1')).resolves.toBe(
      false
    );
  });
});
