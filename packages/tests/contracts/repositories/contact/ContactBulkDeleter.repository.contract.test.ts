import 'reflect-metadata';
import { ContactBulkDeleterRepository } from '@core/repositories/contact/ContactBulkDeleter.repository';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(() => '2026-04-21T12:00:00.000Z'),
}));

function createUpdateTx(rowCount?: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));

  return {
    tx: { update },
    set,
  };
}

describe('ContactBulkDeleterRepository', () => {
  it('returns 0 and skips transaction when contact ids are empty', async () => {
    const dbRw = {
      transaction: jest.fn(),
    };
    const contactLabelTemplateDeleterRepository = {
      deleteContactLabelTemplatesByContactId: jest.fn(),
    };

    const repository = new ContactBulkDeleterRepository(
      dbRw as never,
      contactLabelTemplateDeleterRepository as never
    );

    await expect(repository.deleteContactsByIds([])).resolves.toBe(0);
    expect(dbRw.transaction).not.toHaveBeenCalled();
    expect(
      contactLabelTemplateDeleterRepository.deleteContactLabelTemplatesByContactId
    ).not.toHaveBeenCalled();
  });

  it('deletes labels and soft deletes contacts in transaction', async () => {
    const { tx, set } = createUpdateTx(2);
    const dbRw = {
      transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
        callback(tx)
      ),
    };
    const contactLabelTemplateDeleterRepository = {
      deleteContactLabelTemplatesByContactId: jest.fn(async () => true),
    };

    const repository = new ContactBulkDeleterRepository(
      dbRw as never,
      contactLabelTemplateDeleterRepository as never
    );

    await expect(repository.deleteContactsByIds(['c-1', 'c-2'])).resolves.toBe(
      2
    );
    expect(
      contactLabelTemplateDeleterRepository.deleteContactLabelTemplatesByContactId
    ).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: '2026-04-21T12:00:00.000Z' })
    );
  });

  it('returns 0 when update rowCount is undefined', async () => {
    const { tx } = createUpdateTx(undefined);
    const dbRw = {
      transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
        callback(tx)
      ),
    };
    const contactLabelTemplateDeleterRepository = {
      deleteContactLabelTemplatesByContactId: jest.fn(async () => true),
    };

    const repository = new ContactBulkDeleterRepository(
      dbRw as never,
      contactLabelTemplateDeleterRepository as never
    );

    await expect(repository.deleteContactsByIds(['c-1'])).resolves.toBe(0);
  });
});
