import 'reflect-metadata';
jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IChat } from '@core/common/interfaces/IChat';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { ChatMessageEditorUseCase } from '@core/useCases/chat/ChatMessageEditor.useCase';

describe('ChatMessageEditorUseCase official channel', () => {
  it('blocks official edits before updating local message content', async () => {
    const chat: IChat = {
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'Official' },
      user: { id: 'user-1', name: 'Agent' },
      name: 'Maycon',
      phone: '5511999999999',
      status: EChatStatus.queue,
      date: '2026-06-01T10:00:00.000Z',
    };
    const message: IChatMessage = {
      message_id: 'message-1',
      chat_id: chat.chat_id,
      message_key: {
        id: 'wamid.message',
        remote_jid: '5511999999999@s.whatsapp.net',
        is_view_once: false,
      },
      type_user: ETypeUserChat.operator,
      account: chat.account,
      worker: chat.worker,
      user: chat.user,
      phone: chat.phone,
      summary: {
        is_sent: true,
        is_delivered: true,
        is_seen: false,
        is_sent_to_internal: true,
      },
      date: new Date().toISOString(),
      content: {
        type: EMessageType.text,
        message: 'Antes',
      },
    };
    const chatService = {
      findMessageByMessageId: jest.fn(async () => message),
      findChatByChatId: jest.fn(async () => chat),
      updateMessageContent: jest.fn(async () => true),
    };
    const useCase = new ChatMessageEditorUseCase(
      chatService as never,
      { admit: jest.fn(async () => undefined) } as never,
      {
        viewWorkerType: jest.fn(async () => ({
          worker_type_id: EWorkerType.whatsapp,
        })),
      } as never
    );

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        { chat_id: 'chat-1', message_id: 'message-1' },
        { message: 'Depois', operation_id: 'edit-operation-1' },
        'user-1'
      )
    ).rejects.toThrow('whatsapp_official_edit_message_not_supported');

    expect(chatService.updateMessageContent).not.toHaveBeenCalled();
  });

  it('attributes public API edits and records their origin', async () => {
    const chat: IChat = {
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'Baileys' },
      user: { id: 'user-1', name: 'Agent' },
      name: 'Maycon',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: new Date().toISOString(),
    };
    const message: IChatMessage = {
      message_id: 'message-1',
      chat_id: chat.chat_id,
      message_key: {
        id: 'provider-message-1',
        remote_jid: '5511999999999@s.whatsapp.net',
        is_view_once: false,
      },
      type_user: ETypeUserChat.operator,
      account: chat.account,
      worker: chat.worker,
      user: chat.user,
      phone: chat.phone,
      summary: {
        is_sent: true,
        is_delivered: true,
        is_seen: false,
        is_sent_to_internal: true,
      },
      date: new Date().toISOString(),
      content: { type: EMessageType.text, message: 'Antes' },
    };
    let currentMessage = message;
    const chatService = {
      findMessageByMessageId: jest.fn(async () => currentMessage),
      findChatByChatId: jest.fn(async () => chat),
      updateMessageChat: jest.fn(async (nextMessage: IChatMessage) => {
        currentMessage = nextMessage;
        return true;
      }),
    };
    const workerCommandAdmissionService = {
      admit: jest.fn(async () => ({
        receipt: { stream_sequence: 1, duplicate: false },
      })),
    };
    const useCase = new ChatMessageEditorUseCase(
      chatService as never,
      workerCommandAdmissionService as never,
      {
        viewWorkerType: jest.fn(async () => ({
          worker_type_id: EWorkerType.baileys,
        })),
      } as never
    );

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        chat.account.id,
        { chat_id: chat.chat_id, message_id: message.message_id },
        { message: 'Depois', operation_id: 'edit-operation-1' },
        chat.user?.id ?? 'user-1',
        [],
        'public_api'
      )
    ).resolves.toBe(true);

    expect(chatService.updateMessageChat).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: message.message_id }),
      expect.objectContaining({
        source: 'public_api',
        changes: expect.objectContaining({ origin: 'public_api' }),
      })
    );
    expect(workerCommandAdmissionService.admit).toHaveBeenCalledWith({
      accountId: 'account-1',
      workerId: 'worker-1',
      commandType: 'direct_send',
      entityKey: 'chat:account-1:worker-1:5511999999999@s.whatsapp.net',
      operationId: 'edit-operation-1',
      retryOf: null,
      payload: expect.objectContaining({
        message_id: 'message-1',
        content: expect.objectContaining({
          version: [expect.objectContaining({ message: 'Depois' })],
        }),
      }),
      source: 'public_api',
      retry: false,
    });

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        chat.account.id,
        { chat_id: chat.chat_id, message_id: message.message_id },
        { message: 'Depois', operation_id: 'edit-operation-1' },
        chat.user?.id ?? 'user-1',
        [],
        'public_api'
      )
    ).resolves.toBe(true);

    expect(chatService.updateMessageChat).toHaveBeenCalledTimes(1);
    expect(workerCommandAdmissionService.admit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operationId: 'edit-operation-1',
        retry: true,
      })
    );
    const admissionCalls = workerCommandAdmissionService.admit.mock
      .calls as unknown as [{ payload: unknown }][];
    expect(admissionCalls[1]?.[0].payload).toEqual(
      admissionCalls[0]?.[0].payload
    );
  });
});
