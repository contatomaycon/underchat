import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

jest.mock('@core/services/account.service', () => ({
  AccountService: class AccountService {},
}));

jest.mock('@core/services/user.service', () => ({
  UserService: class UserService {},
}));

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class WorkerService {},
}));

jest.mock('@core/services/workerConfig.service', () => ({
  WorkerConfigService: class WorkerConfigService {},
}));

jest.mock('@core/services/contact.service', () => ({
  ContactService: class ContactService {},
}));

jest.mock('@core/services/sector.service', () => ({
  SectorService: class SectorService {},
}));

jest.mock('@core/services/encrypt.service', () => ({
  EncryptService: class EncryptService {},
}));

jest.mock('@core/services/phoneValidation.service', () => ({
  PhoneValidationService: class PhoneValidationService {},
}));

jest.mock('@core/repositories/chat/ChatUserViewer.repository', () => ({
  ChatUserViewerRepository: class ChatUserViewerRepository {},
}));

jest.mock('@core/services/attendanceInactivity.service', () => ({
  AttendanceInactivityService: class AttendanceInactivityService {},
}));

jest.mock('@core/services/pushNotification.service', () => ({
  PushNotificationService: class PushNotificationService {},
}));

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(async (_redis, _key, fn: () => Promise<unknown>) => fn()),
}));

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'chat-new-1'),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { IChat } from '@core/common/interfaces/IChat';
import { StartChatWithContactUseCase } from '@core/useCases/chat/StartChatWithContact.useCase';

