import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

import type { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ChatForwardToOutputChatbotUpdaterUseCase } from '@core/useCases/chat/ChatForwardToOutputChatbotUpdater.useCase';

const accountId = '01900000-0000-7000-8000-000000000001';
const chatId = '01900000-0000-7000-8000-000000000002';
const translate = ((key: string) => key) as never;

const makeChat = (revision: string, forward = false): IChat =>
  ({
    chat_id: chatId,
    account: { id: accountId, name: 'Conta' },
    worker: { id: 'worker-1', name: 'Canal' },
    status: EChatStatus.in_chat,
    name: 'Cliente',
    phone: '5561999999999',
    date: '2026-07-10T20:00:00.000Z',
    forward_to_output_chatbot: forward,
    meta: { outbound_webhook_event_ids: [revision] },
  }) as IChat;

describe('ChatForwardToOutputChatbotUpdaterUseCase webhook identity', () => {
  it('persists the source received from the public API controller', async () => {
    const chat = makeChat('webhook-event-1');
    const updatedChat = makeChat('webhook-event-result', true);
    const chatService = {
      findChatByChatId: jest
        .fn()
        .mockResolvedValueOnce(chat)
        .mockResolvedValueOnce(updatedChat),
      updateForwardToOutputChatbot: jest.fn<Promise<boolean>, unknown[]>(
        async () => true
      ),
    };
    const useCase = new ChatForwardToOutputChatbotUpdaterUseCase(
      chatService as never,
      { publishSub: jest.fn(async () => undefined) } as never
    );

    await useCase.execute(
      translate,
      accountId,
      { chat_id: chatId },
      { forward_to_output_chatbot: true },
      [],
      'user-1',
      'public_api'
    );

    expect(
      chatService.updateForwardToOutputChatbot.mock.calls[0]?.[2]
    ).toMatchObject({ source: 'public_api' });
  });

  it('deduplicates concurrent equivalent transitions and separates a later cycle', async () => {
    const firstSnapshot = makeChat('webhook-event-1');
    const laterCycleSnapshot = makeChat('webhook-event-2');
    const updatedChat = makeChat('webhook-event-result', true);
    const chatService = {
      findChatByChatId: jest
        .fn()
        .mockResolvedValueOnce(firstSnapshot)
        .mockResolvedValueOnce(updatedChat)
        .mockResolvedValueOnce(firstSnapshot)
        .mockResolvedValueOnce(updatedChat)
        .mockResolvedValueOnce(laterCycleSnapshot)
        .mockResolvedValueOnce(updatedChat),
      updateForwardToOutputChatbot: jest.fn<Promise<boolean>, unknown[]>(
        async () => true
      ),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
    };
    const useCase = new ChatForwardToOutputChatbotUpdaterUseCase(
      chatService as never,
      centrifugoService as never
    );

    await useCase.execute(
      translate,
      accountId,
      { chat_id: chatId },
      { forward_to_output_chatbot: true }
    );
    await useCase.execute(
      translate,
      accountId,
      { chat_id: chatId },
      { forward_to_output_chatbot: true }
    );
    await useCase.execute(
      translate,
      accountId,
      { chat_id: chatId },
      { forward_to_output_chatbot: true }
    );

    const keys = chatService.updateForwardToOutputChatbot.mock.calls.map(
      (call) =>
        (call[2] as { idempotencyKey: string } | undefined)?.idempotencyKey
    );
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toContain('webhook-event-1');
    expect(keys[2]).toContain('webhook-event-2');
    expect(keys[2]).not.toBe(keys[0]);
  });
});
