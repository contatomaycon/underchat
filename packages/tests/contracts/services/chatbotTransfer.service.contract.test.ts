import 'reflect-metadata';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import type { IChat } from '@core/common/interfaces/IChat';
import { ChatbotTransferService } from '@core/services/chatbotTransfer.service';

describe('ChatbotTransferService', () => {
  const t = jest.fn((key: string) => key) as never;
  const inputChatbotId = '0198c5a8-8c31-7a7a-8c26-1d8b6546b222';
  const outputChatbotId = '0198c5a8-8c31-7a7a-8c26-1d8b6546b333';
  const workerId = '0198c5a8-8c31-7a7a-8c26-1d8b6546b111';

  function makeService(status = EChatStatus.in_chat) {
    const chat = {
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Conta' },
      worker: { id: workerId, name: 'Canal' },
      user: { id: 'user-1', name: 'Atendente' },
      secondary_users: [{ id: 'user-2', name: 'Secundário' }],
      sector: { id: 'sector-1', name: 'Suporte' },
      phone: '5511999999999',
      name: 'Contato',
      status,
      date: '2026-08-19T10:00:00.000Z',
      summary: {
        revision: 4,
        last_message: 'oi',
        last_date: '2026-08-19T10:00:00.000Z',
        last_message_id: 'message-1',
        unread_count: 1,
      },
      meta: {},
    } as IChat;
    const chatService = {
      viewWorkerConfigForChat: jest.fn(async () => ({
        input_chatbot: {
          chatbot_id: inputChatbotId,
          name: 'Entrada',
          type: 'input',
        },
        output_chatbot: {
          chatbot_id: outputChatbotId,
          name: 'Saída',
          type: 'output',
        },
      })),
      findChatByChatId: jest.fn(async () => chat),
      findOpenChatByIdentity: jest.fn(async () => null),
      applyChatPatch: jest.fn(async (_chatId, patch, options) => {
        Object.assign(chat, patch);
        chat.meta = {
          ...chat.meta,
          status_event_id: options.eventId,
          status_epoch: options.eventEpochMillis,
          assignment_event_id: options.eventId,
          assignment_epoch: options.eventEpochMillis,
        };
        return true;
      }),
      clearChatSummary: jest.fn(async () => {
        if (chat.summary) {
          chat.summary.unread_count = 0;
          chat.summary.revision = (chat.summary.revision ?? 0) + 1;
        }
        return true;
      }),
      invalidateChatCache: jest.fn(async () => undefined),
    };
    const workerService = {
      viewWorkerNameAndId: jest.fn(async () => ({
        id: workerId,
        name: 'Canal',
      })),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const redis = {
      del: jest.fn(async () => 1),
      status: 'ready',
      set: jest.fn(async () => 'OK'),
      eval: jest.fn(async () => 1),
    };
    const tracker = {
      handleChatTransition: jest.fn(async () => undefined),
    };
    return {
      service: new ChatbotTransferService(
        chatService as never,
        workerService as never,
        centrifugoService as never,
        redis as never,
        tracker as never
      ),
      chat,
      chatService,
      centrifugoService,
    };
  }

  it.each([
    [inputChatbotId, EChatStatus.ura, inputChatbotId],
    [outputChatbotId, EChatStatus.ura_output, null],
  ])(
    'applies the canonical transition for chatbot %s',
    async (chatbotId, expectedStatus, expectedTransferId) => {
      const { service, chat, chatService, centrifugoService } = makeService();
      const result = await service.transfer({
        t,
        accountId: 'account-1',
        chat,
        targetWorkerId: workerId,
        targetChatbotId: chatbotId,
        operationId: 'operation-1',
        eventEpochMillis: 1_776_000_000_000,
        source: 'manager_api',
        actor: { type: 'user', id: 'user-1' },
      });

      expect(result.chat).toEqual(
        expect.objectContaining({
          status: expectedStatus,
          user: null,
          secondary_users: [],
          sector: null,
          forward_to_output_chatbot: false,
          chatbot_transfer_id: expectedTransferId,
          chatbot_schedule_id: null,
          chatbot_webhook_id: null,
        })
      );
      expect(chatService.applyChatPatch).toHaveBeenCalledWith(
        'chat-1',
        expect.any(Object),
        expect.objectContaining({
          enforceExpectedLastMessageId: true,
          enforceExpectedSummaryRevision: true,
          allowHumanToAutomation: true,
        })
      );
      expect(chatService.clearChatSummary).toHaveBeenCalledTimes(1);
      expect(centrifugoService.publishSub).toHaveBeenCalledTimes(2);
    }
  );

  it('does not repeat transition effects after the operation was persisted', async () => {
    const { service, chat, chatService, centrifugoService } = makeService(
      EChatStatus.ura
    );
    chat.meta = { assignment_event_id: 'operation-1' };
    chat.chatbot_transfer_id = inputChatbotId;
    const result = await service.transfer({
      t,
      accountId: 'account-1',
      chat,
      targetWorkerId: workerId,
      targetChatbotId: inputChatbotId,
      operationId: 'operation-1',
      eventEpochMillis: 1_776_000_000_000,
      source: 'chatbot_inactivity',
      actor: { type: 'automation', id: inputChatbotId },
    });

    expect(result.transitioned).toBe(false);
    expect(chatService.applyChatPatch).not.toHaveBeenCalled();
    expect(chatService.clearChatSummary).toHaveBeenCalledTimes(1);
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('retries when the summary effect was not persisted and no activity changed it', async () => {
    const { service, chat, chatService } = makeService(EChatStatus.ura);
    chat.meta = { assignment_event_id: 'operation-1' };
    chat.chatbot_transfer_id = inputChatbotId;
    chatService.clearChatSummary.mockResolvedValueOnce(false);

    await expect(
      service.transfer({
        t,
        accountId: 'account-1',
        chat,
        targetWorkerId: workerId,
        targetChatbotId: inputChatbotId,
        operationId: 'operation-1',
        eventEpochMillis: 1_776_000_000_000,
        source: 'chatbot_inactivity',
        actor: { type: 'automation', id: inputChatbotId },
        expectedLastMessageId: 'message-1',
        expectedSummaryRevision: 4,
      })
    ).rejects.toThrow('chat_transfer_failed');
  });

  it('reports concurrent activity without clearing or replaying transition effects', async () => {
    const { service, chat, chatService, centrifugoService } = makeService(
      EChatStatus.ura
    );
    chat.meta = { assignment_event_id: 'operation-1' };
    chat.chatbot_transfer_id = inputChatbotId;
    chatService.clearChatSummary.mockImplementationOnce(async () => {
      if (chat.summary) chat.summary.last_message_id = 'message-2';
      return false;
    });

    const result = await service.transfer({
      t,
      accountId: 'account-1',
      chat,
      targetWorkerId: workerId,
      targetChatbotId: inputChatbotId,
      operationId: 'operation-1',
      eventEpochMillis: 1_776_000_000_000,
      source: 'chatbot_inactivity',
      actor: { type: 'automation', id: inputChatbotId },
      expectedLastMessageId: 'message-1',
      expectedSummaryRevision: 4,
    });

    expect(result.concurrentActivity).toBe(true);
    expect(chatService.applyChatPatch).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });
});
