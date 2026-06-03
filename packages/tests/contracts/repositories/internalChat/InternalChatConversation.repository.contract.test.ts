import 'reflect-metadata';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

import {
  internalChatConversation,
  internalChatConversationParticipant,
} from '@core/models';
import { InternalChatConversationRepository } from '@core/repositories/internalChat/InternalChatConversation.repository';

function createUnreadSummaryDb(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const innerJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ innerJoin }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
    select,
    from,
    innerJoin,
    where,
    execute,
  };
}

describe('InternalChatConversationRepository', () => {
  it('sums unread messages for open active conversations of the current user', async () => {
    const { dbRo, select, from, innerJoin, where } = createUnreadSummaryDb([
      { unread_count: '7' },
    ]);
    const repository = new InternalChatConversationRepository(
      dbRo as never,
      {} as never
    );

    await expect(
      repository.sumUnreadOpenConversationsForUser('account-1', 'user-1')
    ).resolves.toBe(7);

    expect(select).toHaveBeenCalledWith({
      unread_count: expect.any(Object),
    });
    expect(from).toHaveBeenCalledWith(internalChatConversationParticipant);
    expect(innerJoin).toHaveBeenCalledWith(
      internalChatConversation,
      expect.any(Object)
    );
    expect(where).toHaveBeenCalledWith(expect.any(Object));
  });

  it('returns zero when the unread sum is empty', async () => {
    const { dbRo } = createUnreadSummaryDb([]);
    const repository = new InternalChatConversationRepository(
      dbRo as never,
      {} as never
    );

    await expect(
      repository.sumUnreadOpenConversationsForUser('account-1', 'user-1')
    ).resolves.toBe(0);
  });
});
