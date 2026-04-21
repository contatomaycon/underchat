import 'reflect-metadata';
import { ChatClosureCommentCreatorRepository } from '@core/repositories/chat/ChatClosureCommentCreator.repository';

describe('ChatClosureCommentCreatorRepository', () => {
  it('inserts closure comment payload', async () => {
    const values = jest.fn(async () => ({ rowCount: 1 }));
    const dbRw = {
      insert: jest.fn(() => ({ values })),
    };
    const repository = new ChatClosureCommentCreatorRepository(dbRw as never);

    await repository.create({
      accountId: 'acc-1',
      chatId: 'chat-1',
      userId: 'user-1',
      comment: 'resolved',
      closedAt: '2026-01-01T10:00:00.000Z',
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acc-1',
        chat_id: 'chat-1',
        user_id: 'user-1',
        comment: 'resolved',
        closed_at: '2026-01-01T10:00:00.000Z',
        created_at: expect.any(String),
        updated_at: expect.any(String),
      })
    );
  });
});
