import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { MessageTemplateCreatorRepository } from '@core/repositories/messageTemplate/MessageTemplateCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createRepository(options?: {
  firstInsertResult?: unknown;
  secondInsertResult?: unknown;
}) {
  const firstInsertResult =
    options && 'firstInsertResult' in options
      ? options.firstInsertResult
      : { rowCount: 1 };
  const secondInsertResult =
    options && 'secondInsertResult' in options
      ? options.secondInsertResult
      : { rowCount: 1 };

  const firstExecute = jest.fn(async () => firstInsertResult);
  const firstValues = jest.fn(() => ({ execute: firstExecute }));

  const secondExecute = jest.fn(async () => secondInsertResult);
  const onConflictDoNothing = jest.fn(() => ({ execute: secondExecute }));
  const secondValues = jest.fn(() => ({ onConflictDoNothing }));

  const insert = jest
    .fn()
    .mockImplementationOnce(() => ({ values: firstValues }))
    .mockImplementation(() => ({ values: secondValues }));

  const dbRw = { insert };

  return {
    repository: new MessageTemplateCreatorRepository(dbRw as never),
    insert,
    firstValues,
    secondValues,
    onConflictDoNothing,
  };
}

describe('MessageTemplateCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('message-template-id');
  });

  it('returns null when template insert fails', async () => {
    const { repository, insert } = createRepository({
      firstInsertResult: null,
    });

    await expect(
      repository.createMessageTemplate({ account_id: 'acc-1' } as never)
    ).resolves.toBeNull();
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('creates template without channel mapping when channel ids are not provided', async () => {
    const { repository, firstValues, secondValues } = createRepository();

    await expect(
      repository.createMessageTemplate({
        account_id: 'acc-1',
        message_status_id: 'status-1',
        command: '/start',
        message: 'hello',
        type: 'text',
      } as never)
    ).resolves.toBe('message-template-id');

    expect(firstValues).toHaveBeenCalledWith(
      expect.objectContaining({
        message_template_id: 'message-template-id',
        account_id: 'acc-1',
        auto_send: false,
      })
    );
    expect(secondValues).not.toHaveBeenCalled();
  });

  it('creates channel mappings when channel ids exist', async () => {
    const { repository, secondValues, onConflictDoNothing } =
      createRepository();

    await expect(
      repository.createMessageTemplate({
        account_id: 'acc-1',
        message_status_id: 'status-1',
        command: '/start',
        message: 'hello',
        type: 'text',
        channel_ids: ['ch-1', 'ch-2'],
      } as never)
    ).resolves.toBe('message-template-id');

    expect(secondValues).toHaveBeenCalledWith([
      { message_template_id: 'message-template-id', channel_id: 'ch-1' },
      { message_template_id: 'message-template-id', channel_id: 'ch-2' },
    ]);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});
