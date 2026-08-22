import 'reflect-metadata';

import { ChatbotApiRequestFlowValidationError } from '@core/common/exceptions/ChatbotApiRequestFlowValidationError';
import { ChatbotUnderchatAccessError } from '@core/common/exceptions/ChatbotUnderchatAccessError';
import { handleChatbotFlowControllerError } from '@core/common/functions/handleChatbotFlowControllerError';
import { OfficialWhatsappInteractiveValidationError } from '@core/common/exceptions/OfficialWhatsappInteractiveValidationError';

const makeReply = () => {
  const send = jest.fn();
  const reply = {
    request: { id: 'request-1' },
    code: jest.fn(() => ({ send })),
  };
  return { reply, send };
};

describe('handleChatbotFlowControllerError', () => {
  const t = ((key: string) => `translated:${key}`) as never;

  it('maps an API Request flow validation failure to HTTP 400', () => {
    const { reply, send } = makeReply();
    const message = 'The API Request proof is invalid';

    handleChatbotFlowControllerError(
      new ChatbotApiRequestFlowValidationError(message),
      reply as never,
      t
    );

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ status: false, message })
    );
  });

  it('maps official interactive limit failures to HTTP 400', () => {
    const { reply, send } = makeReply();
    const error = new OfficialWhatsappInteractiveValidationError([
      { code: 'max_length', field: 'body.text', limit: 1024, actual: 1025 },
    ]);

    handleChatbotFlowControllerError(error, reply as never, t);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ status: false, message: error.message })
    );
  });

  it('keeps unexpected failures as HTTP 500', () => {
    const { reply, send } = makeReply();

    handleChatbotFlowControllerError(
      new Error('Unexpected storage failure'),
      reply as never,
      t
    );

    expect(reply.code).toHaveBeenCalledWith(500);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        status: false,
        message: 'Unexpected storage failure',
      })
    );
  });

  it('maps a protected Underchat authoring failure to HTTP 403', () => {
    const { reply, send } = makeReply();

    handleChatbotFlowControllerError(
      new ChatbotUnderchatAccessError('Permission denied'),
      reply as never,
      t
    );

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ status: false, message: 'Permission denied' })
    );
  });
});
