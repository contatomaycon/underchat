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

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'chat-new-1'),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
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

  const makeUseCase = (existingChat: IChat | null = null) => {
    const chatService = {
      findChatByPhone: jest.fn(async () => existingChat),
      ensureProtocolForNewChat: jest.fn(async (chat: IChat) => chat),
      saveChat: jest.fn(async () => true),
      updateChatStatus: jest.fn(async () => true),
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
      updateContactIsValided: jest.fn(async () => undefined),
    };
    const pushNotificationService = {
      sendNotificationForChatStatusChange: jest.fn(async () => undefined),
    };
    const useCase = new StartChatWithContactUseCase(
      chatService as never,
      centrifugoService as never,
      { viewAccountName: jest.fn(async () => account) } as never,
      { viewUserNamePhoto: jest.fn(async () => user) } as never,
      {
        viewWorkerNameAndId: jest.fn(async () => worker),
        viewWorkerConfigFieldsByWorkerId: jest.fn(async () => null),
      } as never,
      {
        viewSimultaneousAttendance: jest.fn(async () => 0),
      } as never,
      contactService as never,
      { viewSectorById: jest.fn(async () => null) } as never,
      { sanitize: jest.fn((value: string) => value) } as never,
      {
        validatePhone: jest.fn(async () => ({
          valid: true,
          phone: '5511999999999',
        })),
      } as never,
      { findStatusByUserId: jest.fn(async () => 'online') } as never,
      {
        startTrackingOnInChatEntry: jest.fn(async () => undefined),
      } as never,
      pushNotificationService as never,
      {
        del: jest.fn(async () => 1),
        zrem: jest.fn(async () => 1),
      } as never
    );

    return {
      useCase,
      chatService,
      pushNotificationService,
    };
  };

  it('sends a status push when creating a new in-chat attendance', async () => {
    const { useCase, pushNotificationService } = makeUseCase();

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
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: 'chat-new-1',
        status: EChatStatus.in_chat,
      })
    );
  });

  it('sends a status push when moving an existing queue chat to in-chat', async () => {
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
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: 'chat-1',
        status: EChatStatus.in_chat,
      })
    );
  });
});
