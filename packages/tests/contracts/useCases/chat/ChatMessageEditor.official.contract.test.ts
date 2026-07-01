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
      { send: jest.fn(async () => undefined) } as never,
      { workerSendMessage: jest.fn() } as never,
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
        { message: 'Depois' },
        'user-1'
      )
    ).rejects.toThrow('whatsapp_official_edit_message_not_supported');

    expect(chatService.updateMessageContent).not.toHaveBeenCalled();
  });
});
