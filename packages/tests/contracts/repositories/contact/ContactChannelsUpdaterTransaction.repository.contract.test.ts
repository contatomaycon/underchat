import 'reflect-metadata';
import { ContactChannelsUpdaterTransactionRepository } from '@core/repositories/contact/ContactChannelsUpdaterTransaction.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

function createDeleteTx() {
  const execute = jest.fn(async () => ({ rowCount: 1 }));
  const where = jest.fn(() => ({ execute }));
  const del = jest.fn(() => ({ where }));

  return {
    tx: {
      delete: del,
    },
  };
}

describe('ContactChannelsUpdaterTransactionRepository', () => {
  it('deletes current channels and returns true when channel ids are empty', async () => {
    const { tx } = createDeleteTx();
    const dbRw = {
      transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
        callback(tx)
      ),
    };
    const contactChannelCreatorRepository = {
      createContactChannelInTransaction: jest.fn(async () => 'cc-1'),
    };

    const repository = new ContactChannelsUpdaterTransactionRepository(
      dbRw as never,
      contactChannelCreatorRepository as never
    );

    await expect(
      repository.updateContactChannels('contact-1', 'account-1', [])
    ).resolves.toBe(true);
    expect(
      contactChannelCreatorRepository.createContactChannelInTransaction
    ).not.toHaveBeenCalled();
  });

  it('creates channels after deleting old relations', async () => {
    const { tx } = createDeleteTx();
    const dbRw = {
      transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
        callback(tx)
      ),
    };
    const contactChannelCreatorRepository = {
      createContactChannelInTransaction: jest.fn(async () => 'cc-1'),
    };

    const repository = new ContactChannelsUpdaterTransactionRepository(
      dbRw as never,
      contactChannelCreatorRepository as never
    );

    await expect(
      repository.updateContactChannels('contact-1', 'account-1', [
        'ch-1',
        'ch-2',
      ])
    ).resolves.toBe(true);
    expect(
      contactChannelCreatorRepository.createContactChannelInTransaction
    ).toHaveBeenCalledTimes(2);
    expect(
      contactChannelCreatorRepository.createContactChannelInTransaction
    ).toHaveBeenNthCalledWith(1, tx, 'contact-1', 'ch-1', 'account-1');
  });
});