describe('StartChatWithContactUseCase push notifications', () => {
  const account = { id: 'account-1', name: 'Account' };
  const worker = { id: 'worker-1', name: 'WhatsApp' };
  const user = { id: 'user-1', name: 'Agent', photo: null };
  const contact = {
    contact_id: 'contact-1',
    name: 'Contact',
    last_name: null,
    phone_ddi: '55',
    photo: null,
    user: null,
    ignore: 'not_ignore',
    is_valided: true,
  };

  const makeExistingChat = (status: EChatStatus = EChatStatus.queue): IChat =>
    ({
      chat_id: 'chat-1',
      account,
      worker,
      user: null,
      sector: null,
      contact: null,
      name: 'Contact',
      phone: '5511999999999',
      photo: null,
      status,
      date: '2026-06-01T10:00:00.000Z',
      started_at: null,
      closed_at: null,
      forward_to_output_chatbot: true,
    }) as IChat;

  const makeUseCase = (
    existingChat: IChat | null = null,
    validationResponse: {
      valid: boolean;
      phone?: string | null;
      jid?: string | null;
    } = {
      valid: true,
      phone: '5511999999999',
      jid: '5511999999999@s.whatsapp.net',
    }
  ) => {
    let currentChatWindow: NonNullable<IChat['official_window']> = {
      is_official: true,
      state: 'closed',
      reason: 'no_customer_message',
      can_send_freeform: false,
      can_send_template: true,
    };
    const chatService = {
      findOpenChatByIdentity: jest.fn(async () => existingChat),
      ensureProtocolForNewChat: jest.fn(async (chat: IChat) => chat),
      saveChat: jest.fn(async (_chat?: IChat) => true),
      updateChatStatus: jest.fn(async () => true),
      findChatByChatId: jest.fn(async () => ({
        ...existingChat,
        status: EChatStatus.in_chat,
        meta: {
          status_epoch: 2,
          status_event_id: 'status-event-2',
          status_source: 'chat_service',
        },
      })),
      invalidateChatCache: jest.fn(async () => undefined),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => ({})),
    };
    const contactService = {
      viewContactById: jest.fn(async () => contact),
      getContactSensitiveDataDecrypted: jest.fn(async () => ({
        phone: '11999999999',
        email: null,
      })),
      validateContact: jest.fn(async () => true),
      updateContactIsValided: jest.fn(async () => true),
    };
    const pushNotificationService = {
      sendNotificationForChatStatusChange: jest.fn(async () => undefined),
    };
    const workerService = {
      viewWorkerNameAndId: jest.fn(async () => worker),
      viewWorkerConfigFieldsByWorkerId: jest.fn(async () => null),
      viewWorkerType: jest.fn(async () => ({
        worker_id: 'worker-1',
        worker_type_id: 'non-official-worker-type',
      })),
    };
    const chatMessageService = {
      publishPreparedMessage: jest.fn(async (_message?: unknown) => true),
    };
    const metaWhatsappEmbeddedService = {
      listApprovedMessageTemplates: jest.fn(async (): Promise<unknown[]> => []),
    };
    const officialWhatsappTemplateService = {
      normalizeTemplates: jest.fn((value) => value),
      findTemplate: jest.fn(),
      validateVariableValues: jest.fn(),
      buildPreviewText: jest.fn(() => 'Template preview'),
      normalizeVariableValue: jest.fn((value: unknown) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return String(value);
        }
        return typeof value === 'string' ? value.trim() : '';
      }),
    };
    const workerWhatsappOfficialConnectionRepository = {
      findActiveByWorkerId: jest.fn(
        async (): Promise<Record<string, string> | null> => null
      ),
    };
    const officialWindowService = {
      resolveAuthoritativeForIdentity: jest.fn(
        async (): Promise<NonNullable<IChat['official_window']>> =>
          currentChatWindow
      ),
      resolveAuthoritativeForChat: jest.fn(async () => currentChatWindow),
      applySnapshotToChat: jest.fn(
        async (chat: IChat, snapshot: IChat['official_window']) => ({
          ...chat,
          official_window: snapshot,
        })
      ),
      recordTemplateSentForChat: jest.fn(async (currentChat: IChat, input) => {
        currentChatWindow = {
          ...currentChatWindow,
          state: 'send_uncertain',
          reason: 'template_send_uncertain',
          can_send_freeform: false,
          can_send_template: false,
          awaiting_contact_reply_since: input.sentAt,
          awaiting_template_message_id: input.messageId,
          last_template_sent_at: input.sentAt,
          closed_reason: 'template_send_uncertain',
        };
        return { ...currentChat, official_window: currentChatWindow };
      }),
      recordTemplateFailureForMessage: jest.fn(
        async (_message?: unknown, _errorCode?: number | null) => {
          currentChatWindow = {
            ...currentChatWindow,
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
    const useCase = new StartChatWithContactUseCase(
      chatService as never,
      centrifugoService as never,
      { viewAccountName: jest.fn(async () => account) } as never,
      { viewUserNamePhoto: jest.fn(async () => user) } as never,
      workerService as never,
      {
        viewSimultaneousAttendance: jest.fn(async () => 0),
      } as never,
      contactService as never,
      { viewSectorById: jest.fn(async () => null) } as never,
      { sanitize: jest.fn((value: string) => value) } as never,
      {
        validatePhone: jest.fn(async () => validationResponse),
      } as never,
      { findStatusByUserId: jest.fn(async () => 'online') } as never,
      {
        startTrackingOnInChatEntry: jest.fn(async () => undefined),
      } as never,
      pushNotificationService as never,
      chatMessageService as never,
      { decrypt: jest.fn((value: string) => value) } as never,
      metaWhatsappEmbeddedService as never,
      officialWhatsappTemplateService as never,
      workerWhatsappOfficialConnectionRepository as never,
      {
        del: jest.fn(async () => 1),
        zrem: jest.fn(async () => 1),
      } as never,
      officialWindowService as never
    );

    return {
      useCase,
      chatService,
      pushNotificationService,
      workerService,
      chatMessageService,
      metaWhatsappEmbeddedService,
      officialWhatsappTemplateService,
      workerWhatsappOfficialConnectionRepository,
      officialWindowService,
    };
  };

  it('does not send a generic status push when creating a new in-chat attendance', async () => {
    const { useCase, chatService, pushNotificationService } = makeUseCase();

    const chat = await useCase.execute(
      ((key: string) => key) as never,
      'account-1',
      'user-1',
      {
        contact_id: 'contact-1',
        worker_id: 'worker-1',
      }
    );

    expect(chat.status).toBe(EChatStatus.in_chat);
    expect(chat.message_key).toEqual({
      remote_jid: '5511999999999@s.whatsapp.net',
      remote_jid_alt: null,
    });
    expect(chatService.findOpenChatByIdentity).toHaveBeenCalledWith(
      'account-1',
      'worker-1',
      {
        phone: '5511999999999',
        remoteJid: '5511999999999@s.whatsapp.net',
      }
    );
    expect(
      pushNotificationService.sendNotificationForChatStatusChange
    ).not.toHaveBeenCalled();
  });

  it('reconciles a legacy invalid contact for an official worker without remote lookup', async () => {
    const { useCase } = makeUseCase();
    const phoneValidationService = (useCase as any).phoneValidationService;
    const contactService = (useCase as any).contactService;
    contactService.viewContactById.mockResolvedValue({
      ...contact,
      is_valided: false,
    });
    (useCase as any).contactPhoneValidationPolicyService = {
      viewValidationState: jest.fn(async () => ({
        is_valided: false,
        validation_origin: null,
      })),
    };

    await expect(
      (useCase as any).validateAndGetContactData(
        ((key: string) => key) as never,
        'contact-1',
        'account-1',
        true
      )
    ).resolves.toEqual(
      expect.objectContaining({
        fullPhone: '5511999999999',
        contact: expect.objectContaining({ is_valided: true }),
      })
    );

    expect(phoneValidationService.validatePhone).not.toHaveBeenCalled();
    expect(contactService.updateContactIsValided).toHaveBeenCalledWith(
      'contact-1',
      true,
      undefined,
      undefined,
      'official_assumed'
    );
  });

  it('does not reuse official assumed validation when a non-official lookup is unavailable', async () => {
    const { useCase } = makeUseCase();
    (useCase as any).phoneValidationService.validatePhone.mockRejectedValue(
      new Error('unavailable')
    );
    (useCase as any).contactPhoneValidationPolicyService = {
      viewValidationState: jest.fn(async () => ({
        is_valided: true,
        validation_origin: 'official_assumed',
      })),
    };

    await expect(
      (useCase as any).validateAndGetContactData(
        ((key: string) => key) as never,
        'contact-1',
        'account-1',
        false
      )
    ).rejects.toThrow('contact_must_be_validated');
  });

  it('does not send a generic status push when moving an existing queue chat to in-chat', async () => {
    const existingChat = makeExistingChat(EChatStatus.queue);
    const { useCase, pushNotificationService } = makeUseCase(existingChat);

    const chat = await useCase.execute(
      ((key: string) => key) as never,
      'account-1',
      'user-1',
      {
        contact_id: 'contact-1',
        worker_id: 'worker-1',
      }
    );

    expect(chat.status).toBe(EChatStatus.in_chat);
    expect(
      pushNotificationService.sendNotificationForChatStatusChange
    ).not.toHaveBeenCalled();
  });

  it('does not rewrite or emit another assignment event for an already-owned reused chat', async () => {
    const existingChat = makeExistingChat(EChatStatus.in_chat);
    existingChat.message_key = {
      remote_jid: '5511999999999@s.whatsapp.net',
      remote_jid_alt: null,
    };
    existingChat.worker = {
      ...worker,
      type_id: 'non-official-worker-type',
      is_official: false,
    };
    existingChat.user = {
      ...user,
      entered_at: '2026-06-01T10:00:00.000Z',
    };
    existingChat.contact = {
      id: 'contact-1',
      name: 'Contact',
      phone: '11999999999',
      phone_ddi: '55',
      photo: null,
      responsible_attendant: null,
      ignore: 'not_ignore',
    };
    existingChat.started_at = '2026-06-01T10:00:00.000Z';
    const { useCase, chatService } = makeUseCase(existingChat);

    await expect(
      useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'user-1',
        {
          contact_id: 'contact-1',
          worker_id: 'worker-1',
        },
        [],
        { onExistingInChat: 'reuse_and_takeover' }
      )
    ).resolves.toBe(existingChat);

    expect(chatService.saveChat).not.toHaveBeenCalled();
  });

  const configureOfficialOpening = (
    setup: ReturnType<typeof makeUseCase>,
    state: 'open' | 'closed' | 'awaiting_contact_reply' | 'send_uncertain'
  ) => {
    setup.workerService.viewWorkerType.mockResolvedValue({
      worker_id: 'worker-1',
      worker_type_id: EWorkerType.whatsapp,
    });
    setup.officialWindowService.resolveAuthoritativeForIdentity.mockResolvedValue(
      {
        is_official: true,
        state,
        reason:
          state === 'open'
            ? 'customer_service_window_open'
            : state === 'awaiting_contact_reply'
              ? 'customer_reply_required'
              : state === 'send_uncertain'
                ? 'template_send_uncertain'
                : 'no_customer_message',
        can_send_freeform: state === 'open',
        can_send_template:
          state !== 'awaiting_contact_reply' && state !== 'send_uncertain',
        last_inbound_at: state === 'closed' ? null : '2026-07-20T10:00:00.000Z',
        service_window_expires_at:
          state === 'open' ? '2026-07-21T10:00:00.000Z' : null,
      }
    );
    setup.workerWhatsappOfficialConnectionRepository.findActiveByWorkerId.mockResolvedValue(
      {
        api_version: 'v25.0',
        access_token_encrypted: 'encrypted-token',
        waba_id: 'waba-1',
      }
    );
    const template = {
      id: 'template-1',
      name: 'service_update',
      language: 'pt_BR',
      status: 'APPROVED' as const,
      parameter_format: 'POSITIONAL' as const,
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Olá {{1}} / {{2}}' }],
      variables: [
        { key: 'BODY:1', component_type: 'BODY' as const, index: 1 },
        { key: 'BODY:2', component_type: 'BODY' as const, index: 2 },
      ],
      preview: { body: 'Olá {{1}} / {{2}}' },
    };
    setup.metaWhatsappEmbeddedService.listApprovedMessageTemplates.mockResolvedValue(
      [template]
    );
    setup.officialWhatsappTemplateService.findTemplate.mockReturnValue(
      template
    );
    setup.officialWhatsappTemplateService.validateVariableValues.mockImplementation(
      ({ values }) => values
    );
  };

  it('allows repeated openings without a template while the last inbound window is open', async () => {
    const setup = makeUseCase();
    configureOfficialOpening(setup, 'open');

    for (let opening = 0; opening < 2; opening += 1) {
      const result = await setup.useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'user-1',
        {
          contact_id: 'contact-1',
          worker_id: 'worker-1',
          official_template: {
            name: 'stale_template',
            language: 'pt_BR',
          },
        }
      );

      expect(result.official_window?.state).toBe('open');
    }

    expect(
      setup.metaWhatsappEmbeddedService.listApprovedMessageTemplates
    ).not.toHaveBeenCalled();
    expect(
      setup.chatMessageService.publishPreparedMessage
    ).not.toHaveBeenCalled();
    expect(setup.chatService.saveChat).toHaveBeenCalledTimes(2);
    expect(
      setup.officialWindowService.resolveAuthoritativeForIdentity
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        workerId: 'worker-1',
        phone: '5511999999999',
      }),
      expect.any(Date)
    );
  });

  it('rejects a new opening while an initiated conversation awaits the contact reply', async () => {
    const setup = makeUseCase();
    configureOfficialOpening(setup, 'awaiting_contact_reply');

    await expect(
      setup.useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'user-1',
        {
          contact_id: 'contact-1',
          worker_id: 'worker-1',
        }
      )
    ).rejects.toThrow('whatsapp_official_waiting_contact_reply');

    expect(setup.chatService.findOpenChatByIdentity).not.toHaveBeenCalled();
    expect(setup.chatService.saveChat).not.toHaveBeenCalled();
    expect(
      setup.chatMessageService.publishPreparedMessage
    ).not.toHaveBeenCalled();
  });

  it('returns the refreshable domain conflict when the window closed without a template', async () => {
    const setup = makeUseCase();
    configureOfficialOpening(setup, 'closed');

    await expect(
      setup.useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'user-1',
        { contact_id: 'contact-1', worker_id: 'worker-1' }
      )
    ).rejects.toThrow('official_window_requires_template_refresh');

    expect(setup.chatService.saveChat).not.toHaveBeenCalled();
  });

  it('rejects an invalid template during preflight without mutating the chat or window', async () => {
    const setup = makeUseCase();
    configureOfficialOpening(setup, 'closed');
    setup.officialWhatsappTemplateService.findTemplate.mockReturnValue(null);

    await expect(
      setup.useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'user-1',
        {
          contact_id: 'contact-1',
          worker_id: 'worker-1',
          official_template: {
            name: 'not_approved',
            language: 'pt_BR',
          },
        }
      )
    ).rejects.toThrow('official_template_not_approved_or_not_found');

    expect(setup.chatService.findOpenChatByIdentity).not.toHaveBeenCalled();
    expect(setup.chatService.saveChat).not.toHaveBeenCalled();
    expect(
      setup.officialWindowService.recordTemplateSentForChat
    ).not.toHaveBeenCalled();
  });

  it('rejects invalid template variables during preflight before taking the chat', async () => {
    const setup = makeUseCase();
    configureOfficialOpening(setup, 'closed');
    setup.officialWhatsappTemplateService.validateVariableValues.mockImplementationOnce(
      () => {
        throw new Error('official_template_variables_required');
      }
    );

    await expect(
      setup.useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'user-1',
        {
          contact_id: 'contact-1',
          worker_id: 'worker-1',
          official_template: {
            name: 'service_update',
            language: 'pt_BR',
            variables: [],
          },
        }
      )
    ).rejects.toThrow('official_template_variables_required');

    expect(setup.chatService.findOpenChatByIdentity).not.toHaveBeenCalled();
    expect(setup.chatService.saveChat).not.toHaveBeenCalled();
    expect(
      setup.officialWindowService.recordTemplateSentForChat
    ).not.toHaveBeenCalled();
  });

  it('resolves built-in tags and numeric values before persisting the opening template', async () => {
    const setup = makeUseCase();
    configureOfficialOpening(setup, 'closed');

    const result = await setup.useCase.execute(
      ((key: string) => key) as never,
      'account-1',
      'user-1',
      {
        contact_id: 'contact-1',
        worker_id: 'worker-1',
        official_template: {
          name: 'service_update',
          language: 'pt_BR',
          variables: [
            {
              key: 'BODY:1',
              component_type: 'BODY',
              index: 1,
              value: '{{ name }}',
            },
            {
              key: 'BODY:2',
              component_type: 'BODY',
              index: 2,
              value: 42,
            },
          ],
        },
      }
    );

    expect(
      setup.officialWhatsappTemplateService.validateVariableValues
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        values: [
          expect.objectContaining({ value: 'Contact' }),
          expect.objectContaining({ value: '42' }),
        ],
      })
    );
    expect(setup.chatMessageService.publishPreparedMessage).toHaveBeenCalled();
    expect(
      setup.officialWindowService.recordTemplateSentForChat
    ).toHaveBeenCalledTimes(1);
    expect(result.official_window).toMatchObject({
      state: 'send_uncertain',
      reason: 'template_send_uncertain',
      can_send_template: false,
    });
  });

  it('rejects a built-in tag that resolves empty before mutating the chat', async () => {
    const setup = makeUseCase();
    configureOfficialOpening(setup, 'closed');
    setup.officialWhatsappTemplateService.validateVariableValues.mockImplementation(
      ({ values }) => {
        if (
          values?.some((variable: { value: unknown }) => variable.value === '')
        ) {
          throw new Error('official_template_variable_value_invalid');
        }
        return values;
      }
    );

    await expect(
      setup.useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'user-1',
        {
          contact_id: 'contact-1',
          worker_id: 'worker-1',
          official_template: {
            name: 'service_update',
            language: 'pt_BR',
            variables: [
              {
                key: 'BODY:1',
                component_type: 'BODY',
                index: 1,
                value: '{{ sector }}',
              },
              {
                key: 'BODY:2',
                component_type: 'BODY',
                index: 2,
                value: 42,
              },
            ],
          },
        }
      )
    ).rejects.toThrow('official_template_variables_required');

    expect(setup.chatService.saveChat).not.toHaveBeenCalled();
    expect(
      setup.chatMessageService.publishPreparedMessage
    ).not.toHaveBeenCalled();
    expect(
      setup.officialWindowService.recordTemplateSentForChat
    ).not.toHaveBeenCalled();
  });

  it('skips a preflighted template when an inbound opens the window before mutation', async () => {
    const setup = makeUseCase();
    configureOfficialOpening(setup, 'closed');
    setup.officialWindowService.resolveAuthoritativeForIdentity
      .mockResolvedValueOnce({
        is_official: true,
        state: 'closed',
        reason: 'no_customer_message',
        can_send_freeform: false,
        can_send_template: true,
      })
      .mockResolvedValueOnce({
        is_official: true,
        state: 'open',
        reason: 'customer_service_window_open',
        can_send_freeform: true,
        can_send_template: true,
        last_inbound_at: '2026-07-21T10:00:00.000Z',
        service_window_expires_at: '2026-07-22T10:00:00.000Z',
      });

    const result = await setup.useCase.execute(
      ((key: string) => key) as never,
      'account-1',
      'user-1',
      {
        contact_id: 'contact-1',
        worker_id: 'worker-1',
        official_template: {
          name: 'service_update',
          language: 'pt_BR',
          variables: [
            {
              key: 'BODY:1',
              component_type: 'BODY',
              index: 1,
              value: 'Maycon',
            },
            {
              key: 'BODY:2',
              component_type: 'BODY',
              index: 2,
              value: 42,
            },
          ],
        },
      }
    );

    expect(result.official_window?.state).toBe('open');
    expect(setup.chatService.saveChat).toHaveBeenCalled();
    expect(
      setup.chatMessageService.publishPreparedMessage
    ).not.toHaveBeenCalled();
    expect(
      setup.officialWindowService.recordTemplateSentForChat
    ).not.toHaveBeenCalled();
  });

  it('does not create false pending state and reuses the chat when queueing is retried', async () => {
    const setup = makeUseCase();
    configureOfficialOpening(setup, 'closed');
    let savedChat: IChat | null = null;
    setup.chatService.findOpenChatByIdentity.mockImplementation(
      async () => savedChat
    );
    setup.chatService.saveChat.mockImplementation(async (chat?: IChat) => {
      if (chat) savedChat = chat;
      return true;
    });
    setup.chatMessageService.publishPreparedMessage
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const request = {
      contact_id: 'contact-1',
      worker_id: 'worker-1',
      official_template: {
        name: 'service_update',
        language: 'pt_BR',
        variables: [
          {
            key: 'BODY:1',
            component_type: 'BODY' as const,
            index: 1,
            value: 'Contact',
          },
          {
            key: 'BODY:2',
            component_type: 'BODY' as const,
            index: 2,
            value: '42',
          },
        ],
      },
    };

    await expect(
      setup.useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'user-1',
        request
      )
    ).rejects.toThrow('official_template_queue_not_accepted');
    expect(
      setup.officialWindowService.recordTemplateSentForChat
    ).toHaveBeenCalledTimes(1);
    expect(
      setup.officialWindowService.recordTemplateFailureForMessage
    ).toHaveBeenCalledTimes(1);

    await expect(
      setup.useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'user-1',
        request
      )
    ).resolves.toMatchObject({
      chat_id: 'chat-new-1',
      official_window: { state: 'send_uncertain' },
    });

    expect(
      setup.chatMessageService.publishPreparedMessage
    ).toHaveBeenCalledTimes(2);
    expect(
      setup.officialWindowService.recordTemplateSentForChat
    ).toHaveBeenCalledTimes(2);
  });

  it('does not enqueue when the window reservation cannot be persisted', async () => {
    const setup = makeUseCase();
    configureOfficialOpening(setup, 'closed');
    setup.officialWindowService.recordTemplateSentForChat.mockRejectedValueOnce(
      new Error('database unavailable')
    );

    await expect(
      setup.useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'user-1',
        {
          contact_id: 'contact-1',
          worker_id: 'worker-1',
          official_template: {
            name: 'service_update',
            language: 'pt_BR',
            variables: [
              {
                key: 'BODY:1',
                component_type: 'BODY',
                index: 1,
                value: 'Contact',
              },
              {
                key: 'BODY:2',
                component_type: 'BODY',
                index: 2,
                value: 42,
              },
            ],
          },
        }
      )
    ).rejects.toThrow('database unavailable');

    expect(
      setup.chatMessageService.publishPreparedMessage
    ).not.toHaveBeenCalled();
  });

  it('returns a terminal failure that wins before the queue acknowledgement', async () => {
    const setup = makeUseCase();
    configureOfficialOpening(setup, 'closed');
    setup.chatMessageService.publishPreparedMessage.mockImplementationOnce(
      async (message) => {
        await setup.officialWindowService.recordTemplateFailureForMessage(
          message,
          132000
        );
        return true;
      }
    );

    await expect(
      setup.useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'user-1',
        {
          contact_id: 'contact-1',
          worker_id: 'worker-1',
          official_template: {
            name: 'service_update',
            language: 'pt_BR',
            variables: [
              {
                key: 'BODY:1',
                component_type: 'BODY',
                index: 1,
                value: 'Contact',
              },
              {
                key: 'BODY:2',
                component_type: 'BODY',
                index: 2,
                value: 42,
              },
            ],
          },
        }
      )
    ).resolves.toMatchObject({
      official_window: {
        state: 'closed',
        reason: 'template_failed',
        can_send_template: true,
      },
    });

    expect(
      setup.officialWindowService.resolveAuthoritativeForChat
    ).toHaveBeenCalledTimes(1);
  });

  it('does not preflight or resend while provider confirmation is pending', async () => {
    const setup = makeUseCase();
    configureOfficialOpening(setup, 'send_uncertain');

    await expect(
      setup.useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        'user-1',
        {
          contact_id: 'contact-1',
          worker_id: 'worker-1',
          official_template: {
            name: 'service_update',
            language: 'pt_BR',
          },
        }
      )
    ).rejects.toThrow('whatsapp_official_template_send_uncertain');

    expect(
      setup.metaWhatsappEmbeddedService.listApprovedMessageTemplates
    ).not.toHaveBeenCalled();
    expect(
      setup.chatMessageService.publishPreparedMessage
    ).not.toHaveBeenCalled();
  });
});
