import 'reflect-metadata';

jest.mock('@core/services/elasticDatabase.service', () => ({
  ElasticDatabaseService: class ElasticDatabaseService {},
}));

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));

jest.mock(
  '@core/repositories/chat/ChatClosureCommentLister.repository',
  () => ({
    ChatClosureCommentListerRepository: class ChatClosureCommentListerRepository {},
  })
);

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { EMessageType } from '@core/common/enums/EMessageType';
import type { EPermissionsRoles } from '@core/common/enums/EPermissions';
import type { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import type { ChatService } from '@core/services/chat.service';
import type { ChatClosureCommentListerRepository } from '@core/repositories/chat/ChatClosureCommentLister.repository';
import { ChatMessageListerUseCase } from '@core/useCases/chat/ChatMessageLister.useCase';
import type { OfficialWhatsappConversationWindowService } from '@core/services/officialWhatsappConversationWindow.service';

function buildAction(actionName: EPermissionsRoles): IJwtGroupHierarchy {
  return {
    account_id: 'account-1',
    permission_role_id: 'role-1',
    role_name: 'Role',
    module_name: 'chat',
    action_name: actionName,
  };
}

function buildOfficialWindowServiceMock(): OfficialWhatsappConversationWindowService {
  return {
    reconcileFromMessages: jest.fn().mockResolvedValue(null),
  } as unknown as OfficialWhatsappConversationWindowService;
}

describe('ChatMessageListerUseCase', () => {
  it('lists route messages without changing the API response shape', async () => {
    const message = {
      message_id: 'message-1',
      chat_id: 'chat-1',
      date: '2026-06-09T12:00:00.000Z',
      content: {
        type: EMessageType.text,
        message: 'hello',
      },
    };
    const elasticDatabaseService = {
      select: jest.fn().mockResolvedValue({
        hits: {
          total: {
            value: 1,
            relation: 'eq',
          },
          hits: [{ _source: message }],
        },
      }),
    } as unknown as ElasticDatabaseService;
    const chatService = {
      findChatByChatId: jest.fn().mockResolvedValue({
        chat_id: 'chat-1',
        status: EChatStatus.queue,
        worker: { id: 'worker-1' },
      } as IChat),
    } as unknown as ChatService;
    const closureRepository = {
      listByChatId: jest.fn().mockResolvedValue([]),
    } as unknown as ChatClosureCommentListerRepository;
    const useCase = new ChatMessageListerUseCase(
      elasticDatabaseService,
      chatService,
      closureRepository,
      buildOfficialWindowServiceMock()
    );
    const response = await useCase.execute(
      ((key: string) => key) as never,
      'account-1',
      { current_page: 1, per_page: 10 },
      { chat_id: 'chat-1' },
      'user-1',
      [buildAction(EGeneralPermissions.full_access)],
      [],
      []
    );

    expect(response.results).toEqual([message]);
    expect(response.pagings.total).toBe(1);
  });

  it('drops Elasticsearch hits that do not belong to the requested chat', async () => {
    const messages = [
      {
        message_id: 'message-1',
        chat_id: 'chat-1',
        date: '2026-06-09T12:00:00.000Z',
        content: {
          type: EMessageType.text,
          message: 'right chat',
        },
      },
      {
        message_id: 'message-2',
        chat_id: 'chat-2',
        date: '2026-06-09T12:01:00.000Z',
        content: {
          type: EMessageType.text,
          message: 'wrong chat',
        },
      },
    ];
    const elasticDatabaseService = {
      select: jest.fn().mockResolvedValue({
        hits: {
          total: {
            value: 2,
            relation: 'eq',
          },
          hits: messages.map((message) => ({ _source: message })),
        },
      }),
    } as unknown as ElasticDatabaseService;
    const chatService = {
      findChatByChatId: jest.fn().mockResolvedValue({
        chat_id: 'chat-1',
        status: EChatStatus.queue,
        worker: { id: 'worker-1' },
      } as IChat),
    } as unknown as ChatService;
    const closureRepository = {
      listByChatId: jest.fn().mockResolvedValue([]),
    } as unknown as ChatClosureCommentListerRepository;
    const useCase = new ChatMessageListerUseCase(
      elasticDatabaseService,
      chatService,
      closureRepository,
      buildOfficialWindowServiceMock()
    );

    const response = await useCase.execute(
      ((key: string) => key) as never,
      'account-1',
      { current_page: 1, per_page: 10 },
      { chat_id: 'chat-1' },
      'user-1',
      [buildAction(EGeneralPermissions.full_access)],
      [],
      []
    );

    expect(response.results).toEqual([messages[0]]);
    expect(
      response.results.every((message) => message.chat_id === 'chat-1')
    ).toBe(true);
  });

  it('returns the authoritative repaired official window with the loaded messages', async () => {
    const message = {
      message_id: 'wamid.inbound-after-template',
      chat_id: 'chat-1',
      type_user: 'client',
      date: '2026-07-21T13:18:16.517Z',
      message_key: { from_me: false },
      content: {
        type: EMessageType.text,
        message: 'Conversar',
        message_quoted_id: 'wamid.template',
      },
    };
    const chat = {
      chat_id: 'chat-1',
      status: EChatStatus.queue,
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', is_official: true },
      phone: '5548999077927',
    } as IChat;
    const officialWindow = {
      is_official: true as const,
      state: 'open' as const,
      reason: 'customer_service_window_open' as const,
      can_send_freeform: true,
      can_send_template: true,
      last_inbound_at: message.date,
      service_window_expires_at: '2026-07-22T13:18:16.517Z',
    };
    const elasticDatabaseService = {
      select: jest.fn().mockResolvedValue({
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{ _source: message }],
        },
      }),
    } as unknown as ElasticDatabaseService;
    const chatService = {
      findChatByChatId: jest.fn().mockResolvedValue(chat),
    } as unknown as ChatService;
    const closureRepository = {
      listByChatId: jest.fn().mockResolvedValue([]),
    } as unknown as ChatClosureCommentListerRepository;
    const officialWindowService = {
      reconcileFromMessages: jest.fn().mockResolvedValue(officialWindow),
    } as unknown as OfficialWhatsappConversationWindowService;
    const useCase = new ChatMessageListerUseCase(
      elasticDatabaseService,
      chatService,
      closureRepository,
      officialWindowService
    );

    const response = await useCase.execute(
      ((key: string) => key) as never,
      'account-1',
      { current_page: 1, per_page: 10 },
      { chat_id: 'chat-1' },
      'user-1',
      [buildAction(EGeneralPermissions.full_access)],
      [],
      []
    );

    expect(officialWindowService.reconcileFromMessages).toHaveBeenCalledWith(
      chat,
      [message]
    );
    expect(response.official_window).toEqual(officialWindow);
  });
});
