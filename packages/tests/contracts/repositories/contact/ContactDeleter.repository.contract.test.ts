import 'reflect-metadata';
import { ContactDeleterRepository } from '@core/repositories/contact/ContactDeleter.repository';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(() => '2026-04-21T12:00:00.000Z'),
}));

function createTx(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));

  return {
    tx: { update },
    set,
  };
}

describe('ContactDeleterRepository', () => {
  it('returns true when one contact is soft deleted', async () => {
    const { tx, set } = createTx(1);
    const dbRw = {
      transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
        callback(tx)
      ),
    };
    const contactLabelTemplateDeleterRepository = {
      deleteContactLabelTemplatesByContactId: jest.fn(async () => true),
    };

    const repository = new ContactDeleterRepository(
      dbRw as never,
      contactLabelTemplateDeleterRepository as never
    );

    await expect(repository.deleteContactById('contact-1')).resolves.toBe(true);
    expect(
      contactLabelTemplateDeleterRepository.deleteContactLabelTemplatesByContactId
    ).toHaveBeenCalledWith(tx, 'contact-1');
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: '2026-04-21T12:00:00.000Z' })
    );
  });

  it('returns false when update affects no rows', async () => {
    const { tx } = createTx(0);
    const dbRw = {
      transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
        callback(tx)
      ),
    };
    const contactLabelTemplateDeleterRepository = {
      deleteContactLabelTemplatesByContactId: jest.fn(async () => true),
    };

    const repository = new ContactDeleterRepository(
      dbRw as never,
      contactLabelTemplateDeleterRepository as never
    );

    await expect(repository.deleteContactById('contact-1')).resolves.toBe(
      false
    );
  });
});
