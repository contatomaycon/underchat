import { FastifyReply } from 'fastify';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { DrizzleQueryError } from 'drizzle-orm';
import { TFunction } from 'i18next';

export function handleControllerError(
  error: unknown,
  reply: FastifyReply,
  t?: TFunction<'translation', undefined>
): void {
  console.error(error);

  if (error instanceof DrizzleQueryError) {
    sendResponse(reply, {
      message: t
        ? t('internal_database_error')
        : 'Error 1064: An internal error occurred, please contact support.',
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });

    return;
  }

  if (error instanceof Error) {
    sendResponse(reply, {
      message: error.message,
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });

    return;
  }

  sendResponse(reply, {
    message: t ? t('internal_server_error') : 'Internal server error!',
    httpStatusCode: EHTTPStatusCode.internal_server_error,
  });
}
