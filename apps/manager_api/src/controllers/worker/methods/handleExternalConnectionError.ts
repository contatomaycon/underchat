import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply } from 'fastify';
import { TFunction } from 'i18next';

export const handleExternalConnectionError = (
  error: unknown,
  reply: FastifyReply,
  t: TFunction<'translation', undefined>
): void => {
  if (!(error instanceof Error)) {
    handleControllerError(error, reply, t);
    return;
  }

  const statusCodeByMessage: Record<string, EHTTPStatusCode> = {
    [t('worker_external_connection_invalid')]: EHTTPStatusCode.bad_request,
    [t('worker_external_connection_expired')]: EHTTPStatusCode.gone,
    [t('worker_not_found')]: EHTTPStatusCode.not_found,
    [t('worker_qrcode_not_ready')]: EHTTPStatusCode.service_unavailable,
    [t('worker_type_invalid')]: EHTTPStatusCode.bad_request,
    [t('worker_passkey_response_invalid')]: EHTTPStatusCode.bad_request,
  };

  const httpStatusCode = statusCodeByMessage[error.message];

  if (!httpStatusCode) {
    handleControllerError(error, reply, t);
    return;
  }

  sendResponse(reply, {
    message: error.message,
    httpStatusCode,
  });
};
