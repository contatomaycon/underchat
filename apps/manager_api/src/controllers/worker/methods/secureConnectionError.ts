import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply } from 'fastify';
import { TFunction } from 'i18next';

export function handleSecureConnectionError(
  error: unknown,
  reply: FastifyReply,
  t: TFunction<'translation', undefined>
): void {
  if (error instanceof Error) {
    const statusCodeByMessage: Record<string, EHTTPStatusCode> = {
      [t('worker_not_found')]: EHTTPStatusCode.not_found,
      [t('worker_qrcode_not_ready')]: EHTTPStatusCode.service_unavailable,
      [t('worker_secure_connection_session_not_found')]:
        EHTTPStatusCode.not_found,
      [t('worker_secure_connection_session_expired')]: EHTTPStatusCode.gone,
      [t('worker_secure_connection_status_invalid')]:
        EHTTPStatusCode.bad_request,
      [t('worker_secure_connection_session_invalid')]:
        EHTTPStatusCode.bad_request,
      [t('worker_secure_connection_provider_mismatch')]:
        EHTTPStatusCode.bad_request,
      [t('worker_secure_connection_checksum_invalid')]:
        EHTTPStatusCode.bad_request,
      [t('worker_secure_connection_session_already_uploaded')]:
        EHTTPStatusCode.conflict,
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
