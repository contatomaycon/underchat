import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { ChatMessageCreatorUseCase } from '@core/useCases/chat/ChatMessageCreator.useCase';
import { ChatMessageEditorUseCase } from '@core/useCases/chat/ChatMessageEditor.useCase';

describe('chat message immediate mutation consistency', () => {
  it('preserves an immediate edit in the delete snapshot and deduplicates delete retry', async () => {
    const chat: IChat = {
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'Baileys' },
      user: { id: 'user-1', name: 'Agent' },
      name: 'Contact',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: new Date().toISOString(),
      message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
    };
    let currentMessage: IChatMessage = {
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
      content: { type: EMessageType.text, message: 'before' },
      date: new Date().toISOString(),
      deleted: false,
      has_quoted: false,
    };
    const updateMessageChat = jest.fn(async (message: IChatMessage) => {
      currentMessage = message;
      return true;
    });
    const saveMessageChat = jest.fn(async (message: IChatMessage) => {
      currentMessage = message;
      return true;
    });
    const chatService = {
      findMessageByMessageId: jest.fn(async () => currentMessage),
      findChatByChatId: jest.fn(async () => chat),
      updateMessageChat,
      saveMessageChat,
    };
    const workerService = {
      viewWorkerType: jest.fn(async () => ({
        worker_type_id: EWorkerType.baileys,
      })),
    };
    const workerCommandAdmissionService = {
      admit: jest.fn(async () => undefined),
    };
    const editor = new ChatMessageEditorUseCase(
      chatService as never,
      workerCommandAdmissionService as never,
      workerService as never
    );
    const elasticDatabaseService = { select: jest.fn() };
    const creator = new ChatMessageCreatorUseCase(
      {} as never,
      chatService as never,
      elasticDatabaseService as never,
      workerCommandAdmissionService as never,
      { officialWhatsappSendMessage: jest.fn() } as never,
      { send: jest.fn(async () => undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { resetOnOperatorMessage: jest.fn() } as never,
      workerService as never,
      {} as never
    );
    (creator as any).publishProviderActionMessage = jest.fn(async () => true);
    (creator as any).centrifugoChatPublish = jest.fn(async () => true);
    const t = ((key: string) => key) as never;

    await expect(
      editor.execute(
        t,
        chat.account.id,
        { chat_id: chat.chat_id, message_id: currentMessage.message_id },
        { message: 'after' },
        chat.user?.id ?? 'user-1',
        [],
        'public_api'
      )
    ).resolves.toBe(true);

    const admissionCalls = workerCommandAdmissionService.admit.mock
      .calls as unknown as Array<[{ operationId: string }]>;
    const generatedEditOperationId = admissionCalls[0]?.[0].operationId ?? '';
    expect(generatedEditOperationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
    expect(currentMessage.hash).toBe(generatedEditOperationId);

    await expect(
      (creator as any).processDelete(
        chat,
        chat.chat_id,
        chat.account.id,
        currentMessage.message_id,
        {
          t,
          hash: null,
          messageId: 'delete-operation-1',
          typeUser: ETypeUserChat.operator,
          senderUser: chat.user,
          webhookSource: 'public_api',
        }
      )
    ).resolves.toBe(true);
    await expect(
      (creator as any).processDelete(
        chat,
        chat.chat_id,
        chat.account.id,
        currentMessage.message_id,
        {
          t,
          hash: null,
          messageId: 'delete-operation-1',
          typeUser: ETypeUserChat.operator,
          senderUser: chat.user,
          webhookSource: 'public_api',
        }
      )
    ).resolves.toBe(true);

    expect(currentMessage.deleted).toBe(true);
    expect(currentMessage.content?.version).toEqual([
      expect.objectContaining({ message: 'after' }),
    ]);
    expect(saveMessageChat).toHaveBeenCalledTimes(1);
    expect((creator as any).publishProviderActionMessage).toHaveBeenCalledTimes(
      2
    );
    expect(
      (creator as any).publishProviderActionMessage.mock.calls[0][1]
    ).toEqual((creator as any).publishProviderActionMessage.mock.calls[1][1]);
    expect(saveMessageChat).toHaveBeenCalledWith(
      expect.objectContaining({
        deleted: true,
        content: expect.objectContaining({
          version: [expect.objectContaining({ message: 'after' })],
        }),
      }),
      expect.objectContaining({
        eventTypes: ['message.deleted'],
        previousMessage: expect.objectContaining({
          content: expect.objectContaining({
            version: [expect.objectContaining({ message: 'after' })],
          }),
        }),
      })
    );
    expect(elasticDatabaseService.select).not.toHaveBeenCalled();
  });
});
