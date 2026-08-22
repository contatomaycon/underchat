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
  const from = jest.fn(() => ({ innerJoin, where }));
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

  it('lists only the unread conversation projection needed by realtime clients', async () => {
    const { dbRo, select } = createUnreadSummaryDb([
      { conversation_id: 'conversation-1', unread_count: 4 },
      { conversation_id: 'conversation-2', unread_count: 2 },
    ]);
    const repository = new InternalChatConversationRepository(
      dbRo as never,
      {} as never
    );

    await expect(
      repository.listUnreadOpenConversationsForUser('account-1', 'user-1')
    ).resolves.toEqual([
      { conversation_id: 'conversation-1', unread_count: 4 },
      { conversation_id: 'conversation-2', unread_count: 2 },
    ]);

    expect(select).toHaveBeenCalledWith({
      conversation_id:
        internalChatConversationParticipant.internal_chat_conversation_id,
      unread_count: internalChatConversationParticipant.unread_count,
    });
  });

  it('lists only participant unread state for realtime synchronization', async () => {
    const { dbRo, select } = createUnreadSummaryDb([
      { user_id: 'user-1', unread_count: 3, closed_at: null },
      {
        user_id: 'user-2',
        unread_count: 0,
        closed_at: '2026-08-11T12:00:00.000Z',
      },
    ]);
    const repository = new InternalChatConversationRepository(
      dbRo as never,
      dbRo as never
    );

    await expect(
      repository.listParticipantUnreadStates('conversation-1')
    ).resolves.toEqual([
      { user_id: 'user-1', unread_count: 3, closed_at: null },
      {
        user_id: 'user-2',
        unread_count: 0,
        closed_at: '2026-08-11T12:00:00.000Z',
      },
    ]);

    expect(select).toHaveBeenCalledWith({
      user_id: internalChatConversationParticipant.user_id,
      unread_count: internalChatConversationParticipant.unread_count,
      closed_at: internalChatConversationParticipant.closed_at,
    });
  });
});
