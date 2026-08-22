import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { container } from 'tsyringe';
import { ERouteModule } from '@core/common/enums/ERouteModule';

jest.mock('tsyringe', () => ({
  container: {
    resolve: jest.fn(),
  },
}));

jest.mock('@core/useCases/chat/StartChatWithContact.useCase', () => ({
  StartChatWithContactUseCase: class StartChatWithContactUseCase {},
}));
jest.mock('@core/useCases/chat/ChatStatusUpdater.useCase', () => ({
  ChatStatusUpdaterUseCase: class ChatStatusUpdaterUseCase {},
}));
jest.mock('@core/useCases/chat/JoinChat.useCase', () => ({
  JoinChatUseCase: class JoinChatUseCase {},
}));
jest.mock('@core/useCases/chat/LeaveChat.useCase', () => ({
  LeaveChatUseCase: class LeaveChatUseCase {},
}));
jest.mock('@core/useCases/chat/TransferChat.useCase', () => ({
  TransferChatUseCase: class TransferChatUseCase {},
}));
jest.mock('@core/useCases/chat/ChatBulkAction.useCase', () => ({
  ChatBulkActionUseCase: class ChatBulkActionUseCase {},
}));
jest.mock('@core/useCases/chat/ChatLabelUpdater.useCase', () => ({
  ChatLabelUpdaterUseCase: class ChatLabelUpdaterUseCase {},
}));
jest.mock(
  '@core/useCases/chat/ChatForwardToOutputChatbotUpdater.useCase',
  () => ({
    ChatForwardToOutputChatbotUpdaterUseCase: class ChatForwardToOutputChatbotUpdaterUseCase {},
  })
);

type ChatControllerHandler = (request: never, reply: never) => Promise<unknown>;

const { startChatWithContact } = jest.requireActual<{
  startChatWithContact: ChatControllerHandler;
}>('@core/controllers/chat/methods/startChatWithContact');
const { updateChatStatus } = jest.requireActual<{
  updateChatStatus: ChatControllerHandler;
}>('@core/controllers/chat/methods/updateChatStatus');
const { joinChat } = jest.requireActual<{
  joinChat: ChatControllerHandler;
}>('@core/controllers/chat/methods/joinChat');
const { leaveChat } = jest.requireActual<{
  leaveChat: ChatControllerHandler;
}>('@core/controllers/chat/methods/leaveChat');
const { transferChat } = jest.requireActual<{
  transferChat: ChatControllerHandler;
}>('@core/controllers/chat/methods/transferChat');
const { bulkActionChat } = jest.requireActual<{
  bulkActionChat: ChatControllerHandler;
}>('@core/controllers/chat/methods/bulkAction');
const { updateChatLabel } = jest.requireActual<{
  updateChatLabel: ChatControllerHandler;
}>('@core/controllers/chat/methods/updateChatLabel');
const { updateForwardToOutputChatbot } = jest.requireActual<{
  updateForwardToOutputChatbot: ChatControllerHandler;
}>('@core/controllers/chat/methods/updateForwardToOutputChatbot');

const handlers: Array<{
  name: string;
  handler: ChatControllerHandler;
  response: unknown;
}> = [
  { name: 'start', handler: startChatWithContact, response: {} },
  { name: 'status', handler: updateChatStatus, response: {} },
  { name: 'join', handler: joinChat, response: {} },
  { name: 'leave', handler: leaveChat, response: {} },
  {
    name: 'transfer',
    handler: transferChat,
    response: { chat_id: 'chat-1', status: true },
  },
  {
    name: 'bulk',
    handler: bulkActionChat,
    response: {
      total_targeted: 0,
      success_count: 0,
      failed_count: 0,
      failures: [],
    },
  },
  { name: 'label', handler: updateChatLabel, response: true },
  {
    name: 'forward-to-output',
    handler: updateForwardToOutputChatbot,
    response: true,
  },
];

describe('chat outbound webhook request source propagation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    [ERouteModule.manager, 'manager_api'],
    [ERouteModule.public, 'public_api'],
  ] as const)(
    'propagates %s requests as %s across non-message mutations',
    async (routeModule, expectedSource) => {
      for (const { name, handler, response } of handlers) {
        const execute = jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue(response);
        jest.mocked(container.resolve).mockReturnValue({ execute } as never);
        const request = {
          module: routeModule,
          t: (key: string) => key,
          tokenJwtData: {
            account_id: 'account-1',
            user_id: 'user-1',
            permission_role_id: null,
            sectors: [],
            actions: [],
            channels: [],
          },
          params: { chat_id: 'chat-1' },
          body: {},
        };
        const reply = {
          request: { id: `request-${name}` },
          code: jest.fn().mockReturnThis(),
          send: jest.fn(),
        };

        await handler(request as never, reply as never);

        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0]?.at(-1)).toBe(expectedSource);
      }
    }
  );
});
