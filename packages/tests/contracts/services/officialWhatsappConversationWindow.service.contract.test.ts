import 'reflect-metadata';
jest.mock('@core/common/functions/normalizeJid', () => ({
  normalizeJid: jest.fn((jid?: string | null) => jid ?? undefined),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IChat } from '@core/common/interfaces/IChat';
import {
  ChatPatch,
  ChatPatchOptions,
} from '@core/common/interfaces/IChatPatch';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IOfficialWhatsappConversationWindowRecord } from '@core/common/interfaces/IOfficialWhatsappConversationWindow';
import { OfficialWhatsappConversationWindowService } from '@core/services/officialWhatsappConversationWindow.service';

const chat: IChat = {
  chat_id: 'chat-1',
  account: { id: 'account-1', name: 'Account' },
  worker: {
    id: 'worker-1',
    name: 'Official',
    type_id: EWorkerType.whatsapp,
    is_official: true,
  },
  user: { id: 'user-1', name: 'Agent' },
  contact: { id: 'contact-1', name: 'Maycon', phone: '9999' },
  name: 'Maycon',
  phone: '5511999999999',
  status: EChatStatus.in_chat,
  date: '2026-07-01T10:00:00.000Z',
};

const message: IChatMessage = {
  message_id: 'message-1',
  chat_id: chat.chat_id,
  message_key: {
    remote_jid: '5511999999999@s.whatsapp.net',
    is_view_once: false,
  },
  type_user: ETypeUserChat.operator,
  account: chat.account,
  worker: chat.worker,
  user: chat.user,
  phone: chat.phone,
  summary: {
    is_sent: false,
    is_delivered: false,
    is_seen: false,
    is_sent_to_internal: true,
  },
  content: {
    type: EMessageType.text,
    message: 'Oi',
  },
  date: '2026-07-01T10:00:00.000Z',
};

function makeOfficialTemplateMessage(
  overrides: Partial<IChatMessage> = {}
): IChatMessage {
  return {
    ...message,
    message_id: 'internal-template-legacy',
    date: '2026-07-03T10:00:00.000Z',
    message_key: {
      id: 'wamid.template-legacy',
      remote_jid: '5511999999999@s.whatsapp.net',
      from_me: true,
      is_view_once: false,
    },
    content: {
      type: EMessageType.official_template,
      message: 'Template',
    },
    ...overrides,
  };
}

function makeService() {
  let row: IOfficialWhatsappConversationWindowRecord | null = null;
  let persistedChat: IChat = { ...chat };

  const repository = {
    findByIdentity: jest.fn(async () => row),
    findByIdentityStrong: jest.fn(async () => row),
    findAwaitingTemplateByIdentityStrong: jest.fn(async () =>
      row?.awaiting_contact_reply_since ? row : null
    ),
    repairInboundTimestamp: jest.fn(async (input) => {
      if (!row || row.last_inbound_message_id !== input.expectedMessageId) {
        return row;
      }
      row = {
        ...row,
        last_inbound_at: input.inboundAt,
        service_window_expires_at: input.expiresAt,
        updated_at: '2026-07-03T10:01:00.000Z',
      };
      return row;
    }),
    upsertInbound: jest.fn(async (input) => {
      row = {
        official_whatsapp_conversation_window_id: 'window-1',
        account_id: input.accountId,
        worker_id: input.workerId,
        contact_id: input.contactId ?? null,
        phone: input.phone,
        remote_jid: input.remoteJid ?? null,
        last_inbound_message_id: input.messageId ?? null,
        last_inbound_at: input.inboundAt,
        service_window_expires_at: input.expiresAt,
        awaiting_contact_reply_since: null,
        awaiting_template_message_id: null,
        last_template_sent_at: row?.last_template_sent_at ?? null,
        last_meta_error_code: null,
        closed_reason: null,
      };
      return row;
    }),
    upsertTemplateSent: jest.fn(async (input) => {
      const previousTemplateSentAt = row?.last_template_sent_at
        ? new Date(row.last_template_sent_at).getTime()
        : Number.NEGATIVE_INFINITY;
      const nextTemplateSentAt = new Date(input.sentAt).getTime();
      const isSameConfirmedTemplate =
        input.phase === 'provider_accepted' &&
        nextTemplateSentAt === previousTemplateSentAt &&
        Boolean(row?.awaiting_contact_reply_since) &&
        row?.closed_reason === 'template_pending';
      const canApply =
        nextTemplateSentAt > previousTemplateSentAt ||
        isSameConfirmedTemplate ||
        (nextTemplateSentAt === previousTemplateSentAt &&
          Boolean(row?.awaiting_contact_reply_since) &&
          input.phase === 'provider_accepted' &&
          row?.closed_reason === 'template_send_uncertain');
      if (row && !canApply) {
        return row;
      }

      const hasOpenWindow = Boolean(
        row?.service_window_expires_at &&
        new Date(row.service_window_expires_at) > new Date(input.sentAt)
      );
      const pendingSince =
        input.phase === 'provider_accepted'
          ? input.providerAcceptedAt
          : input.sentAt;
      row = {
        ...(row ?? {
          official_whatsapp_conversation_window_id: 'window-1',
          account_id: input.accountId,
          worker_id: input.workerId,
          phone: input.phone,
        }),
        contact_id: input.contactId ?? null,
        remote_jid: input.remoteJid ?? null,
        awaiting_contact_reply_since: hasOpenWindow
          ? null
          : isSameConfirmedTemplate
            ? row?.awaiting_contact_reply_since
            : pendingSince,
        awaiting_template_message_id: hasOpenWindow
          ? null
          : (input.templateMessageId ?? null),
        last_template_sent_at: input.sentAt,
        closed_reason: hasOpenWindow
          ? null
          : input.phase === 'provider_accepted'
            ? 'template_pending'
            : 'template_send_uncertain',
        last_meta_error_code: null,
      };
      return row;
    }),
    clearAwaitingTemplate: jest.fn(async (input) => {
      if (
        !row?.awaiting_contact_reply_since ||
        !row.awaiting_template_message_id ||
        !input.templateMessageIds.includes(row.awaiting_template_message_id)
      ) {
        return null;
      }
      row = {
        ...row,
        awaiting_contact_reply_since: null,
        awaiting_template_message_id: null,
        last_meta_error_code: input.errorCode ?? null,
        closed_reason: 'template_failed',
      };
      return row;
    }),
    markAwaitingTemplateUncertain: jest.fn(async (input) => {
      if (
        !row?.awaiting_contact_reply_since ||
        !row.awaiting_template_message_id ||
        !input.templateMessageIds.includes(row.awaiting_template_message_id)
      ) {
        return null;
      }
      row = {
        ...row,
        last_meta_error_code: null,
        closed_reason: 'template_send_uncertain',
      };
      return row;
    }),
    confirmAwaitingTemplate: jest.fn(async (input) => {
      if (
        !row?.awaiting_contact_reply_since ||
        !row.awaiting_template_message_id ||
        !['template_pending', 'template_send_uncertain'].includes(
          row.closed_reason ?? ''
        ) ||
        !input.templateMessageIds.includes(row.awaiting_template_message_id)
      ) {
        return null;
      }
      row = {
        ...row,
        awaiting_contact_reply_since:
          row.closed_reason === 'template_send_uncertain'
            ? input.providerAcceptedAt
            : row.awaiting_contact_reply_since,
        awaiting_template_message_id:
          input.providerMessageId ?? row.awaiting_template_message_id,
        last_meta_error_code: null,
        closed_reason: 'template_pending',
      };
      return row;
    }),
    recordOutbound: jest.fn(async () => row),
    markClosedByMetaError: jest.fn(async (input) => {
      row = {
        ...(row ?? {
          official_whatsapp_conversation_window_id: 'window-1',
          account_id: input.accountId,
          worker_id: input.workerId,
          phone: input.phone,
        }),
        service_window_expires_at: '2026-07-04T00:00:00.000Z',
        awaiting_contact_reply_since: null,
        awaiting_template_message_id: null,
        last_meta_error_code: input.errorCode ?? null,
        closed_reason: input.reason,
      };
      return row;
    }),
  };
  const chatService = {
    findOpenChatByIdentity: jest.fn(
      async (): Promise<IChat | null> => persistedChat
    ),
    findMessageByMessageId: jest.fn(
      async (): Promise<IChatMessage | null> => null
    ),
    findOfficialOutboundMessageByProviderId: jest.fn(
      async (): Promise<IChatMessage | null> => null
    ),
    findOfficialInboundMessageByProviderId: jest.fn(
      async (): Promise<IChatMessage | null> => null
    ),
    repairOfficialInboundMessageTimestamp: jest.fn(async () => true),
    findInboundMessagesByChatIdAfter: jest.fn(
      async (): Promise<IChatMessage[]> => []
    ),
    applyChatPatch: jest.fn(
      async (
        _chatId: string,
        patch: ChatPatch,
        _options?: ChatPatchOptions & {
          outboundWebhook?: {
            previousChat?: IChat;
            changes?: Record<string, unknown>;
          };
        }
      ) => {
        persistedChat = { ...persistedChat, ...patch };
        return true;
      }
    ),
    findChatByChatId: jest.fn(async () => persistedChat),
    invalidateChatCache: jest.fn(async () => undefined),
  };
  const centrifugoService = {
    publishSub: jest.fn(async (_channel: string, _payload: unknown) => ({})),
  };

  return {
    service: new OfficialWhatsappConversationWindowService(
      repository as never,
      chatService as never,
      centrifugoService as never
    ),
    repository,
    chatService,
    centrifugoService,
  };
}

describe('OfficialWhatsappConversationWindowService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-03T10:01:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('self-heals a closed strong record from a newer persisted inbound before blocking a send', async () => {
    const { service, chatService, repository } = makeService();
    await service.recordInboundMessage({
      accountId: chat.account.id,
      workerId: chat.worker.id,
      phone: chat.phone,
      messageId: 'wamid.old-inbound',
      inboundAt: '2026-07-01T08:00:00.000Z',
    });
    chatService.findInboundMessagesByChatIdAfter.mockResolvedValueOnce([
      {
        ...message,
        message_id: 'message-current-inbound',
        type_user: ETypeUserChat.client,
        date: '2026-07-03T09:59:00.000Z',
        message_key: {
          id: 'wamid.current-inbound',
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: false,
          is_view_once: false,
        },
      },
    ]);

    await expect(
      service.assertCanSendFreeform(
        ((key: string) => key) as never,
        chat,
        EMessageType.text
      )
    ).resolves.toBeUndefined();

    expect(repository.upsertInbound).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messageId: 'wamid.current-inbound',
        inboundAt: '2026-07-03T09:59:00.000Z',
        expiresAt: '2026-07-04T09:59:00.000Z',
      })
    );
  });

  it('recognizes an official chat from its persisted window when the worker projection is incomplete', async () => {
    const { service, chatService } = makeService();
    const projectedOfficialChat: IChat = {
      ...chat,
      worker: { id: chat.worker.id, name: chat.worker.name },
      official_window: {
        is_official: true,
        state: 'closed',
        reason: 'no_customer_message',
        can_send_freeform: false,
        can_send_template: true,
      },
    };
    chatService.findInboundMessagesByChatIdAfter.mockResolvedValueOnce([]);

    await expect(
      service.reconcileFromMessages(projectedOfficialChat, [])
    ).resolves.toMatchObject({
      is_official: true,
      state: 'closed',
    });
  });

  it('does not unlock a reserved template from a delayed old Meta message', async () => {
    const { service, chatService, repository } = makeService();
    await service.recordTemplateSentForChat(chat, {
      messageId: 'wamid.template-production',
      sentAt: '2026-07-03T09:50:00.000Z',
    });
    chatService.findInboundMessagesByChatIdAfter.mockResolvedValueOnce([
      {
        ...message,
        message_id: 'message-delayed-inbound',
        type_user: ETypeUserChat.client,
        date: '2026-07-03T10:00:00.000Z',
        message_key: {
          id: 'wamid.delayed-inbound',
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: false,
          is_view_once: false,
        },
        content: {
          type: EMessageType.text,
          message: 'Olá ?',
          official: {
            provider: 'meta_whatsapp',
            type: 'text',
            raw: { timestamp: '1782898800' },
          },
        },
      },
    ]);

    await expect(
      service.assertCanSendFreeform(
        ((key: string) => key) as never,
        chat,
        EMessageType.text
      )
    ).rejects.toThrow('whatsapp_official_template_send_uncertain');

    expect(repository.upsertInbound).not.toHaveBeenCalled();
  });

  it('repairs an existing false-open window from the exact persisted Meta message', async () => {
    const { service, chatService, repository } = makeService();
    await service.recordInboundMessage({
      accountId: chat.account.id,
      workerId: chat.worker.id,
      phone: chat.phone,
      messageId: 'wamid.replayed-inbound',
      inboundAt: '2026-07-03T10:00:00.000Z',
    });
    chatService.findOfficialInboundMessageByProviderId.mockResolvedValue({
      ...message,
      message_id: 'message-replayed-inbound',
      type_user: ETypeUserChat.client,
      date: '2026-07-03T10:00:00.000Z',
      message_key: {
        id: 'wamid.replayed-inbound',
        remote_jid: '5511999999999@s.whatsapp.net',
        from_me: false,
        is_view_once: false,
      },
      content: {
        type: EMessageType.text,
        message: 'Mensagem reproduzida com atraso',
        official: {
          provider: 'meta_whatsapp',
          type: 'text',
          raw: { timestamp: '1782898800' },
        },
      },
    });

    await expect(
      service.resolveAuthoritativeForChat(
        chat,
        new Date('2026-07-03T10:01:00.000Z')
      )
    ).resolves.toMatchObject({
      state: 'closed',
      reason: 'customer_service_window_closed',
      can_send_freeform: false,
    });

    expect(repository.repairInboundTimestamp).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedMessageId: 'wamid.replayed-inbound',
        inboundAt: '2026-07-01T09:40:00.000Z',
        expiresAt: '2026-07-02T09:40:00.000Z',
      })
    );
    expect(
      chatService.repairOfficialInboundMessageTimestamp
    ).toHaveBeenCalledWith({
      accountId: chat.account.id,
      workerId: chat.worker.id,
      internalMessageId: 'message-replayed-inbound',
      providerMessageId: 'wamid.replayed-inbound',
      correctedAt: '2026-07-01T09:40:00.000Z',
    });
  });

  it('reconciles history before an identity-level opening decision', async () => {
    const { service, chatService, repository } = makeService();
    await service.recordTemplateSentForChat(chat, {
      messageId: 'wamid.template-before-reply',
      sentAt: '2026-07-03T09:50:00.000Z',
    });
    chatService.findInboundMessagesByChatIdAfter.mockResolvedValueOnce([
      {
        ...message,
        message_id: 'message-reply-before-opening',
        type_user: ETypeUserChat.client,
        date: '2026-07-03T10:00:00.000Z',
        message_key: {
          id: 'wamid.reply-before-opening',
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: false,
          is_view_once: false,
        },
      },
    ]);

    await expect(
      service.resolveAuthoritativeForIdentity(
        {
          accountId: chat.account.id,
          workerId: chat.worker.id,
          contactId: chat.contact?.id,
          phone: chat.phone,
        },
        new Date('2026-07-03T10:01:00.000Z')
      )
    ).resolves.toMatchObject({
      state: 'open',
      can_send_freeform: true,
    });

    expect(repository.findByIdentityStrong).toHaveBeenCalled();
    expect(chatService.findOpenChatByIdentity).toHaveBeenCalled();
    expect(repository.upsertInbound).toHaveBeenLastCalledWith(
      expect.objectContaining({ messageId: 'wamid.reply-before-opening' })
    );
  });

  it('self-heals a terminal template outcome authoritatively even without an open chat', async () => {
    const { service, chatService } = makeService();
    const internalMessageId = 'internal-template-without-open-chat';
    const reservedMessage = makeOfficialTemplateMessage({
      message_id: internalMessageId,
      message_key: {
        id: null,
        remote_jid: '5511999999999@s.whatsapp.net',
        is_view_once: false,
      },
    });
    await service.recordTemplateSentForChat(chat, {
      messageId: internalMessageId,
      sentAt: reservedMessage.date,
    });
    await service.recordProviderAcceptedMessage(reservedMessage);
    chatService.findOpenChatByIdentity.mockResolvedValue(null);
    chatService.findMessageByMessageId.mockResolvedValue(
      makeOfficialTemplateMessage({
        message_id: internalMessageId,
        provider_error_code: 132000,
        summary: {
          is_sent: false,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: false,
        },
      })
    );

    await expect(
      service.resolveAuthoritativeForIdentity(
        {
          accountId: chat.account.id,
          workerId: chat.worker.id,
          phone: chat.phone,
        },
        new Date('2026-07-03T10:02:00.000Z')
      )
    ).resolves.toMatchObject({
      state: 'closed',
      reason: 'template_failed',
      can_send_template: true,
      last_meta_error_code: 132000,
    });
  });

  it('does not publish an in-memory window snapshot when chat persistence is not confirmed', async () => {
    const { service, chatService, centrifugoService } = makeService();
    chatService.applyChatPatch.mockResolvedValueOnce(false);

    await service.recordInboundMessage({
      accountId: chat.account.id,
      workerId: chat.worker.id,
      contactId: chat.contact?.id,
      phone: chat.phone,
      remoteJid: chat.message_key?.remote_jid,
      messageId: 'wamid.persistence-failed',
      inboundAt: '2026-07-01T12:00:00.000Z',
    });

    expect(chatService.applyChatPatch).toHaveBeenCalledWith(
      chat.chat_id,
      expect.objectContaining({
        official_window: expect.objectContaining({ is_official: true }),
      }),
      expect.objectContaining({ allowCreate: false, refresh: true })
    );
    expect(chatService.findChatByChatId).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('persists only the official window and publishes a fresh chat with concurrent fields intact', async () => {
    const { service, chatService, centrifugoService } = makeService();
    const concurrentChat: IChat = {
      ...chat,
      name: 'Contact renamed concurrently',
      contact: {
        id: 'contact-1',
        name: 'Contact renamed concurrently',
        phone: '9999',
      },
      user: { id: 'user-2', name: 'New assigned agent' },
      label: [
        {
          label_template_id: 'label-1',
          label: 'Concurrent label',
          color: '#3366FF',
        },
      ],
    };
    chatService.findChatByChatId.mockImplementationOnce(async () => {
      const calls = chatService.applyChatPatch.mock.calls;
      const persistedWindowPatch = calls[calls.length - 1]?.[1];
      return { ...concurrentChat, ...persistedWindowPatch };
    });

    const synchronized = await service.recordTemplateSentForChat(chat, {
      messageId: 'wamid.concurrent-template',
      sentAt: '2026-07-03T10:00:00.000Z',
    });

    expect(chatService.applyChatPatch).toHaveBeenCalledTimes(1);
    const [, persistedPatch, options] =
      chatService.applyChatPatch.mock.calls[0];
    expect(Object.keys(persistedPatch)).toEqual(['official_window']);
    expect(persistedPatch).toEqual({
      official_window: expect.objectContaining({
        state: 'send_uncertain',
        awaiting_template_message_id: 'wamid.concurrent-template',
      }),
    });
    expect(persistedPatch).not.toHaveProperty('contact');
    expect(persistedPatch).not.toHaveProperty('label');
    expect(persistedPatch).not.toHaveProperty('user');
    expect(persistedPatch).not.toHaveProperty('status');
    expect(options).toMatchObject({
      allowCreate: false,
      refresh: true,
      expectedCurrentStatuses: expect.arrayContaining([
        EChatStatus.in_chat,
        EChatStatus.queue,
        EChatStatus.ura,
        EChatStatus.ura_output,
        EChatStatus.ura_schedule,
        EChatStatus.ura_webhook,
      ]),
      outboundWebhook: {
        previousChat: chat,
        changes: {
          official_window: persistedPatch.official_window,
        },
      },
    });
    expect(options?.expectedCurrentStatuses).not.toContain(EChatStatus.closed);

    expect(synchronized).toMatchObject({
      name: 'Contact renamed concurrently',
      contact: { name: 'Contact renamed concurrently' },
      user: { id: 'user-2' },
      label: [{ label_template_id: 'label-1' }],
      official_window: expect.objectContaining({
        state: 'send_uncertain',
      }),
    });
    expect(chatService.invalidateChatCache).toHaveBeenCalledWith(chat);
    expect(chatService.invalidateChatCache).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Contact renamed concurrently',
        user: { id: 'user-2', name: 'New assigned agent' },
      })
    );
    expect(centrifugoService.publishSub).toHaveBeenCalledTimes(2);
    for (const [, publishedChat] of centrifugoService.publishSub.mock.calls) {
      expect(publishedChat).toMatchObject({
        name: 'Contact renamed concurrently',
        contact: { name: 'Contact renamed concurrently' },
        user: { id: 'user-2' },
        label: [{ label_template_id: 'label-1' }],
      });
    }
  });

  it('opens for inbound messages and expires after 24 hours', async () => {
    const { service } = makeService();

    await service.recordInboundMessage({
      accountId: chat.account.id,
      workerId: chat.worker.id,
      contactId: chat.contact?.id,
      phone: chat.phone,
      remoteJid: chat.message_key?.remote_jid,
      messageId: 'wamid.inbound-1',
      inboundAt: '2026-07-01T12:00:00.000Z',
    });

    await expect(
      service.resolveForChat(chat, new Date('2026-07-02T11:59:59.000Z'))
    ).resolves.toMatchObject({
      state: 'open',
      can_send_freeform: true,
      service_window_expires_at: '2026-07-02T12:00:00.000Z',
    });

    await expect(
      service.resolveForChat(chat, new Date('2026-07-02T12:00:01.000Z'))
    ).resolves.toMatchObject({
      state: 'closed',
      reason: 'customer_service_window_closed',
      can_send_freeform: false,
      can_send_template: true,
    });
  });

  it('blocks after a template and releases after a later inbound reply', async () => {
    const { service } = makeService();
    const templateMessage: IChatMessage = {
      ...message,
      message_id: 'template-message-1',
      date: '2026-07-03T10:00:00.000Z',
      content: {
        type: EMessageType.official_template,
        message: 'Template',
      },
    };

    await service.recordTemplateSentForChat(chat, {
      messageId: templateMessage.message_id,
      sentAt: templateMessage.date,
    });

    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T10:00:30.000Z'))
    ).resolves.toMatchObject({
      state: 'send_uncertain',
      can_send_freeform: false,
      can_send_template: false,
    });

    await service.recordProviderAcceptedMessage(
      templateMessage,
      'wamid.provider-template-1'
    );

    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T10:01:00.000Z'))
    ).resolves.toMatchObject({
      state: 'awaiting_contact_reply',
      can_send_freeform: false,
      can_send_template: false,
      awaiting_contact_reply_since: '2026-07-03T10:01:00.000Z',
      awaiting_contact_reply_expires_at: '2026-07-04T10:01:00.000Z',
      awaiting_template_message_id: 'wamid.provider-template-1',
    });

    await expect(
      service.assertCanSendFreeform(
        ((key: string) => key) as never,
        chat,
        EMessageType.text
      )
    ).rejects.toThrow('whatsapp_official_waiting_contact_reply');

    await service.recordInboundMessage({
      accountId: chat.account.id,
      workerId: chat.worker.id,
      phone: chat.phone,
      remoteJid: chat.message_key?.remote_jid,
      messageId: 'wamid.inbound-after-template',
      inboundAt: '2026-07-03T11:00:00.000Z',
    });

    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T11:01:00.000Z'))
    ).resolves.toMatchObject({
      state: 'open',
      can_send_freeform: true,
      awaiting_contact_reply_since: null,
    });
  });

  it('releases an unanswered template after 24 hours so another template can be selected', async () => {
    const { service } = makeService();
    const templateMessage: IChatMessage = {
      ...message,
      message_id: 'template-message-timeout',
      date: '2026-07-03T10:00:00.000Z',
      content: {
        type: EMessageType.official_template,
        message: 'Template',
      },
    };

    await service.recordTemplateSentForChat(chat, {
      messageId: templateMessage.message_id,
      sentAt: templateMessage.date,
    });
    await service.recordProviderAcceptedMessage(templateMessage);

    await expect(
      service.resolveForIdentity(
        {
          accountId: chat.account.id,
          workerId: chat.worker.id,
          phone: chat.phone,
        },
        new Date('2026-07-04T10:00:59.999Z'),
        { strong: true }
      )
    ).resolves.toMatchObject({
      state: 'awaiting_contact_reply',
      can_send_template: false,
      awaiting_contact_reply_expires_at: '2026-07-04T10:01:00.000Z',
    });

    await expect(
      service.resolveForIdentity(
        {
          accountId: chat.account.id,
          workerId: chat.worker.id,
          phone: chat.phone,
        },
        new Date('2026-07-04T10:01:00.000Z'),
        { strong: true }
      )
    ).resolves.toMatchObject({
      state: 'closed',
      can_send_freeform: false,
      can_send_template: true,
      awaiting_contact_reply_since: null,
      awaiting_contact_reply_expires_at: null,
    });
  });

  it('self-repairs a pending template from the persisted Meta button reply and is idempotent', async () => {
    const { service, repository, chatService } = makeService();
    const templateMessageId = 'wamid.template-production';

    await service.recordTemplateSentForChat(chat, {
      messageId: templateMessageId,
      sentAt: '2026-07-21T13:17:47.811Z',
    });

    const reply = {
      message_id: 'message-inbound-button',
      chat_id: chat.chat_id,
      type_user: ETypeUserChat.client,
      date: '2026-07-21T13:18:16.517Z',
      message_key: {
        id: 'wamid.inbound-button',
        remote_jid: '551199999999@s.whatsapp.net',
        from_me: false,
      },
      content: {
        message_quoted_id: templateMessageId,
        official: {
          echo: false,
          raw: {
            timestamp: '1784639895',
            context: { id: templateMessageId },
          },
        },
      },
    };

    await expect(
      service.reconcileFromMessages(
        chat,
        [reply],
        new Date('2026-07-21T13:20:00.000Z')
      )
    ).resolves.toMatchObject({
      state: 'open',
      can_send_freeform: true,
      awaiting_contact_reply_since: null,
    });

    expect(repository.upsertInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: chat.phone,
        remoteJid: '551199999999@s.whatsapp.net',
        messageId: 'wamid.inbound-button',
        replyToMessageId: templateMessageId,
        inboundAt: '2026-07-21T13:18:15.000Z',
        expiresAt: '2026-07-22T13:18:15.000Z',
      })
    );

    await service.reconcileFromMessages(
      chat,
      [reply],
      new Date('2026-07-21T13:21:00.000Z')
    );

    expect(repository.upsertInbound).toHaveBeenCalledTimes(1);
    expect(chatService.applyChatPatch).toHaveBeenCalledWith(
      chat.chat_id,
      expect.objectContaining({
        official_window: expect.objectContaining({ state: 'open' }),
      }),
      expect.objectContaining({ allowCreate: false, refresh: true })
    );
  });

  it('aligns an already-open alias with a stale pending alias exactly once', async () => {
    const { service, repository, chatService } = makeService();
    const mergedOpenRecord: IOfficialWhatsappConversationWindowRecord = {
      official_whatsapp_conversation_window_id: 'window-without-nine',
      account_id: chat.account.id,
      worker_id: chat.worker.id,
      contact_id: chat.contact?.id,
      phone: '551199999999',
      remote_jid: '551199999999@s.whatsapp.net',
      last_inbound_message_id: 'wamid.inbound-after-template',
      last_inbound_at: '2026-07-21T13:18:15.000Z',
      service_window_expires_at: '2026-07-22T13:18:15.000Z',
      last_template_sent_at: '2026-07-21T13:17:47.811Z',
      awaiting_contact_reply_since: null,
      awaiting_template_message_id: null,
      closed_reason: null,
    };
    const stalePendingAlias: IOfficialWhatsappConversationWindowRecord = {
      ...mergedOpenRecord,
      official_whatsapp_conversation_window_id: 'window-with-nine',
      phone: chat.phone,
      last_inbound_message_id: null,
      last_inbound_at: null,
      service_window_expires_at: null,
      awaiting_contact_reply_since: '2026-07-21T13:17:47.811Z',
      awaiting_template_message_id: 'wamid.template-production',
      closed_reason: 'template_pending',
    };
    repository.findByIdentityStrong.mockResolvedValue(mergedOpenRecord);
    repository.findAwaitingTemplateByIdentityStrong
      .mockResolvedValueOnce(stalePendingAlias)
      .mockResolvedValueOnce(null);

    await service.reconcileFromMessages(
      chat,
      [],
      new Date('2026-07-21T13:20:00.000Z')
    );
    await service.reconcileFromMessages(
      chat,
      [],
      new Date('2026-07-21T13:21:00.000Z')
    );

    expect(repository.upsertInbound).toHaveBeenCalledTimes(1);
    expect(repository.upsertInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: chat.phone,
        replyToMessageId: 'wamid.template-production',
        inboundAt: '2026-07-21T13:18:15.000Z',
        expiresAt: '2026-07-22T13:18:15.000Z',
      })
    );
    expect(chatService.applyChatPatch).toHaveBeenCalledWith(
      chat.chat_id,
      expect.objectContaining({
        official_window: expect.objectContaining({
          state: 'open',
          awaiting_contact_reply_since: null,
        }),
      }),
      expect.objectContaining({ allowCreate: false, refresh: true })
    );
  });

  it('synchronizes a merged open snapshot when the chat document is still pending', async () => {
    const { service, repository, chatService } = makeService();
    const staleChat = {
      ...chat,
      official_window: {
        is_official: true as const,
        state: 'awaiting_contact_reply' as const,
        reason: 'customer_reply_required' as const,
        can_send_freeform: false,
        can_send_template: false,
        awaiting_contact_reply_since: '2026-07-21T13:17:47.811Z',
        awaiting_template_message_id: 'wamid.template-production',
      },
    };
    repository.findByIdentityStrong.mockResolvedValue({
      official_whatsapp_conversation_window_id: 'window-merged',
      account_id: chat.account.id,
      worker_id: chat.worker.id,
      phone: chat.phone,
      last_inbound_message_id: 'wamid.inbound-after-template',
      last_inbound_at: '2026-07-21T13:18:15.000Z',
      service_window_expires_at: '2026-07-22T13:18:15.000Z',
      last_template_sent_at: '2026-07-21T13:17:47.811Z',
      awaiting_contact_reply_since: null,
      awaiting_template_message_id: null,
      closed_reason: null,
    });
    repository.findAwaitingTemplateByIdentityStrong.mockResolvedValue(null);

    await service.reconcileFromMessages(
      staleChat,
      [],
      new Date('2026-07-21T13:20:00.000Z')
    );

    expect(repository.upsertInbound).not.toHaveBeenCalled();
    expect(chatService.applyChatPatch).toHaveBeenCalledWith(
      chat.chat_id,
      expect.objectContaining({
        official_window: expect.objectContaining({
          state: 'open',
          can_send_freeform: true,
        }),
      }),
      expect.objectContaining({ allowCreate: false, refresh: true })
    );
  });

  it('clears stale pending state from a reply even when its 24-hour window has already expired', async () => {
    const { service } = makeService();

    await service.recordTemplateSentForChat(chat, {
      messageId: 'wamid.template-expired-reply',
      sentAt: '2026-07-01T10:00:00.000Z',
    });

    await expect(
      service.reconcileFromMessages(
        chat,
        [
          {
            message_id: 'message-expired-inbound',
            chat_id: chat.chat_id,
            type_user: ETypeUserChat.client,
            date: '2026-07-01T10:01:00.000Z',
            message_key: {
              id: 'wamid.expired-inbound',
              from_me: false,
            },
            content: {
              message_quoted_id: 'wamid.template-expired-reply',
              official: { echo: false },
            },
          },
        ],
        new Date('2026-07-02T10:02:00.000Z')
      )
    ).resolves.toMatchObject({
      state: 'closed',
      reason: 'customer_service_window_closed',
      can_send_freeform: false,
      awaiting_contact_reply_since: null,
    });
  });

  it('does not unlock from an echo or an inbound event that predates the template', async () => {
    const { service, repository } = makeService();

    await service.recordTemplateSentForChat(chat, {
      messageId: 'wamid.template-ordering',
      sentAt: '2026-07-03T10:00:00.000Z',
    });

    await expect(
      service.reconcileFromMessages(
        chat,
        [
          {
            message_id: 'message-echo',
            chat_id: chat.chat_id,
            type_user: ETypeUserChat.client,
            date: '2026-07-03T10:02:00.000Z',
            message_key: { from_me: true },
            content: { official: { echo: true } },
          },
          {
            message_id: 'message-before-template',
            chat_id: chat.chat_id,
            type_user: ETypeUserChat.client,
            date: '2026-07-03T09:59:00.000Z',
            message_key: { from_me: false },
            content: {
              official: {
                echo: false,
                raw: { timestamp: '1783072740' },
              },
            },
          },
        ],
        new Date('2026-07-03T10:04:00.000Z')
      )
    ).resolves.toMatchObject({
      state: 'send_uncertain',
      can_send_freeform: false,
    });

    expect(repository.upsertInbound).not.toHaveBeenCalled();
  });

  it('keeps an active inbound window open when a template is sent inside it', async () => {
    const { service } = makeService();

    await service.recordInboundMessage({
      accountId: chat.account.id,
      workerId: chat.worker.id,
      phone: chat.phone,
      messageId: 'wamid.inbound-before-template',
      inboundAt: '2026-07-03T10:00:00.000Z',
    });
    await service.recordTemplateSentForChat(chat, {
      messageId: 'template-inside-window',
      sentAt: '2026-07-03T11:00:00.000Z',
    });

    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T12:00:00.000Z'))
    ).resolves.toMatchObject({
      state: 'open',
      can_send_freeform: true,
      last_template_sent_at: '2026-07-03T11:00:00.000Z',
    });
    await expect(
      service.resolveForChat(chat, new Date('2026-07-04T10:00:01.000Z'))
    ).resolves.toMatchObject({
      state: 'closed',
      reason: 'customer_service_window_closed',
    });
  });

  it('uses the full remote-jid phone for scheduled official messages', async () => {
    const { service, repository } = makeService();
    const scheduledTemplateMessage: IChatMessage = {
      ...message,
      phone: '11999999999',
      phone_ddi: '55',
      message_key: {
        remote_jid: '5511999999999@s.whatsapp.net',
        is_view_once: false,
      },
      content: {
        type: EMessageType.official_template,
        message: 'Template',
      },
    };

    await service.recordProviderAcceptedMessage(
      scheduledTemplateMessage,
      'wamid.scheduled-template'
    );

    expect(repository.upsertTemplateSent).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '5511999999999',
        templateMessageId: 'wamid.scheduled-template',
      })
    );
  });

  it('uses the primary database when resolving a mutation decision', async () => {
    const { service, repository } = makeService();

    await service.resolveForIdentity(
      {
        accountId: chat.account.id,
        workerId: chat.worker.id,
        phone: chat.phone,
      },
      new Date('2026-07-03T12:00:00.000Z'),
      { strong: true }
    );

    expect(repository.findByIdentityStrong).toHaveBeenCalled();
    expect(repository.findByIdentity).not.toHaveBeenCalled();
  });

  it('does not apply a stale open snapshot after the opening mutation', async () => {
    const { service, repository } = makeService();

    const result = await service.applySnapshotToChat(chat, {
      is_official: true,
      state: 'open',
      reason: 'customer_service_window_open',
      can_send_freeform: true,
      can_send_template: true,
      service_window_expires_at: '2099-07-22T10:00:00.000Z',
    });

    expect(repository.findByIdentityStrong).toHaveBeenCalled();
    expect(result.official_window).toMatchObject({
      state: 'closed',
      reason: 'no_customer_message',
    });
  });

  it('builds an awaiting snapshot after a closed-window template is accepted', () => {
    const { service } = makeService();

    expect(
      service.snapshotAfterTemplateAccepted(
        {
          is_official: true,
          state: 'closed',
          reason: 'no_customer_message',
          can_send_freeform: false,
          can_send_template: true,
        },
        {
          messageId: 'template-message-1',
          sentAt: '2026-07-03T10:00:00.000Z',
        }
      )
    ).toMatchObject({
      state: 'awaiting_contact_reply',
      can_send_template: false,
      awaiting_contact_reply_since: '2026-07-03T10:00:00.000Z',
      awaiting_contact_reply_expires_at: '2026-07-04T10:00:00.000Z',
      awaiting_template_message_id: 'template-message-1',
    });
  });

  it('closes the service window on Meta 131047 reengagement errors', async () => {
    const { service, chatService } = makeService();

    await service.markClosedByMetaReengagementForMessage(message, 131047);

    expect(chatService.applyChatPatch).toHaveBeenLastCalledWith(
      chat.chat_id,
      expect.objectContaining({
        official_window: expect.objectContaining({
          state: 'closed',
          reason: 'meta_reengagement',
          last_meta_error_code: 131047,
        }),
      }),
      expect.objectContaining({ allowCreate: false, refresh: true })
    );

    await expect(
      service.resolveForChat(chat, new Date('2026-07-04T00:00:01.000Z'))
    ).resolves.toMatchObject({
      state: 'closed',
      reason: 'meta_reengagement',
      last_meta_error_code: 131047,
      can_send_freeform: false,
      can_send_template: true,
    });

    jest.setSystemTime(new Date('2026-07-04T00:00:01.000Z'));
    await expect(
      service.assertCanSendFreeform(
        ((key: string) => key) as never,
        chat,
        EMessageType.text
      )
    ).rejects.toThrow('whatsapp_official_customer_service_window_closed');
  });

  it('clears awaiting reply when a template send fails', async () => {
    const { service } = makeService();
    const templateMessage: IChatMessage = {
      ...message,
      message_id: 'template-message-1',
      content: {
        type: EMessageType.official_template,
        message: 'Template',
      },
    };

    await service.recordTemplateSentForChat(chat, {
      messageId: templateMessage.message_id,
      sentAt: '2026-07-03T10:00:00.000Z',
    });
    await service.recordTemplateFailureForMessage(templateMessage, 132000);

    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T10:01:00.000Z'))
    ).resolves.toMatchObject({
      state: 'closed',
      reason: 'template_failed',
      last_meta_error_code: 132000,
      can_send_template: true,
    });
  });

  it('matches a terminal template failure by internal and provider message ids', async () => {
    const { service, repository } = makeService();
    const sentAt = '2026-07-03T10:00:00.000Z';
    const templateMessage: IChatMessage = {
      ...message,
      message_id: 'internal-template-1',
      date: sentAt,
      message_key: {
        ...message.message_key,
        id: 'wamid.provider-template-1',
        is_view_once: false,
      },
      content: {
        type: EMessageType.official_template,
        message: 'Template',
      },
    };

    await service.recordTemplateSentForChat(chat, {
      messageId: templateMessage.message_id,
      sentAt,
    });
    await service.recordTemplateFailureForMessage(
      templateMessage,
      132000,
      'wamid.status-template-1'
    );

    expect(repository.clearAwaitingTemplate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        templateMessageIds: [
          'wamid.status-template-1',
          'wamid.provider-template-1',
          'internal-template-1',
        ],
        errorCode: 132000,
      })
    );
    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T10:01:00.000Z'))
    ).resolves.toMatchObject({
      state: 'closed',
      reason: 'template_failed',
    });
  });

  it('does not publish a closed snapshot when a failure belongs to another template', async () => {
    const { service, chatService } = makeService();
    await service.recordTemplateSentForChat(chat, {
      messageId: 'current-template',
      sentAt: '2026-07-03T10:00:00.000Z',
    });
    chatService.applyChatPatch.mockClear();

    await service.recordTemplateFailureForMessage({
      ...message,
      message_id: 'older-internal-template',
      message_key: {
        ...message.message_key,
        id: 'wamid.older-template',
        is_view_once: false,
      },
      content: {
        type: EMessageType.official_template,
        message: 'Old template',
      },
    });

    expect(chatService.applyChatPatch).not.toHaveBeenCalled();
    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T10:01:00.000Z'))
    ).resolves.toMatchObject({
      state: 'send_uncertain',
      awaiting_template_message_id: 'current-template',
    });
  });

  it('does not resurrect a terminal failure when provider acceptance arrives late', async () => {
    const { service } = makeService();
    const sentAt = '2026-07-03T10:00:00.000Z';
    const templateMessage: IChatMessage = {
      ...message,
      message_id: 'internal-template-1',
      date: sentAt,
      content: {
        type: EMessageType.official_template,
        message: 'Template',
      },
    };

    await service.recordTemplateSentForChat(chat, {
      messageId: templateMessage.message_id,
      sentAt,
    });
    await service.recordTemplateFailureForMessage(templateMessage, 132000);
    await service.recordProviderAcceptedMessage(
      templateMessage,
      'wamid.provider-template-1'
    );

    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T10:01:00.000Z'))
    ).resolves.toMatchObject({
      state: 'closed',
      reason: 'template_failed',
      can_send_template: true,
      last_meta_error_code: 132000,
    });
  });

  it('keeps an ambiguous send fail-closed with a bounded provider-confirmation deadline', async () => {
    const { service } = makeService();
    const sentAt = '2026-07-03T10:00:00.000Z';
    const templateMessage: IChatMessage = {
      ...message,
      message_id: 'internal-template-1',
      date: sentAt,
      content: {
        type: EMessageType.official_template,
        message: 'Template',
      },
    };

    await service.recordTemplateSentForChat(chat, {
      messageId: templateMessage.message_id,
      sentAt,
    });
    await service.recordTemplateUncertainForMessage(
      templateMessage,
      'wamid.provider-template-1'
    );

    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T10:01:00.000Z'))
    ).resolves.toMatchObject({
      state: 'send_uncertain',
      reason: 'template_send_uncertain',
      can_send_freeform: false,
      can_send_template: false,
      awaiting_contact_reply_since: sentAt,
      awaiting_contact_reply_expires_at: '2026-07-04T10:00:00.000Z',
      awaiting_template_message_id: 'internal-template-1',
    });

    await expect(
      service.assertCanSendFreeform(
        ((key: string) => key) as never,
        chat,
        EMessageType.text
      )
    ).rejects.toThrow('whatsapp_official_template_send_uncertain');

    await expect(
      service.resolveForChat(chat, new Date('2026-07-04T10:00:01.000Z'))
    ).resolves.toMatchObject({
      state: 'closed',
      reason: 'template_send_uncertain',
      can_send_template: true,
    });
  });

  it('turns an uncertain send into awaiting from the first positive provider acknowledgement', async () => {
    const { service, repository } = makeService();
    const sentAt = '2026-07-03T10:00:00.000Z';
    const templateMessage: IChatMessage = {
      ...message,
      message_id: 'internal-template-1',
      date: sentAt,
      content: {
        type: EMessageType.official_template,
        message: 'Template',
      },
    };

    await service.recordTemplateSentForChat(chat, {
      messageId: templateMessage.message_id,
      sentAt,
    });
    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T10:00:30.000Z'))
    ).resolves.toMatchObject({
      state: 'send_uncertain',
      awaiting_contact_reply_since: sentAt,
    });
    await service.recordProviderAcceptedMessage(
      templateMessage,
      'wamid.provider-template-1'
    );

    expect(repository.confirmAwaitingTemplate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providerMessageId: 'wamid.provider-template-1',
        providerAcceptedAt: '2026-07-03T10:01:00.000Z',
      })
    );

    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T10:01:00.000Z'))
    ).resolves.toMatchObject({
      state: 'awaiting_contact_reply',
      can_send_template: false,
      awaiting_contact_reply_since: '2026-07-03T10:01:00.000Z',
      awaiting_contact_reply_expires_at: '2026-07-04T10:01:00.000Z',
      awaiting_template_message_id: 'wamid.provider-template-1',
      closed_reason: 'template_pending',
    });

    jest.setSystemTime(new Date('2026-07-03T10:03:00.000Z'));
    await service.recordTemplateSentForChat(chat, {
      messageId: templateMessage.message_id,
      sentAt,
    });
    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T10:03:00.000Z'))
    ).resolves.toMatchObject({
      state: 'awaiting_contact_reply',
      closed_reason: 'template_pending',
      awaiting_contact_reply_since: '2026-07-03T10:01:00.000Z',
    });

    jest.setSystemTime(new Date('2026-07-03T10:05:00.000Z'));
    await service.recordProviderAcceptedMessage(
      templateMessage,
      'wamid.provider-template-1'
    );
    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T10:05:00.000Z'))
    ).resolves.toMatchObject({
      state: 'awaiting_contact_reply',
      awaiting_contact_reply_since: '2026-07-03T10:01:00.000Z',
      awaiting_contact_reply_expires_at: '2026-07-04T10:01:00.000Z',
    });
  });

  it('promotes the same uncertain send by timestamp when acknowledgement ids cannot correlate', async () => {
    const { service, repository } = makeService();
    const sentAt = '2026-07-03T10:00:00.000Z';
    await service.recordTemplateSentForChat(chat, {
      messageId: 'internal-reservation-id',
      sentAt,
    });

    await service.recordProviderAcceptedMessage(
      {
        ...message,
        message_id: 'incomplete-projection-id',
        date: sentAt,
        content: {
          type: EMessageType.official_template,
          message: 'Template',
        },
      },
      'wamid.provider-only-id'
    );

    expect(repository.confirmAwaitingTemplate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        templateMessageIds: [
          'wamid.provider-only-id',
          'incomplete-projection-id',
        ],
      })
    );
    expect(repository.upsertTemplateSent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sentAt,
        phase: 'provider_accepted',
        providerAcceptedAt: '2026-07-03T10:01:00.000Z',
      })
    );
    await expect(
      service.resolveForChat(chat, new Date('2026-07-03T10:01:00.000Z'))
    ).resolves.toMatchObject({
      state: 'awaiting_contact_reply',
      awaiting_contact_reply_since: '2026-07-03T10:01:00.000Z',
      awaiting_template_message_id: 'wamid.provider-only-id',
    });
  });

  it('self-heals a legacy pending template from a canonical definitive failure and stays idempotent', async () => {
    const { service, repository, chatService } = makeService();
    const internalMessageId = 'internal-template-failed';
    const reservedMessage = makeOfficialTemplateMessage({
      message_id: internalMessageId,
      message_key: {
        id: null,
        remote_jid: '5511999999999@s.whatsapp.net',
        is_view_once: false,
      },
    });
    await service.recordTemplateSentForChat(chat, {
      messageId: internalMessageId,
      sentAt: reservedMessage.date,
    });
    await service.recordProviderAcceptedMessage(reservedMessage);

    const failedMessage = makeOfficialTemplateMessage({
      message_id: internalMessageId,
      delivery_status: 'failed',
      provider_error_code: 132000,
      summary: {
        is_sent: false,
        is_delivered: false,
        is_seen: false,
        is_sent_to_internal: false,
      },
    });
    chatService.findMessageByMessageId.mockResolvedValue(failedMessage);

    await expect(
      service.resolveAuthoritativeForChat(
        chat,
        new Date('2026-07-03T10:02:00.000Z')
      )
    ).resolves.toMatchObject({
      state: 'closed',
      reason: 'template_failed',
      can_send_template: true,
      last_meta_error_code: 132000,
    });
    expect(repository.clearAwaitingTemplate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        templateMessageIds: expect.arrayContaining([
          internalMessageId,
          'wamid.template-legacy',
        ]),
        errorCode: 132000,
      })
    );

    await service.resolveAuthoritativeForChat(
      chat,
      new Date('2026-07-03T10:03:00.000Z')
    );
    expect(repository.clearAwaitingTemplate).toHaveBeenCalledTimes(1);
    expect(chatService.findMessageByMessageId).toHaveBeenCalledTimes(1);
  });

  it('self-heals a provider-id legacy pending template to uncertain from the canonical ambiguous outcome', async () => {
    const { service, repository, chatService } = makeService();
    const providerMessageId = 'wamid.template-ambiguous';
    const reservedMessage = makeOfficialTemplateMessage({
      message_id: 'internal-template-ambiguous',
    });
    await service.recordTemplateSentForChat(chat, {
      messageId: reservedMessage.message_id,
      sentAt: reservedMessage.date,
    });
    await service.recordProviderAcceptedMessage(
      reservedMessage,
      providerMessageId
    );

    chatService.findOfficialOutboundMessageByProviderId.mockResolvedValue(
      makeOfficialTemplateMessage({
        message_id: reservedMessage.message_id,
        message_key: {
          id: providerMessageId,
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
          is_view_once: false,
        },
        delivery_status: 'ambiguous',
        summary: {
          is_sent: false,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: false,
        },
      })
    );

    await expect(
      service.resolveAuthoritativeForChat(
        chat,
        new Date('2026-07-03T10:02:00.000Z')
      )
    ).resolves.toMatchObject({
      state: 'send_uncertain',
      reason: 'template_send_uncertain',
      awaiting_template_message_id: providerMessageId,
      awaiting_contact_reply_since: '2026-07-03T10:01:00.000Z',
    });
    expect(chatService.findMessageByMessageId).toHaveBeenCalledWith(
      chat.account.id,
      providerMessageId
    );
    expect(
      chatService.findOfficialOutboundMessageByProviderId
    ).toHaveBeenCalledWith(chat.account.id, chat.worker.id, providerMessageId);
    expect(repository.markAwaitingTemplateUncertain).toHaveBeenCalledWith(
      expect.objectContaining({
        templateMessageIds: expect.arrayContaining([
          providerMessageId,
          reservedMessage.message_id,
        ]),
      })
    );
  });

  it('self-heals an uncertain reservation from a canonical positive outcome using the provider timestamp', async () => {
    const { service, repository, chatService } = makeService();
    const internalMessageId = 'internal-template-positive';
    const providerMessageId = 'wamid.template-positive';
    await service.recordTemplateSentForChat(chat, {
      messageId: internalMessageId,
      sentAt: '2026-07-03T10:00:00.000Z',
    });
    chatService.findMessageByMessageId.mockResolvedValue(
      makeOfficialTemplateMessage({
        message_id: internalMessageId,
        message_key: {
          id: providerMessageId,
          remote_jid: '5511999999999@s.whatsapp.net',
          from_me: true,
          is_view_once: false,
        },
        delivery_status: 'sent',
        provider_status_at: '2026-07-03T10:00:37.000Z',
        summary: {
          is_sent: true,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: true,
        },
      })
    );

    await expect(
      service.resolveAuthoritativeForChat(
        chat,
        new Date('2026-07-03T10:01:00.000Z')
      )
    ).resolves.toMatchObject({
      state: 'awaiting_contact_reply',
      awaiting_contact_reply_since: '2026-07-03T10:00:37.000Z',
      awaiting_contact_reply_expires_at: '2026-07-04T10:00:37.000Z',
      awaiting_template_message_id: providerMessageId,
    });
    expect(repository.confirmAwaitingTemplate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        templateMessageIds: expect.arrayContaining([
          internalMessageId,
          providerMessageId,
        ]),
        providerMessageId,
        providerAcceptedAt: '2026-07-03T10:00:37.000Z',
      })
    );
  });

  it('keeps a canonical delivered outcome authoritative over stale failure fields', async () => {
    const { service, repository, chatService } = makeService();
    const internalMessageId = 'internal-template-delivered';
    const reservedMessage = makeOfficialTemplateMessage({
      message_id: internalMessageId,
      message_key: {
        id: null,
        remote_jid: '5511999999999@s.whatsapp.net',
        is_view_once: false,
      },
    });
    await service.recordTemplateSentForChat(chat, {
      messageId: internalMessageId,
      sentAt: reservedMessage.date,
    });
    await service.recordProviderAcceptedMessage(reservedMessage);
    repository.clearAwaitingTemplate.mockClear();
    repository.markAwaitingTemplateUncertain.mockClear();
    repository.confirmAwaitingTemplate.mockClear();
    chatService.findMessageByMessageId.mockResolvedValue(
      makeOfficialTemplateMessage({
        message_id: internalMessageId,
        delivery_status: 'failed',
        provider_error_code: 132000,
        summary: {
          is_sent: true,
          is_delivered: true,
          is_seen: false,
          is_sent_to_internal: false,
        },
      })
    );

    await expect(
      service.resolveAuthoritativeForChat(
        chat,
        new Date('2026-07-03T10:02:00.000Z')
      )
    ).resolves.toMatchObject({
      state: 'awaiting_contact_reply',
      closed_reason: 'template_pending',
    });
    expect(repository.clearAwaitingTemplate).not.toHaveBeenCalled();
    expect(repository.markAwaitingTemplateUncertain).not.toHaveBeenCalled();
    expect(repository.confirmAwaitingTemplate).not.toHaveBeenCalled();
  });

  it.each(['queued', 'not_found', 'elasticsearch_error'] as const)(
    'preserves a legacy pending template when the canonical outcome is %s',
    async (scenario) => {
      const { service, repository, chatService } = makeService();
      const internalMessageId = `internal-template-${scenario}`;
      const reservedMessage = makeOfficialTemplateMessage({
        message_id: internalMessageId,
        message_key: {
          id: null,
          remote_jid: '5511999999999@s.whatsapp.net',
          is_view_once: false,
        },
      });
      await service.recordTemplateSentForChat(chat, {
        messageId: internalMessageId,
        sentAt: reservedMessage.date,
      });
      await service.recordProviderAcceptedMessage(reservedMessage);
      repository.clearAwaitingTemplate.mockClear();
      repository.markAwaitingTemplateUncertain.mockClear();
      repository.confirmAwaitingTemplate.mockClear();

      const warning = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      if (scenario === 'queued') {
        chatService.findMessageByMessageId.mockResolvedValue(
          makeOfficialTemplateMessage({
            message_id: internalMessageId,
            delivery_status: 'queued',
          })
        );
      } else if (scenario === 'elasticsearch_error') {
        chatService.findMessageByMessageId.mockRejectedValue(
          new Error('elasticsearch_unavailable')
        );
      }

      await expect(
        service.resolveAuthoritativeForChat(
          chat,
          new Date('2026-07-03T10:02:00.000Z')
        )
      ).resolves.toMatchObject({
        state: 'awaiting_contact_reply',
        closed_reason: 'template_pending',
      });
      expect(repository.clearAwaitingTemplate).not.toHaveBeenCalled();
      expect(repository.markAwaitingTemplateUncertain).not.toHaveBeenCalled();
      expect(repository.confirmAwaitingTemplate).not.toHaveBeenCalled();
      if (scenario === 'elasticsearch_error') {
        expect(warning).toHaveBeenCalledWith(
          '[OfficialWhatsappWindow] Awaiting template read repair deferred',
          expect.objectContaining({ error: 'elasticsearch_unavailable' })
        );
      }
      warning.mockRestore();
    }
  );

  it.each([
    [
      'contact identity',
      makeOfficialTemplateMessage({
        message_id: 'internal-template-invalid-identity',
        phone: '5511888888888',
        message_key: {
          id: 'wamid.wrong-contact',
          remote_jid: '5511888888888@s.whatsapp.net',
          from_me: true,
          is_view_once: false,
        },
        delivery_status: 'failed',
        summary: {
          is_sent: false,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: false,
        },
      }),
    ],
    [
      'outbound actor allowlist',
      makeOfficialTemplateMessage({
        message_id: 'internal-template-invalid-identity',
        type_user: 'legacy_unknown' as ETypeUserChat,
        delivery_status: 'failed',
        summary: {
          is_sent: false,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: false,
        },
      }),
    ],
  ])(
    'rejects a canonical failure with mismatched %s',
    async (_case, invalid) => {
      const { service, repository, chatService } = makeService();
      const internalMessageId = 'internal-template-invalid-identity';
      const reservedMessage = makeOfficialTemplateMessage({
        message_id: internalMessageId,
        message_key: {
          id: null,
          remote_jid: '5511999999999@s.whatsapp.net',
          is_view_once: false,
        },
      });
      await service.recordTemplateSentForChat(chat, {
        messageId: internalMessageId,
        sentAt: reservedMessage.date,
      });
      await service.recordProviderAcceptedMessage(reservedMessage);
      repository.clearAwaitingTemplate.mockClear();
      chatService.findMessageByMessageId.mockResolvedValue(invalid);

      await expect(
        service.resolveAuthoritativeForChat(
          chat,
          new Date('2026-07-03T10:02:00.000Z')
        )
      ).resolves.toMatchObject({
        state: 'awaiting_contact_reply',
        closed_reason: 'template_pending',
      });
      expect(repository.clearAwaitingTemplate).not.toHaveBeenCalled();
    }
  );

  it('uses a listed message only to resolve the internal id and classifies its realtime document', async () => {
    const { service, repository, chatService } = makeService();
    const internalMessageId = 'internal-template-listed';
    const reservedMessage = makeOfficialTemplateMessage({
      message_id: internalMessageId,
      message_key: {
        id: null,
        remote_jid: '5511999999999@s.whatsapp.net',
        is_view_once: false,
      },
    });
    await service.recordTemplateSentForChat(chat, {
      messageId: internalMessageId,
      sentAt: reservedMessage.date,
    });
    await service.recordProviderAcceptedMessage(reservedMessage);
    chatService.findMessageByMessageId.mockResolvedValue(
      makeOfficialTemplateMessage({
        message_id: internalMessageId,
        delivery_status: 'ambiguous',
        summary: {
          is_sent: false,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: false,
        },
      })
    );

    await expect(
      service.reconcileFromMessages(
        chat,
        [
          makeOfficialTemplateMessage({
            message_id: internalMessageId,
            delivery_status: 'failed',
            summary: {
              is_sent: false,
              is_delivered: false,
              is_seen: false,
              is_sent_to_internal: false,
            },
          }),
        ],
        new Date('2026-07-03T10:02:00.000Z')
      )
    ).resolves.toMatchObject({ state: 'send_uncertain' });
    expect(repository.markAwaitingTemplateUncertain).toHaveBeenCalled();
    expect(chatService.findMessageByMessageId).toHaveBeenCalledWith(
      chat.account.id,
      internalMessageId
    );
    expect(
      chatService.findOfficialOutboundMessageByProviderId
    ).not.toHaveBeenCalled();
  });
});
