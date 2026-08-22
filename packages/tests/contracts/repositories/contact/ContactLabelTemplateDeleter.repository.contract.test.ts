import 'reflect-metadata';
import { ContactLabelTemplateDeleterRepository } from '@core/repositories/contact/ContactLabelTemplateDeleter.repository';

jest.mock('@core/repositories/contact/contactOutboundWebhookOutbox', () => ({
  lockContactOutboundWebhookSnapshotInTransaction: jest.fn(async () => null),
  markContactOutboundWebhookAppliedInTransaction: jest.fn(async () => {}),
}));

const createLabelSelect = () => {
  const chain = {} as Record<string, jest.Mock>;
  for (const method of ['from', 'where', 'for', 'limit']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.execute = jest.fn(async () => [{ id: 'label-1' }]);
  return jest.fn(() => chain);
};

describe('ContactLabelTemplateDeleterRepository', () => {
  it('scopes assignment lookup through an active label in the account', async () => {
    const chain = {} as Record<string, jest.Mock>;
    for (const method of ['from', 'innerJoin', 'where', 'limit']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.execute = jest.fn(async () => [{ id: 'assignment-1' }]);
    const select = jest.fn(() => chain);
    const repository = new ContactLabelTemplateDeleterRepository({
      select,
    } as never);

    await expect(
      repository.findContactLabelTemplateId('contact-1', 'label-1', 'account-1')
    ).resolves.toBe('assignment-1');

    expect(chain.innerJoin).toHaveBeenCalledTimes(1);
    expect(chain.where).toHaveBeenCalledTimes(1);
  });

  it('deletes label templates by contact in transaction', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const del = jest.fn(() => ({ where }));
    const tx = { delete: del };

    const repository = new ContactLabelTemplateDeleterRepository({} as never);

    await expect(
      repository.deleteContactLabelTemplatesByContactId(
        tx as never,
        'contact-1'
      )
    ).resolves.toBe(true);
  });

  it('returns false when deleting by contact and label affects no rows', async () => {
    const execute = jest.fn(async () => ({ rowCount: 0 }));
    const where = jest.fn(() => ({ execute }));
    const del = jest.fn(() => ({ where }));
    const tx = { delete: del, select: createLabelSelect() };
    const dbRw = {
      transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx)
      ),
    };

    const repository = new ContactLabelTemplateDeleterRepository(dbRw as never);

    await expect(
      repository.deleteContactLabelTemplateByContactIdAndLabelTemplateId(
        'contact-1',
        'label-1',
        'account-1'
      )
    ).resolves.toBe(false);
  });
});
