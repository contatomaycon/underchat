import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { container } from 'tsyringe';

jest.mock('tsyringe', () => ({
  container: {
    resolve: jest.fn(),
  },
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

const { updateChatStatus } = jest.requireActual<{
  updateChatStatus: (request: never, reply: never) => Promise<void>;
}>('@core/controllers/chat/methods/updateChatStatus');
const { joinChat } = jest.requireActual<{
  joinChat: (request: never, reply: never) => Promise<void>;
}>('@core/controllers/chat/methods/joinChat');
const { leaveChat } = jest.requireActual<{
  leaveChat: (request: never, reply: never) => Promise<void>;
}>('@core/controllers/chat/methods/leaveChat');
const { transferChat } = jest.requireActual<{
  transferChat: (request: never, reply: never) => Promise<void>;
}>('@core/controllers/chat/methods/transferChat');

const controllers = [
  ['status', updateChatStatus],
  ['join', joinChat],
  ['leave', leaveChat],
  ['transfer', transferChat],
] as const;

describe('chat lifecycle controllers not-found contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(controllers)(
    'returns 404 for a missing chat on %s',
    async (_, handler) => {
      const execute = jest
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(new Error('Chat não encontrado!'));
      jest.mocked(container.resolve).mockReturnValue({ execute } as never);

      const request = {
        t: (key: string) =>
          key === 'chat_not_found' ? 'Chat não encontrado!' : key,
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
        request: { id: 'req-1' },
        code: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };

      await handler(request as never, reply as never);

      expect(reply.code).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith({
        id: 'req-1',
        status: false,
        message: 'Chat não encontrado!',
        data: null,
      });
    }
  );
});
