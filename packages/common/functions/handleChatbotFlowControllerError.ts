import type { FastifyReply } from 'fastify';
import type { TFunction } from 'i18next';
import { ChatbotApiRequestFlowValidationError } from '@core/common/exceptions/ChatbotApiRequestFlowValidationError';
import { ChatbotUnderchatAccessError } from '@core/common/exceptions/ChatbotUnderchatAccessError';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { OfficialWhatsappInteractiveValidationError } from '@core/common/exceptions/OfficialWhatsappInteractiveValidationError';

/** Maps expected flow validation failures while preserving unexpected errors. */
export const handleChatbotFlowControllerError = (
  error: unknown,
  reply: FastifyReply,
  t: TFunction<'translation', undefined>
): void => {
  if (
    error instanceof ChatbotApiRequestFlowValidationError ||
    error instanceof ChatbotUnderchatAccessError ||
    error instanceof OfficialWhatsappInteractiveValidationError
  ) {
    sendResponse(reply, {
      message: error.message,
      httpStatusCode: error.httpStatusCode,
    });
    return;
  }

  handleControllerError(error, reply, t);
};
