import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';

const PUBLIC_API_BAD_REQUEST_CODES = new Set([
  'FST_ERR_VALIDATION',
  'FST_ERR_CTP_INVALID_JSON_BODY',
  'FST_ERR_CTP_EMPTY_JSON_BODY',
]);

function isPublicApiRequestContractError(error: FastifyError): boolean {
  return (
    Array.isArray(error.validation) ||
    PUBLIC_API_BAD_REQUEST_CODES.has(error.code)
  );
}

function publicApiClientErrorStatus(error: FastifyError): number | null {
  if (isPublicApiRequestContractError(error)) {
    return EHTTPStatusCode.bad_request;
  }

  if (
    typeof error.statusCode === 'number' &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return error.statusCode;
  }

  return null;
}

/**
 * Keeps native Fastify and infrastructure failures compatible with the
 * public API response contract. Without this handler, Fastify's default error
 * body omits `data` and the route serializer replaces the original failure
 * with a second `"data" is required` error.
 */
export function publicApiErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const clientErrorStatus = publicApiClientErrorStatus(error);
  if (clientErrorStatus !== null) {
    sendResponse(reply, {
      message: error.message,
      httpStatusCode: clientErrorStatus,
    });
    return;
  }

  request.log.error(
    {
      err: error,
      type: 'public_api_unhandled_error',
    },
    'Unhandled public API error'
  );

  const message =
    typeof request.t === 'function'
      ? request.t('internal_server_error')
      : 'Internal server error!';

  sendResponse(reply, {
    message,
    httpStatusCode: EHTTPStatusCode.internal_server_error,
  });
}
