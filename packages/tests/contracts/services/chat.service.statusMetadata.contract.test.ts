import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ChatService } from '@core/services/chat.service';

describe('ChatService status metadata patch', () => {
  const makeService = () => {
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      updateWithScriptOCC: jest.fn(async () => 'updated'),
    };
    const service = new ChatService(
      { del: jest.fn() } as never,
      elasticDatabaseService as never,
      {} as never,
      {} as never
    );

    return { service, elasticDatabaseService };
  };

  it('adds an ordered revision, source and atomic unread reset to every status patch', async () => {
    const { service, elasticDatabaseService } = makeService();

    await expect(
      service.applyChatPatch(
        'chat-1',
        { status: EChatStatus.closed },
        {
          allowCreate: false,
          clearUnreadCount: true,
          expectedCurrentStatuses: [EChatStatus.in_chat],
          statusSource: 'chatbot',
          enforceExpectedStatusRevision: true,
          enforceExpectedLastMessageId: true,
          enforceExpectedSummaryRevision: true,
          expectedLastMessageId: 'message-1',
          expectedSummaryRevision: 4,
        }
      )
    ).resolves.toBe(true);

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-1',
      expect.objectContaining({
        source: expect.stringContaining('clearSummary.unread_count = 0'),
        params: expect.objectContaining({
          patch: { status: EChatStatus.closed },
          event_epoch_millis: expect.any(Number),
          event_id: expect.any(String),
          status_source: 'chatbot',
          clear_unread_count: true,
          expected_current_statuses: [EChatStatus.in_chat],
          enforce_expected_status_revision: true,
          enforce_expected_last_message_id: true,
          enforce_expected_summary_revision: true,
          expected_last_message_id: 'message-1',
          expected_summary_revision: 4,
        }),
      }),
      expect.objectContaining({
        upsert: false,
      })
    );
  });

  it('uses a default source and revision for legacy updateChatStatus callers', async () => {
    const { service, elasticDatabaseService } = makeService();

    await service.updateChatStatus('chat-1', EChatStatus.closed);

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-1',
      expect.objectContaining({
        params: expect.objectContaining({
          event_epoch_millis: expect.any(Number),
          event_id: expect.any(String),
          status_source: 'chat_service',
        }),
      }),
      expect.any(Object)
    );
  });
});
