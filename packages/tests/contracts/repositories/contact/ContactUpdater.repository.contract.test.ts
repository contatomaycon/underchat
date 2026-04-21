import 'reflect-metadata';
import { ContactUpdaterRepository } from '@core/repositories/contact/ContactUpdater.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

function createUpdateChain(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));

  return {
    update,
    set,
  };
}

function createRepository(options?: {
  txRowCount?: number;
  dbRowCount?: number;
}) {
  const txChain = createUpdateChain(options?.txRowCount ?? 1);
  const dbChain = createUpdateChain(options?.dbRowCount ?? 1);

  const tx = {
    update: txChain.update,
  };

  const dbRw = {
    update: dbChain.update,
    transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
      callback(tx)
    ),
  };

  const contactLabelTemplateDeleterRepository = {
    deleteContactLabelTemplatesByContactId: jest.fn(async () => true),
  };

  const contactLabelTemplateCreatorRepository = {
    createContactLabelTemplate: jest.fn(
      async () => 'contact-label-template-id'
    ),
  };

  const contactChannelsUpdaterTransactionRepository = {
    updateContactChannels: jest.fn(async () => true),
  };

  return {
    repository: new ContactUpdaterRepository(
      dbRw as never,
      contactLabelTemplateDeleterRepository as never,
      contactLabelTemplateCreatorRepository as never,
      contactChannelsUpdaterTransactionRepository as never
    ),
    tx,
    dbRw,
    txSet: txChain.set,
    dbSet: dbChain.set,
    contactLabelTemplateDeleterRepository,
    contactLabelTemplateCreatorRepository,
    contactChannelsUpdaterTransactionRepository,
  };
}

describe('ContactUpdaterRepository', () => {
  it('updates labels/channels in transaction and updates contact', async () => {
    const {
      repository,
      tx,
      txSet,
      contactLabelTemplateDeleterRepository,
      contactLabelTemplateCreatorRepository,
      contactChannelsUpdaterTransactionRepository,
    } = createRepository();

    await expect(
      repository.updateContactById(
        'contact-1',
        {
          name: 'New Name',
          label_template_ids: ['label-1', 'label-2'],
          channel_ids: ['channel-1'],
        } as never,
        'acc-1'
      )
    ).resolves.toBe(true);

    expect(
      contactLabelTemplateDeleterRepository.deleteContactLabelTemplatesByContactId
    ).toHaveBeenCalledWith(tx, 'contact-1');
    expect(
      contactLabelTemplateCreatorRepository.createContactLabelTemplate
    ).toHaveBeenCalledTimes(2);
    expect(
      contactChannelsUpdaterTransactionRepository.updateContactChannels
    ).toHaveBeenCalledWith('contact-1', 'acc-1', ['channel-1']);
    expect(txSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Name',
        is_valided: false,
      })
    );
  });

  it('updates channels without label transaction path', async () => {
    const {
      repository,
      dbSet,
      contactLabelTemplateDeleterRepository,
      contactChannelsUpdaterTransactionRepository,
    } = createRepository();

    await expect(
      repository.updateContactById(
        'contact-1',
        {
          phone: '11999999999',
          phone_partial: '9999',
          phone_c: 'hash-phone',
          channel_ids: ['channel-1', 'channel-2'],
        } as never,
        'acc-1'
      )
    ).resolves.toBe(true);

    expect(
      contactLabelTemplateDeleterRepository.deleteContactLabelTemplatesByContactId
    ).not.toHaveBeenCalled();
    expect(
      contactChannelsUpdaterTransactionRepository.updateContactChannels
    ).toHaveBeenCalledWith('contact-1', 'acc-1', ['channel-1', 'channel-2']);
    expect(dbSet).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '11999999999',
        phone_partial: '9999',
        phone_c: 'hash-phone',
      })
    );
  });

  it('validateContact sets validation fields and returns true when rowCount is 1', async () => {
    const { repository, dbSet } = createRepository();

    await expect(
      repository.validateContact('contact-1', {
        phone_ddi: '55',
        phone: '11999999999',
        phone_partial: '9999',
        phone_c: 'hash-phone',
      } as never)
    ).resolves.toBe(true);

    expect(dbSet).toHaveBeenCalledWith(
      expect.objectContaining({
        phone_ddi: '55',
        phone: '11999999999',
        phone_partial: '9999',
        phone_c: 'hash-phone',
        is_valided: true,
      })
    );
  });

  it('updateContactIsValided returns false when no rows are updated', async () => {
    const { repository } = createRepository({ dbRowCount: 0 });

    await expect(
      repository.updateContactIsValided('contact-1', true)
    ).resolves.toBe(false);
  });
});
