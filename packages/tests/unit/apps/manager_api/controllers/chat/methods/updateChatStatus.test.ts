import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { container } from 'tsyringe';
import { updateChatStatus } from './updateChatStatus';

jest.mock('tsyringe', () => ({
  container: {
    resolve: jest.fn(),
  },
}));

jest.mock('@core/useCases/chat/ChatStatusUpdater.useCase', () => ({
  ChatStatusUpdaterUseCase: class ChatStatusUpdaterUseCase {},
}));

describe('updateChatStatus controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a structured reason when closure comment is required', async () => {
    const execute = jest
      .fn<() => Promise<unknown>>()
      .mockRejectedValue(new Error('Informe o motivo do encerramento.'));
    jest.mocked(container.resolve).mockReturnValue({ execute } as never);

    const request = {
      t: (key: string) =>
        key === 'closure_comment_required'
          ? 'Informe o motivo do encerramento.'
          : key,
      tokenJwtData: {
        account_id: 'account-1',
        user_id: 'user-1',
        permission_role_id: null,
        sectors: [],
        actions: [],
        channels: [],
      },
      params: { chat_id: 'chat-1' },
      body: { status: 'closed' },
    };
    const reply = {
      request: { id: 'req-1' },
      code: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    await updateChatStatus(request as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      id: 'req-1',
      status: false,
      message: 'Informe o motivo do encerramento.',
      data: {
        reason: 'closure_comment_required',
      },
    });
  });
});
