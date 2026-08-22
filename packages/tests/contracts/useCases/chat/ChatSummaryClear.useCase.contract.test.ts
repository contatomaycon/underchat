import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ChatSummaryClearUseCase } from '@core/useCases/chat/ChatSummaryClear.useCase';

describe('ChatSummaryClearUseCase revision contract', () => {
  it('publishes the exact summary revision observed by the authorized user', async () => {
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const kafkaServiceQueueService = {
      clearChatSummary: jest.fn(() => 'clear.chat.summary'),
    };
    const chatService = {
      findChatByChatId: jest.fn(async () => ({
        chat_id: 'chat-1',
        account: { id: 'account-1', name: 'Account' },
        worker: { id: 'worker-1', name: 'Worker' },
        user: { id: 'user-1', name: 'Operator' },
        name: 'Contact',
        phone: '5511999999999',
        status: EChatStatus.in_chat,
        date: '2026-07-16T12:00:00.000Z',
        summary: {
          revision: 19,
          last_message: 'message',
          last_date: '2026-07-16T12:00:00.000Z',
          last_message_id: 'message-19',
          unread_count: 4,
        },
      })),
    };
    const useCase = new ChatSummaryClearUseCase(
      streamProducerService as never,
      kafkaServiceQueueService as never,
      chatService as never
    );

    await expect(
      useCase.execute(((key: string) => key) as never, 'account-1', 'user-1', {
        chat_id: 'chat-1',
      })
    ).resolves.toBe(true);

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'clear.chat.summary',
      {
        chat_id: 'chat-1',
        account_id: 'account-1',
        operation_id: expect.any(String),
        expected_summary_revision: 19,
        expected_last_message_id: 'message-19',
      },
      'account-1:chat-1'
    );
  });

  it('represents a legacy missing revision as zero instead of sending an unguarded clear', async () => {
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const useCase = new ChatSummaryClearUseCase(
      streamProducerService as never,
      { clearChatSummary: () => 'clear.chat.summary' } as never,
      {
        findChatByChatId: jest.fn(async () => ({
          chat_id: 'chat-legacy',
          account: { id: 'account-1', name: 'Account' },
          worker: { id: 'worker-1', name: 'Worker' },
          user: { id: 'user-1', name: 'Operator' },
          name: 'Contact',
          phone: '5511999999999',
          status: EChatStatus.in_chat,
          date: '2026-07-16T12:00:00.000Z',
          summary: {
            last_message: null,
            last_date: null,
            unread_count: 0,
          },
        })),
      } as never
    );

    await useCase.execute(
      ((key: string) => key) as never,
      'account-1',
      'user-1',
      { chat_id: 'chat-legacy' }
    );

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'clear.chat.summary',
      expect.objectContaining({ expected_summary_revision: 0 }),
      'account-1:chat-legacy'
    );
  });
});
