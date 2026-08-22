import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { container } from 'tsyringe';

jest.mock('tsyringe', () => ({
  container: {
    resolve: jest.fn(),
  },
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
jest.mock('@core/useCases/chat/ChatContactUpdater.useCase', () => ({
  ChatContactUpdaterUseCase: class ChatContactUpdaterUseCase {},
}));
jest.mock('@core/useCases/chat/ChatContactValidator.useCase', () => ({
  ChatContactValidatorUseCase: class ChatContactValidatorUseCase {},
}));

const { bulkActionChat } = jest.requireActual<{
  bulkActionChat: MutationHandler;
}>('@core/controllers/chat/methods/bulkAction');
const { updateChatLabel } = jest.requireActual<{
  updateChatLabel: MutationHandler;
}>('@core/controllers/chat/methods/updateChatLabel');
const { updateForwardToOutputChatbot } = jest.requireActual<{
  updateForwardToOutputChatbot: MutationHandler;
}>('@core/controllers/chat/methods/updateForwardToOutputChatbot');
const { updateContact } = jest.requireActual<{
  updateContact: MutationHandler;
}>('@core/controllers/chat/methods/updateContact');
const { validateContact } = jest.requireActual<{
  validateContact: MutationHandler;
}>('@core/controllers/chat/methods/validateContact');

type MutationHandler = (request: never, reply: never) => Promise<void>;

function makeRequest() {
  return {
    t: (key: string) => `translated:${key}`,
    tokenJwtData: {
      account_id: 'account-1',
      user_id: 'user-1',
      permission_role_id: null,
      sectors: [],
      actions: [],
      channels: [],
    },
    params: {
      chat_id: '01900000-0000-7000-8000-000000000001',
      contact_id: '01900000-0000-7000-8000-000000000002',
    },
    body: {},
  };
}

function makeReply() {
  return {
    request: { id: 'request-1' },
    code: jest.fn().mockReturnThis(),
    send: jest.fn(),
  };
}

describe('chat mutation controller domain errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['bulk validation', bulkActionChat, 'chat_bulk_ids_required', 400],
    ['missing chat label target', updateChatLabel, 'chat_not_found', 404],
    [
      'output chatbot access',
      updateForwardToOutputChatbot,
      'chat_access_denied',
      403,
    ],
    ['missing contact update target', updateContact, 'contact_not_found', 404],
    [
      'contact validation availability',
      validateContact,
      'no_active_worker_for_validation',
      503,
    ],
  ] as const)(
    'maps %s without returning 500',
    async (_, handler, errorKey, statusCode) => {
      const execute = jest
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(new Error(`translated:${errorKey}`));
      jest.mocked(container.resolve).mockReturnValue({ execute } as never);
      const request = makeRequest();
      const reply = makeReply();

      await handler(request as never, reply as never);

      expect(reply.code).toHaveBeenCalledWith(statusCode);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: false,
          message: `translated:${errorKey}`,
        })
      );
    }
  );
});
