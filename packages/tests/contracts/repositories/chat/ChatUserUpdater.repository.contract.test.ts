import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { ChatUserUpdaterRepository } from '@core/repositories/chat/ChatUserUpdater.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createUpdateStep(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));

  return { set };
}

function createInsertStep(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const values = jest.fn(() => ({ execute }));

  return { values };
}

function createCountStep(total: number) {
  const execute = jest.fn(async () => [{ total }]);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ChatUserUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('chat-user-id-1');
  });

  it('updateChatUserById returns false when input has no mutable fields', async () => {
    const updateStep = createUpdateStep(1);
    const tx = {
      update: jest.fn(() => ({ set: updateStep.set })),
    };
    const repository = new ChatUserUpdaterRepository({} as never);

    await expect(
      repository.updateChatUserById(tx as never, 'user-1', {} as never)
    ).resolves.toBe(false);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('updateChatUserById applies update fields and returns status', async () => {
    const updateStep = createUpdateStep(1);
    const tx = {
      update: jest.fn(() => ({ set: updateStep.set })),
    };
    const repository = new ChatUserUpdaterRepository({} as never);

    await expect(
      repository.updateChatUserById(tx as never, 'user-1', {
        about: 'my profile',
        notifications_push: true,
      } as never)
    ).resolves.toBe(true);
    expect(updateStep.set).toHaveBeenCalledWith(
      expect.objectContaining({
        about: 'my profile',
        notifications_push: true,
      })
    );
  });

  it('addChatUserById inserts a row and returns operation status', async () => {
    const insertStep = createInsertStep(1);
    const tx = {
      insert: jest.fn(() => ({ values: insertStep.values })),
    };
    const repository = new ChatUserUpdaterRepository({} as never);

    await expect(
      repository.addChatUserById(tx as never, 'user-1', {
        notifications: false,
      } as never)
    ).resolves.toBe(true);
    expect(insertStep.values).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_user_id: 'chat-user-id-1',
        user_id: 'user-1',
        notifications: false,
      })
    );
  });

  it('checkExistsUserByid reads count from transaction', async () => {
    const countStep = createCountStep(1);
    const tx = {
      select: countStep.select,
    };
    const repository = new ChatUserUpdaterRepository({} as never);

    await expect(
      repository.checkExistsUserByid(tx as never, 'user-1')
    ).resolves.toBe(true);
  });

  it('updateChatUser uses update path when user exists and add path otherwise', async () => {
    const transaction = jest
      .fn()
      .mockImplementationOnce(async (cb: (tx: unknown) => Promise<boolean>) =>
        cb({ txId: 1 })
      )
      .mockImplementationOnce(async (cb: (tx: unknown) => Promise<boolean>) =>
        cb({ txId: 2 })
      );
    const repository = new ChatUserUpdaterRepository({
      transaction,
    } as never);

    const checkSpy = jest
      .spyOn(repository, 'checkExistsUserByid')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const updateSpy = jest
      .spyOn(repository, 'updateChatUserById')
      .mockResolvedValue(true);
    const addSpy = jest
      .spyOn(repository, 'addChatUserById')
      .mockResolvedValue(true);

    await expect(
      repository.updateChatUser('user-1', {} as never)
    ).resolves.toBe(true);
    await expect(
      repository.updateChatUser('user-1', {} as never)
    ).resolves.toBe(true);

    expect(checkSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledTimes(1);
  });
});
