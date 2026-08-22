import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { ContactLabelTemplateCreatorRepository } from '@core/repositories/contact/ContactLabelTemplateCreator.repository';

jest.mock('@core/repositories/contact/contactOutboundWebhookOutbox', () => ({
  lockContactOutboundWebhookSnapshotInTransaction: jest.fn(async () => null),
  markContactOutboundWebhookAppliedInTransaction: jest.fn(async () => {}),
}));

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('ContactLabelTemplateCreatorRepository', () => {
  const createLabelSelect = () => {
    const chain = {} as Record<string, jest.Mock>;
    for (const method of ['from', 'where', 'for', 'limit']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.execute = jest.fn(async () => [{ id: 'label-1' }]);
    return jest.fn(() => chain);
  };

  const createInsert = (result: unknown) => {
    const chain = {
      onConflictDoNothing: jest.fn(),
      returning: jest.fn(),
      execute: jest.fn(async () => result),
    };
    chain.onConflictDoNothing.mockReturnValue(chain);
    chain.returning.mockReturnValue(chain);
    return jest.fn(() => ({ values: jest.fn(() => chain) }));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue(
      'contact-label-template-id'
    );
  });

  it('creates label template in transaction and returns id', async () => {
    const insert = createInsert([{ id: 'contact-label-template-id' }]);
    const tx = { insert, select: createLabelSelect() };

    const repository = new ContactLabelTemplateCreatorRepository({} as never);

    await expect(
      repository.createContactLabelTemplate(
        tx as never,
        'contact-1',
        'label-1',
        'account-1'
      )
    ).resolves.toBe('contact-label-template-id');
  });

  it('returns null when transaction insert does not return result', async () => {
    const insert = createInsert([]);
    const tx = { insert, select: createLabelSelect() };

    const repository = new ContactLabelTemplateCreatorRepository({} as never);

    await expect(
      repository.createContactLabelTemplate(
        tx as never,
        'contact-1',
        'label-1',
        'account-1'
      )
    ).resolves.toBeNull();
  });

  it('creates label template without transaction and returns id', async () => {
    const insert = createInsert([{ id: 'contact-label-template-id' }]);
    const tx = { insert, select: createLabelSelect() };
    const dbRw = {
      transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx)
      ),
    };

    const repository = new ContactLabelTemplateCreatorRepository(dbRw as never);

    await expect(
      repository.createContactLabelTemplateWithoutTransaction(
        'contact-1',
        'label-1',
        'account-1'
      )
    ).resolves.toBe('contact-label-template-id');
  });
});
