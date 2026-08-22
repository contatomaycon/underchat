import type { FastifyReply } from 'fastify';
import type { TFunction } from 'i18next';
import { ContactCreationClientError } from '@core/common/exceptions/ContactCreationClientError';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';

/** Maps expected contact-creation failures without downgrading internal errors. */
export function handleContactCreationControllerError(
  error: unknown,
  reply: FastifyReply,
  t: TFunction<'translation', undefined>
): void {
  if (error instanceof ContactCreationClientError) {
    sendResponse(reply, {
      message: error.message,
      httpStatusCode: error.httpStatusCode,
    });
    return;
  }

  handleControllerError(error, reply, t);
}
