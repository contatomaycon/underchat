import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply } from 'fastify';
import { TFunction } from 'i18next';

export function handleScheduleControllerError(
  error: unknown,
  reply: FastifyReply,
  t: TFunction<'translation', undefined>
): void {
  if (error instanceof Error) {
    const statusCodeByMessage: Record<string, EHTTPStatusCode> = {
      [t('worker_not_found')]: EHTTPStatusCode.not_found,
      [t('schedule_not_found')]: EHTTPStatusCode.not_found,
      [t('chat_access_denied')]: EHTTPStatusCode.forbidden,
      [t('whatsapp_official_connection_access_lost')]: EHTTPStatusCode.conflict,
    };
    const httpStatusCode = statusCodeByMessage[error.message];

    if (httpStatusCode) {
      sendResponse(reply, {
        message: error.message,
        httpStatusCode,
      });
      return;
    }
  }

  handleControllerError(error, reply, t);
}
