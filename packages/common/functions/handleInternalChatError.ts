import { FastifyReply } from 'fastify';
import { TFunction } from 'i18next';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';

export function handleInternalChatError(
  error: unknown,
  reply: FastifyReply,
  t: TFunction<'translation', undefined>
): void {
  if (!(error instanceof Error)) {
    handleControllerError(error, reply, t);
    return;
  }

  if (
    error.message === 'chat_not_found' ||
    error.message === 'message_not_found' ||
    error.message === 'user_not_found'
  ) {
    sendResponse(reply, {
      message: t(error.message),
      httpStatusCode: EHTTPStatusCode.not_found,
    });
    return;
  }

  if (error.message === 'chat_access_denied') {
    sendResponse(reply, {
      message: t(error.message),
      httpStatusCode: EHTTPStatusCode.forbidden,
    });
    return;
  }

  if (
    error.message === 'message_content_required' ||
    error.message === 'message_type_invalid' ||
    error.message === 'only_text_messages_can_be_edited' ||
    error.message === 'chat_invalid_target_user' ||
    error.message === 'chat_create_error' ||
    error.message === 'chat_update_error'
  ) {
    sendResponse(reply, {
      message: t(error.message),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
    return;
  }

  handleControllerError(error, reply, t);
}
