import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { ChatMessageForwarderUseCase } from '@core/useCases/chat/ChatMessageForwarder.useCase';
import { buildForwardWorkerCommandOperationId } from '@core/common/functions/messageIdentity';
import { WorkerCommandPublishError } from '@core/services/natsJetStreamPublisher.service';
import {
  currentWorkerCommandRetryOf,
  runWithWorkerCommandAcceptanceContext,
} from '@core/common/functions/workerCommandAcceptanceContext';

describe('ChatMessageForwarderUseCase outbound webhook attribution', () => {
  const idempotencyKey = '019a0000-0000-7000-8000-000000000001';
  it('generates a UUIDv7 base identity when the caller omits it', async () => {
    const sourceChat = {
      chat_id: 'source-chat',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'WhatsApp' },
      user: { id: 'user-1', name: 'Agent' },
      name: 'Source',
      phone: '5511888888888',
      status: EChatStatus.in_chat,
      date: '2026-08-13T09:00:00.000Z',
    } as IChat;
    const sourceMessage = {
      message_id: 'source-message',
      chat_id: sourceChat.chat_id,
      account: sourceChat.account,
      worker: sourceChat.worker,
      phone: sourceChat.phone,
      type_user: ETypeUserChat.operator,
      content: { type: EMessageType.text, message: 'Forward me' },
      date: sourceChat.date,
    } as IChatMessage;
    const useCase = new ChatMessageForwarderUseCase(
      {
        findChatByChatId: jest.fn(async () => sourceChat),
        findMessageByMessageId: jest.fn(async () => sourceMessage),
      } as never,
      {} as never,
      {} as never,
      { viewUserNamePhoto: jest.fn(async () => sourceChat.user) } as never,
      {} as never
    );
    const forwardToChatTarget = jest
      .spyOn(useCase as any, 'forwardToChatTarget')
      .mockResolvedValue({
        target_type: 'chat',
        target_chat_id: 'target-chat',
        target_contact_id: null,
        status: 'sent',
        message: null,
      });

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        { chat_id: 'source-chat', message_id: 'source-message' },
        { target_chat_ids: ['target-chat'] },
        'user-1',
        [],
        []
      )
    ).resolves.toEqual(expect.objectContaining({ sent: 1, failed: 0 }));

    expect(forwardToChatTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
        ),
      })
    );
  });

  it('propagates the public API source when persisting a forwarded message', async () => {
    const targetChat: IChat = {
      chat_id: 'target-chat',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'WhatsApp' },
      user: { id: 'user-1', name: 'Agent' },
      name: 'Target',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: new Date().toISOString(),
      message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
    };
    const sourceMessage: IChatMessage = {
      message_id: 'source-message',
      chat_id: 'source-chat',
      message_key: {
        id: 'provider-source',
        remote_jid: '5511888888888@s.whatsapp.net',
        is_view_once: false,
      },
      type_user: ETypeUserChat.operator,
      account: targetChat.account,
      worker: targetChat.worker,
      user: targetChat.user,
      phone: '5511888888888',
      summary: {
        is_sent: true,
        is_delivered: true,
        is_seen: false,
        is_sent_to_internal: true,
      },
      content: { type: EMessageType.text, message: 'Forward me' },
      date: new Date().toISOString(),
      deleted: false,
      has_quoted: false,
    };
    const publishPreparedMessage = jest.fn<
      Promise<boolean>,
      [IChatMessage, string?]
    >(async () => true);
    const useCase = new ChatMessageForwarderUseCase(
      { findMessageByMessageId: jest.fn(async () => null) } as never,
      { publishPreparedMessage } as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(
      (useCase as any).publishForwardMessage({
        t: (key: string) => key,
        sourceMessage,
        sourceContent: sourceMessage.content,
        targetChat,
        targetType: 'chat',
        actorUser: targetChat.user,
        idempotencyKey,
        webhookSource: 'public_api',
      })
    ).resolves.toEqual(
      expect.objectContaining({ status: 'sent', target_chat_id: 'target-chat' })
    );

    expect(publishPreparedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: 'target-chat',
        content: expect.objectContaining({
          forward: expect.objectContaining({
            source_message_id: 'source-message',
          }),
        }),
      }),
      'public_api'
    );
    expect(publishPreparedMessage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        message_id: buildForwardWorkerCommandOperationId(
          idempotencyKey,
          'target-chat'
        ),
        hash: buildForwardWorkerCommandOperationId(
          idempotencyKey,
          'target-chat'
        ),
      })
    );
  });

  it('reuses the exact persisted payload when PubAck acceptance is unknown', async () => {
    const targetChat: IChat = {
      chat_id: 'target-chat',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'WhatsApp' },
      user: { id: 'user-1', name: 'Agent' },
      name: 'Target',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: '2026-08-13T10:00:00.000Z',
      message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
    };
    const sourceMessage: IChatMessage = {
      message_id: 'source-message',
      chat_id: 'source-chat',
      message_key: {
        id: 'provider-source',
        remote_jid: '5511888888888@s.whatsapp.net',
        is_view_once: false,
      },
      type_user: ETypeUserChat.operator,
      account: targetChat.account,
      worker: targetChat.worker,
      phone: '5511888888888',
      summary: {
        is_sent: true,
        is_delivered: true,
        is_seen: false,
        is_sent_to_internal: true,
      },
      content: { type: EMessageType.text, message: 'Forward me' },
      date: '2026-08-13T09:00:00.000Z',
    };
    let persisted: IChatMessage | null = null;
    const publishedPayloads: IChatMessage[] = [];
    const publishPreparedMessage = jest.fn(async (message: IChatMessage) => {
      publishedPayloads.push(structuredClone(message));
      persisted ??= structuredClone(message);
      return true;
    });
    const useCase = new ChatMessageForwarderUseCase(
      {
        findMessageByMessageId: jest.fn(async () => persisted),
      } as never,
      { publishPreparedMessage } as never,
      {} as never,
      {} as never,
      {} as never
    );
    const input = {
      t: (key: string) => key,
      sourceMessage,
      sourceContent: sourceMessage.content,
      targetChat,
      targetType: 'chat',
      actorUser: targetChat.user,
      idempotencyKey,
      webhookSource: 'manager_api',
    };

    await (useCase as any).publishForwardMessage(input);
    await (useCase as any).publishForwardMessage(input);

    expect(publishedPayloads).toHaveLength(2);
    expect(publishedPayloads[1]).toEqual(publishedPayloads[0]);
    expect(publishPreparedMessage).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      'manager_api',
      undefined,
      true
    );
  });

  it('propagates PubAck unknown instead of reducing it to a 200 failed item', async () => {
    const targetChat: IChat = {
      chat_id: 'target-chat',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'WhatsApp' },
      user: { id: 'user-1', name: 'Agent' },
      name: 'Target',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: '2026-08-13T10:00:00.000Z',
      message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
    };
    const sourceMessage = {
      message_id: 'source-message',
      chat_id: 'source-chat',
      account: targetChat.account,
      worker: targetChat.worker,
      phone: '5511888888888',
      type_user: ETypeUserChat.operator,
      summary: {
        is_sent: true,
        is_delivered: true,
        is_seen: false,
        is_sent_to_internal: true,
      },
      content: { type: EMessageType.text, message: 'Forward me' },
      date: '2026-08-13T09:00:00.000Z',
    } as IChatMessage;
    const error = new WorkerCommandPublishError(
      'transport_unavailable',
      'command-1',
      'timeout',
      { operationId: 'target-operation' }
    );
    const useCase = new ChatMessageForwarderUseCase(
      { findMessageByMessageId: jest.fn(async () => null) } as never,
      {
        publishPreparedMessage: jest.fn(async () => {
          throw error;
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(
      (useCase as any).publishForwardMessage({
        t: (key: string) => key,
        sourceMessage,
        sourceContent: sourceMessage.content,
        targetChat,
        targetType: 'chat',
        actorUser: targetChat.user,
        idempotencyKey,
        webhookSource: 'manager_api',
      })
    ).rejects.toBe(error);
  });

  it('derives retry ancestry per target from the stable base retry key', async () => {
    const targetChat: IChat = {
      chat_id: 'target-chat',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'WhatsApp' },
      user: { id: 'user-1', name: 'Agent' },
      name: 'Target',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: '2026-08-13T10:00:00.000Z',
      message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
    };
    const sourceMessage = {
      message_id: 'source-message',
      chat_id: 'source-chat',
      account: targetChat.account,
      worker: targetChat.worker,
      phone: '5511888888888',
      type_user: ETypeUserChat.operator,
      summary: {
        is_sent: true,
        is_delivered: true,
        is_seen: false,
        is_sent_to_internal: true,
      },
      content: { type: EMessageType.text, message: 'Forward me' },
      date: '2026-08-13T09:00:00.000Z',
    } as IChatMessage;
    const observedRetryOf: Array<string | null> = [];
    const useCase = new ChatMessageForwarderUseCase(
      { findMessageByMessageId: jest.fn(async () => null) } as never,
      {
        publishPreparedMessage: jest.fn(async () => {
          observedRetryOf.push(currentWorkerCommandRetryOf());
          return true;
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never
    );
    const previousBase = '01990000-0000-7000-8000-000000000001';

    await runWithWorkerCommandAcceptanceContext(() =>
      (useCase as any).publishForwardMessage({
        t: (key: string) => key,
        sourceMessage,
        sourceContent: sourceMessage.content,
        targetChat,
        targetType: 'chat',
        actorUser: targetChat.user,
        idempotencyKey,
        retryOfKey: previousBase,
        webhookSource: 'manager_api',
      })
    );

    expect(observedRetryOf).toEqual([
      buildForwardWorkerCommandOperationId(previousBase, targetChat.chat_id),
    ]);
  });
});
