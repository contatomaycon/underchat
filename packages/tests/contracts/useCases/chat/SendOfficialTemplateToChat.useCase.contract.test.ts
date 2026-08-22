import 'reflect-metadata';

jest.mock('uuid', () => ({ v7: jest.fn(() => 'template-message-1') }));
jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { IChat } from '@core/common/interfaces/IChat';
import { OfficialWhatsappTemplateService } from '@core/services/officialWhatsappTemplate.service';
import { SendOfficialTemplateToChatUseCase } from '@core/useCases/chat/SendOfficialTemplateToChat.useCase';

const chat: IChat = {
  chat_id: 'chat-1',
  account: { id: 'account-1', name: 'UnderChat' },
  worker: {
    id: 'worker-1',
    name: 'Official',
    type_id: EWorkerType.whatsapp,
    is_official: true,
  },
  user: { id: 'user-1', name: 'Agent' },
  contact: { id: 'contact-1', name: 'Maycon', phone: '11999999999' },
  name: 'Maycon',
  phone: '5511999999999',
  status: EChatStatus.in_chat,
  date: '2026-07-20T10:00:00.000Z',
};

function makeUseCase(accepted = true) {
  let currentWindow: NonNullable<IChat['official_window']> = {
    is_official: true,
    state: 'closed',
    reason: 'customer_service_window_closed',
    can_send_freeform: false,
    can_send_template: true,
  };
  const officialWindowService = {
    resolveAuthoritativeForChat: jest.fn(async () => currentWindow),
    recordTemplateSentForChat: jest.fn(async (currentChat: IChat, input) => {
      currentWindow = {
        ...currentWindow,
        state: 'send_uncertain',
        reason: 'template_send_uncertain',
        can_send_freeform: false,
        can_send_template: false,
        awaiting_contact_reply_since: input.sentAt,
        awaiting_template_message_id: input.messageId,
        last_template_sent_at: input.sentAt,
        closed_reason: 'template_send_uncertain',
      };
      return { ...currentChat, official_window: currentWindow };
    }),
    recordTemplateFailureForMessage: jest.fn(
      async (_message?: unknown, _errorCode?: number | null) => {
        currentWindow = {
          ...currentWindow,
          state: 'closed',
          reason: 'template_failed',
          can_send_freeform: false,
          can_send_template: true,
          awaiting_contact_reply_since: null,
          awaiting_template_message_id: null,
          closed_reason: 'template_failed',
        };
      }
    ),
  };
  const chatMessageService = {
    publishPreparedMessage: jest.fn(async (_message?: unknown) => accepted),
  };
  const templateService = new OfficialWhatsappTemplateService();
  const useCase = new SendOfficialTemplateToChatUseCase(
    { findChatByChatId: jest.fn(async () => chat) } as never,
    { viewWorkerType: jest.fn() } as never,
    {
      viewUserNamePhoto: jest.fn(async () => ({
        id: 'user-1',
        name: 'Agent',
        photo: null,
      })),
    } as never,
    chatMessageService as never,
    { decrypt: jest.fn(() => 'plain-token') } as never,
    {
      listApprovedMessageTemplates: jest.fn(async () => [
        {
          id: 'template-1',
          name: 'service_update',
          language: 'pt_BR',
          status: 'APPROVED',
          category: 'UTILITY',
          parameter_format: 'POSITIONAL',
          components: [{ type: 'BODY', text: 'Olá {{1}}, protocolo {{2}}' }],
        },
      ]),
    } as never,
    templateService,
    {
      findActiveByWorkerId: jest.fn(async () => ({
        api_version: 'v25.0',
        access_token_encrypted: 'encrypted-token',
        waba_id: 'waba-1',
      })),
    } as never,
    officialWindowService as never
  );

  return { useCase, chatMessageService, officialWindowService };
}

const request = {
  name: 'service_update',
  language: 'pt_BR',
  variables: [
    {
      key: 'BODY:1',
      component_type: 'BODY' as const,
      index: 1,
      value: '{{ name }}',
    },
    {
      key: 'BODY:2',
      component_type: 'BODY' as const,
      index: 2,
      value: 42,
    },
  ],
};

describe('SendOfficialTemplateToChatUseCase', () => {
  it('resolves built-ins and numeric values before preview and persistence', async () => {
    const { useCase, chatMessageService, officialWindowService } =
      makeUseCase();

    const result = await useCase.execute(
      ((key: string) => key) as never,
      'account-1',
      'chat-1',
      'user-1',
      request,
      [],
      []
    );

    expect(chatMessageService.publishPreparedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          message: 'Olá Maycon, protocolo 42',
          official_template: expect.objectContaining({
            parameter_format: 'POSITIONAL',
            variables: [
              expect.objectContaining({ value: 'Maycon' }),
              expect.objectContaining({ value: '42' }),
            ],
          }),
        }),
      })
    );
    expect(officialWindowService.recordTemplateSentForChat).toHaveBeenCalled();
    expect(
      officialWindowService.recordTemplateSentForChat.mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      chatMessageService.publishPreparedMessage.mock.invocationCallOrder[0]
    );
    expect(result.official_window).toMatchObject({
      state: 'send_uncertain',
      reason: 'template_send_uncertain',
      can_send_template: false,
    });
  });

  it('rolls back the reservation when the queue rejects the message', async () => {
    const { useCase, officialWindowService } = makeUseCase(false);

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'chat-1',
        'user-1',
        request,
        [],
        []
      )
    ).rejects.toThrow('official_template_queue_not_accepted');

    expect(officialWindowService.recordTemplateSentForChat).toHaveBeenCalled();
    expect(
      officialWindowService.recordTemplateFailureForMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({ message_id: 'template-message-1' })
    );
  });

  it('does not publish another template while awaiting the contact reply', async () => {
    const { useCase, chatMessageService, officialWindowService } =
      makeUseCase();
    officialWindowService.resolveAuthoritativeForChat.mockResolvedValue({
      is_official: true,
      state: 'awaiting_contact_reply',
      reason: 'customer_reply_required',
      can_send_freeform: false,
      can_send_template: false,
    });

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'chat-1',
        'user-1',
        request,
        [],
        []
      )
    ).rejects.toThrow('whatsapp_official_waiting_contact_reply');

    expect(chatMessageService.publishPreparedMessage).not.toHaveBeenCalled();
    expect(
      officialWindowService.recordTemplateSentForChat
    ).not.toHaveBeenCalled();
  });

  it('does not enqueue when the window reservation cannot be persisted', async () => {
    const { useCase, chatMessageService, officialWindowService } =
      makeUseCase();
    officialWindowService.recordTemplateSentForChat.mockRejectedValueOnce(
      new Error('database unavailable')
    );

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'chat-1',
        'user-1',
        request,
        [],
        []
      )
    ).rejects.toThrow('database unavailable');

    expect(chatMessageService.publishPreparedMessage).not.toHaveBeenCalled();
  });

  it('returns the terminal failure when it races and wins before queue acknowledgement', async () => {
    const { useCase, chatMessageService, officialWindowService } =
      makeUseCase();
    chatMessageService.publishPreparedMessage.mockImplementationOnce(
      async (message) => {
        await officialWindowService.recordTemplateFailureForMessage(
          message,
          132000
        );
        return true;
      }
    );

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'chat-1',
        'user-1',
        request,
        [],
        []
      )
    ).resolves.toMatchObject({
      official_window: {
        state: 'closed',
        reason: 'template_failed',
        can_send_template: true,
      },
    });

    expect(
      officialWindowService.resolveAuthoritativeForChat
    ).toHaveBeenCalledTimes(2);
  });
});
