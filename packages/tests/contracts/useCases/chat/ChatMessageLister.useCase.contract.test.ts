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
import {
  createRequestLatencyContext,
  runWithRequestLatencyContext,
} from '@core/plugins/telemetry/requestLatency';

function buildAction(actionName: EPermissionsRoles): IJwtGroupHierarchy {
  return {
    account_id: 'account-1',
    permission_role_id: 'role-1',
    role_name: 'Role',
    module_name: 'chat',
    action_name: actionName,
  };
}

describe('ChatMessageListerUseCase request breakdown', () => {
  it('records route stages without changing the API response shape', async () => {
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
      closureRepository
    );
    const context = createRequestLatencyContext();

    const response = await runWithRequestLatencyContext(context, () =>
      useCase.execute(
        ((key: string) => key) as never,
        'account-1',
        { current_page: 1, per_page: 10 },
        { chat_id: 'chat-1' },
        'user-1',
        [buildAction(EGeneralPermissions.full_access)],
        [],
        []
      )
    );

    expect(response.results).toEqual([message]);
    expect(response.pagings.total).toBe(1);
    expect(context.stages.map((stage) => stage.name)).toEqual(
      expect.arrayContaining([
        'chat.messages.find_chat',
        'chat.messages.permission_policy',
        'chat.messages.list_messages',
        'chat.messages.closure_comments',
      ])
    );
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
      closureRepository
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
});
