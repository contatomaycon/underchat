import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';
import { ContactCreatorRepository } from '@core/repositories/contact/ContactCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createInsertChain(resultOrError: unknown, reject = false) {
  const execute = reject
    ? jest.fn(async () => Promise.reject(resultOrError))
    : jest.fn(async () => resultOrError);
  const values = jest.fn(() => ({ execute }));
  const insert = jest.fn(() => ({ values }));

  return {
    insert,
    values,
  };
}

function createRepository(options?: {
  dbInsertResult?: unknown;
  txInsertResult?: unknown;
  dbInsertReject?: boolean;
}) {
  const dbInsertChain = createInsertChain(
    options?.dbInsertResult ?? { rowCount: 1 },
    options?.dbInsertReject
  );
  const txInsertChain = createInsertChain(
    options?.txInsertResult ?? { rowCount: 1 }
  );

  const transactionTx = {
    insert: txInsertChain.insert,
  };

  const dbRw = {
    insert: dbInsertChain.insert,
    transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
      callback(transactionTx)
    ),
  };

  const contactGroupAssignmentCreatorRepository = {
    createContactGroupAssignment: jest.fn(async () => 'assignment-id'),
  };

  const contactLabelTemplateCreatorRepository = {
    createContactLabelTemplate: jest.fn(
      async () => 'contact-label-template-id'
    ),
  };

  const contactChannelCreatorRepository = {
    createContactChannelInTransaction: jest.fn(
      async () => 'contact-channel-id'
    ),
  };

  return {
    repository: new ContactCreatorRepository(
      dbRw as never,
      contactGroupAssignmentCreatorRepository as never,
      contactLabelTemplateCreatorRepository as never,
      contactChannelCreatorRepository as never
    ),
    dbRw,
    transactionTx,
    dbValues: dbInsertChain.values,
    contactGroupAssignmentCreatorRepository,
    contactLabelTemplateCreatorRepository,
    contactChannelCreatorRepository,
  };
}

describe('ContactCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('contact-id');
  });

  it('creates contact without transaction when no labels/channels are provided', async () => {
    const { repository, dbRw, dbValues } = createRepository();

    const result = await repository.createContact({
      account_id: 'acc-1',
      name: 'Contact Name',
      ignore: EContactIgnore.not_ignore,
    } as never);

    expect(result).toBe('contact-id');
    expect(dbRw.transaction).not.toHaveBeenCalled();
    expect(dbValues).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_id: 'contact-id',
        account_id: 'acc-1',
        name: 'Contact Name',
        is_valided: false,
      })
    );
  });

  it('creates contact with labels and channels in a transaction', async () => {
    const {
      repository,
      dbRw,
      transactionTx,
      contactLabelTemplateCreatorRepository,
      contactChannelCreatorRepository,
    } = createRepository();

    const result = await repository.createContact({
      account_id: 'acc-1',
      name: 'Contact Name',
      label_template_ids: ['label-1', ''],
      channel_ids: ['channel-1', ''],
    } as never);

    expect(result).toBe('contact-id');
    expect(dbRw.transaction).toHaveBeenCalledTimes(1);
    expect(
      contactLabelTemplateCreatorRepository.createContactLabelTemplate
    ).toHaveBeenCalledWith(transactionTx, 'contact-id', 'label-1');
    expect(
      contactChannelCreatorRepository.createContactChannelInTransaction
    ).toHaveBeenCalledWith(transactionTx, 'contact-id', 'channel-1', 'acc-1');
  });

  it('returns null when insert fails with field length error', async () => {
    const { repository } = createRepository({
      dbInsertResult: { code: '22001' },
      dbInsertReject: true,
    });

    await expect(
      repository.createContact({
        account_id: 'acc-1',
        name: 'Contact Name',
      } as never)
    ).resolves.toBeNull();
  });

  it('creates contact with group and returns true', async () => {
    const { repository, contactGroupAssignmentCreatorRepository } =
      createRepository();
    jest
      .spyOn(repository, 'createContact')
      .mockResolvedValueOnce('contact-id-from-create');

    await expect(
      repository.createContactWithGroup(
        jest.fn() as never,
        { account_id: 'acc-1', name: 'Contact Name' } as never,
        'group-1'
      )
    ).resolves.toBe(true);

    expect(
      contactGroupAssignmentCreatorRepository.createContactGroupAssignment
    ).toHaveBeenCalledWith(
      expect.anything(),
      'group-1',
      'contact-id-from-create'
    );
  });

  it('returns null when contact-group assignment creation fails', async () => {
    const { repository, contactGroupAssignmentCreatorRepository } =
      createRepository();
    jest.spyOn(repository, 'createContact').mockResolvedValueOnce('contact-id');
    (
      contactGroupAssignmentCreatorRepository.createContactGroupAssignment as jest.Mock
    ).mockResolvedValueOnce(null);

    await expect(
      repository.createContactWithGroup(
        jest.fn() as never,
        { account_id: 'acc-1', name: 'Contact Name' } as never,
        'group-1'
      )
    ).resolves.toBeNull();
  });

  it('returns null in createContactWithGroup when transaction throws 22001', async () => {
    const { repository, dbRw } = createRepository();
    (dbRw.transaction as jest.Mock).mockRejectedValueOnce({ code: '22001' });

    await expect(
      repository.createContactWithGroup(
        jest.fn() as never,
        { account_id: 'acc-1', name: 'Contact Name' } as never,
        null
      )
    ).resolves.toBeNull();
  });
});
