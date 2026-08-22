import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import type { IChat } from '@core/common/interfaces/IChat';
import { ChatService } from '@core/services/chat.service';

describe('ChatService pending operator reply redistribution contract', () => {
  const account = {
    id: '01900000-0000-7000-8000-000000000001',
    name: 'Account',
  };
  const worker = {
    id: '01900000-0000-7000-8000-000000000002',
    name: 'Channel',
  };
  const sector = {
    id: '01900000-0000-7000-8000-000000000003',
    name: 'Sales',
  };
  const firstEventId = '01900000-0000-7000-8000-000000000101';
  const secondEventId = '01900000-0000-7000-8000-000000000102';
  const firstEventEpoch = Date.parse('2026-07-26T12:15:00.000Z');
  const secondEventEpoch = Date.parse('2026-07-26T12:30:00.000Z');
  const pendingSince = '2026-07-26T12:00:00.000Z';

  const originalChat: IChat = {
    chat_id: 'chat-1',
    account,
    worker,
    sector,
    user: { id: 'user-a', name: 'Operator A' },
    secondary_users: [
      { id: 'legacy-secondary', name: 'Legacy secondary operator' },
    ],
    status: EChatStatus.in_chat,
    date: pendingSince,
    started_at: pendingSince,
    name: 'Contact',
    phone: '5511999999999',
    summary: {
      revision: 1,
      last_message: 'Olá',
      last_date: pendingSince,
      last_message_id: 'message-1',
      operator_reply_pending_since: pendingSince,
      unread_count: 1,
    },
    meta: {
      assignment_event_id: null,
      assignment_epoch: null,
      status_event_id: null,
      status_epoch: null,
    },
  };

  const redistributedToB: IChat = {
    ...originalChat,
    user: {
      id: 'user-b',
      name: 'Operator B',
      entered_at: new Date(firstEventEpoch).toISOString(),
    },
    secondary_users: [],
    meta: {
      ...originalChat.meta,
      assignment_event_id: firstEventId,
      assignment_epoch: firstEventEpoch,
      outbound_webhook_event_ids: [firstEventId],
    },
  };

  const redistributedToC: IChat = {
    ...redistributedToB,
    user: {
      id: 'user-c',
      name: 'Operator C',
      entered_at: new Date(secondEventEpoch).toISOString(),
    },
    secondary_users: [],
    meta: {
      ...redistributedToB.meta,
      assignment_event_id: secondEventId,
      assignment_epoch: secondEventEpoch,
      outbound_webhook_event_ids: [firstEventId, secondEventId],
    },
  };

  it('keeps only the latest primary in persistence and public transfer snapshots across redistributions', async () => {
    const redis = { del: jest.fn().mockResolvedValue(1) };
    const elasticDatabaseService = {
      updateWithScriptOCC: jest.fn().mockResolvedValue('updated'),
      getById: jest
        .fn()
        .mockResolvedValueOnce(redistributedToB)
        .mockResolvedValueOnce(redistributedToC),
    };
    const preparedEventIds = [firstEventId, secondEventId];
    const outboundWebhookEventService = {
      prepareBestEffort: jest
        .fn()
        .mockImplementation(async (input: Record<string, unknown>) => {
          const eventId = preparedEventIds.shift() as string;
          return {
            eventId,
            envelope: {
              id: eventId,
              type: input.eventType,
              api_version: '1',
              occurred_at: '2026-07-26T12:00:00.000Z',
              account_id: account.id,
              aggregate: input.aggregate,
              data: input.data,
            },
            created: true,
            state: 'preparing',
          };
        }),
      completeBestEffort: jest.fn().mockResolvedValue(true),
      cancel: jest.fn().mockResolvedValue(true),
    };
    const service = new ChatService(
      redis as never,
      elasticDatabaseService as never,
      {} as never,
      {} as never,
      outboundWebhookEventService as never
    );

    const firstResult = await service.reassignPendingOperatorReply({
      accountId: account.id,
      chat: originalChat,
      nextUser: { id: 'user-b', name: 'Operator B' },
      eventId: firstEventId,
      eventEpochMillis: firstEventEpoch,
      expectedPrimaryUserId: 'user-a',
      expectedAssignmentEventId: null,
      expectedAssignmentEpoch: null,
      expectedStatusEventId: null,
      expectedStatusEpoch: null,
      expectedLastMessageId: 'message-1',
      expectedSummaryRevision: 1,
      expectedPendingSince: pendingSince,
    });
    const secondResult = await service.reassignPendingOperatorReply({
      accountId: account.id,
      chat: firstResult.chat as IChat,
      nextUser: { id: 'user-c', name: 'Operator C' },
      eventId: secondEventId,
      eventEpochMillis: secondEventEpoch,
      expectedPrimaryUserId: 'user-b',
      expectedAssignmentEventId: firstEventId,
      expectedAssignmentEpoch: firstEventEpoch,
      expectedStatusEventId: null,
      expectedStatusEpoch: null,
      expectedLastMessageId: 'message-1',
      expectedSummaryRevision: 1,
      expectedPendingSince: pendingSince,
    });

    expect(firstResult).toEqual({
      applied: true,
      chat: expect.objectContaining({
        user: expect.objectContaining({ id: 'user-b' }),
        secondary_users: [],
      }),
    });
    expect(secondResult).toEqual({
      applied: true,
      chat: expect.objectContaining({
        user: expect.objectContaining({ id: 'user-c' }),
        secondary_users: [],
      }),
    });

    for (const [, , mutation] of elasticDatabaseService.updateWithScriptOCC.mock
      .calls) {
      expect(mutation.source).toContain('ctx._source.secondary_users = [];');
      expect(mutation.source).not.toContain('params.previous_user');
      expect(mutation.params).not.toHaveProperty('previous_user');
    }
    expect(
      elasticDatabaseService.updateWithScriptOCC.mock.calls.map(
        ([index, , mutation]) => ({
          index,
          nextUserId: mutation.params.next_user.id,
        })
      )
    ).toEqual([
      { index: EElasticIndex.chat, nextUserId: 'user-b' },
      { index: EElasticIndex.chat, nextUserId: 'user-c' },
    ]);

    expect(
      outboundWebhookEventService.prepareBestEffort
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          chat: expect.objectContaining({
            user: expect.objectContaining({ id: 'user-b' }),
            secondary_users: [],
          }),
        }),
        previous: {
          chat: expect.objectContaining({
            user: expect.objectContaining({ id: 'user-a' }),
            secondary_users: [
              expect.objectContaining({ id: 'legacy-secondary' }),
            ],
          }),
        },
      })
    );
    expect(
      outboundWebhookEventService.prepareBestEffort
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          chat: expect.objectContaining({
            user: expect.objectContaining({ id: 'user-c' }),
            secondary_users: [],
          }),
        }),
        previous: {
          chat: expect.objectContaining({
            user: expect.objectContaining({ id: 'user-b' }),
            secondary_users: [],
          }),
        },
      })
    );
    expect(
      outboundWebhookEventService.completeBestEffort
    ).toHaveBeenCalledTimes(2);
    expect(redis.del).toHaveBeenCalledTimes(4);
  });
});
