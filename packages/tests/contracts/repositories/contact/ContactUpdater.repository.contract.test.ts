import 'reflect-metadata';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

const mockAssertCurrentWhatsappRuntimeInTransaction = jest.fn(
  async () => undefined
);

jest.mock(
  '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository',
  () => {
    class StaleWhatsappRuntimeDatabaseFenceError extends Error {
      public readonly reason = 'whatsapp_runtime_database_fence_stale' as const;

      constructor() {
        super('WhatsApp runtime database fence is stale');
        this.name = 'StaleWhatsappRuntimeDatabaseFenceError';
      }
    }

    return {
      assertCurrentWhatsappRuntimeInTransaction:
        mockAssertCurrentWhatsappRuntimeInTransaction,
      StaleWhatsappRuntimeDatabaseFenceError,
    };
  }
);

import { ContactUpdaterRepository } from '@core/repositories/contact/ContactUpdater.repository';
import { StaleWhatsappRuntimeDatabaseFenceError } from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';

const runtimeFence = {
  account_id: 'acc-1',
  worker_id: 'worker-1',
  source_provider: 'baileys',
  runtime_generation: 7,
  connection_epoch: 'epoch-7',
};

function createUpdateChain(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn((_: unknown) => ({ where }));
  const update = jest.fn(() => ({ set }));

  return {
    update,
    set,
  };
}

function createRepository(options?: {
  txRowCount?: number;
  dbRowCount?: number;
  lockedContacts?: Array<{ contact_id: string }>;
}) {
  const txChain = createUpdateChain(options?.txRowCount ?? 1);
  const dbChain = createUpdateChain(options?.dbRowCount ?? 1);

  const lockExecute = jest.fn(
    async () => options?.lockedContacts ?? [{ contact_id: 'contact-1' }]
  );
  const lockChain = {} as Record<string, jest.Mock>;
  for (const method of ['from', 'where', 'for', 'limit']) {
    lockChain[method] = jest.fn(() => lockChain);
  }
  lockChain.execute = lockExecute;
  const tx = {
    update: txChain.update,
    select: jest.fn(() => lockChain),
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
    updateContactChannelsInTransaction: jest.fn(async () => true),
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
    txUpdate: txChain.update,
    dbSet: dbChain.set,
    contactLabelTemplateDeleterRepository,
    contactLabelTemplateCreatorRepository,
    contactChannelsUpdaterTransactionRepository,
  };
}

describe('ContactUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertCurrentWhatsappRuntimeInTransaction.mockResolvedValue(undefined);
  });

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
      contactChannelsUpdaterTransactionRepository.updateContactChannelsInTransaction
    ).toHaveBeenCalledWith(tx, 'contact-1', 'acc-1', ['channel-1']);
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
      tx,
      txSet,
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
      contactChannelsUpdaterTransactionRepository.updateContactChannelsInTransaction
    ).toHaveBeenCalledWith(tx, 'contact-1', 'acc-1', [
      'channel-1',
      'channel-2',
    ]);
    expect(txSet).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '11999999999',
        phone_partial: '9999',
        phone_c: 'hash-phone',
      })
    );
  });

  it('clears nickname when empty string is provided', async () => {
    const { repository, dbSet } = createRepository();

    await expect(
      repository.updateContactById('contact-1', { nickname: '' } as never)
    ).resolves.toBe(true);

    expect(dbSet).toHaveBeenCalledWith(
      expect.objectContaining({
        nickname: null,
      })
    );
  });

  it('does not include nickname in update when field is absent', async () => {
    const { repository, dbSet } = createRepository();

    await expect(
      repository.updateContactById('contact-1', {
        name: 'Contact Name',
      } as never)
    ).resolves.toBe(true);

    const firstCall = dbSet.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    const updatePayload = firstCall?.[0] as Record<string, unknown>;
    expect(updatePayload).not.toHaveProperty('nickname');
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

  it('sets provenance when validating and clears it when invalidating', async () => {
    const { repository, dbSet } = createRepository();

    await repository.updateContactIsValided(
      'contact-1',
      true,
      undefined,
      undefined,
      undefined,
      'official_assumed'
    );
    expect(dbSet).toHaveBeenLastCalledWith({
      is_valided: true,
      validation_origin: 'official_assumed',
    });

    await repository.updateContactIsValided('contact-1', false);
    expect(dbSet).toHaveBeenLastCalledWith({
      is_valided: false,
      validation_origin: null,
    });
  });

  it('validates worker ownership and generation in the contact transaction', async () => {
    const { repository, dbRw, tx } = createRepository();

    await expect(
      repository.updateContactIsValided(
        'contact-1',
        true,
        'acc-1',
        null,
        runtimeFence
      )
    ).resolves.toBe(true);

    expect(dbRw.transaction).toHaveBeenCalledTimes(1);
    expect(mockAssertCurrentWhatsappRuntimeInTransaction).toHaveBeenCalledWith(
      tx,
      runtimeFence
    );
    expect(
      mockAssertCurrentWhatsappRuntimeInTransaction.mock.invocationCallOrder[0]
    ).toBeLessThan(tx.update.mock.invocationCallOrder[0]);
  });

  it('does not mutate a contact after its runtime generation is replaced', async () => {
    const { repository, txUpdate } = createRepository();
    mockAssertCurrentWhatsappRuntimeInTransaction.mockRejectedValueOnce(
      new StaleWhatsappRuntimeDatabaseFenceError()
    );

    await expect(
      repository.updateContactById(
        'contact-1',
        { name: 'stale mutation' } as never,
        'acc-1',
        null,
        runtimeFence
      )
    ).rejects.toBeInstanceOf(StaleWhatsappRuntimeDatabaseFenceError);

    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('rejects a mismatched account before starting the transaction', async () => {
    const { repository, dbRw } = createRepository();

    await expect(
      repository.updateContactIsValided(
        'contact-1',
        true,
        'another-account',
        null,
        runtimeFence
      )
    ).rejects.toBeInstanceOf(StaleWhatsappRuntimeDatabaseFenceError);

    expect(dbRw.transaction).not.toHaveBeenCalled();
  });

  it('does not update a contact owned by another account', async () => {
    const { repository, txUpdate } = createRepository({
      lockedContacts: [],
    });

    await expect(
      repository.updateContactIsValided(
        'contact-from-another-account',
        true,
        'acc-1',
        null,
        runtimeFence
      )
    ).rejects.toThrow('outbound_webhook_contact_not_mutable');

    expect(txUpdate).not.toHaveBeenCalled();
  });
});
