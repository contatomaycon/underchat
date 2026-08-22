import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { WorkerCommandOperationalBarrierError } from '@core/services/workerCommandOperationalBarrier.service';
import { workerCommandAcceptancesFromError } from '@core/common/functions/workerCommandAcceptanceContext';

const MANAGER_API_BAD_REQUEST_CODES = new Set([
  'FST_ERR_VALIDATION',
  'FST_ERR_CTP_INVALID_JSON_BODY',
  'FST_ERR_CTP_EMPTY_JSON_BODY',
]);

/**
 * Limits HTTP 400 normalization to errors raised by Fastify while parsing or
 * validating the request. Domain and infrastructure exceptions must never be
 * downgraded to a client error merely because they also carry a message.
 */
export function isManagerApiRequestContractError(error: FastifyError): boolean {
  return (
    Array.isArray(error.validation) ||
    MANAGER_API_BAD_REQUEST_CODES.has(error.code)
  );
}

function managerApiClientErrorStatus(error: FastifyError): number | null {
  if (isManagerApiRequestContractError(error)) {
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
 * Keeps native Fastify failures compatible with the response schemas used by
 * manager_api and prevents a serializer error from turning a 400 into a 500.
 */
export function managerApiErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  if (
    error instanceof WorkerCommandOperationalBarrierError &&
    error.code === 'paused'
  ) {
    const acceptedCommands = workerCommandAcceptancesFromError(error);
    const latestAcceptance = acceptedCommands.at(-1);
    const operationId = error.operationId ?? latestAcceptance?.operation_id;
    if (operationId) reply.header('X-Operation-Id', operationId);
    if (acceptedCommands.length > 0) {
      reply.header(
        'X-Command-Acceptance-Count',
        String(acceptedCommands.length)
      );
    }
    reply.header('Retry-After', '5');
    sendResponse(reply, {
      message: 'worker_command_operational_barrier_paused',
      httpStatusCode: EHTTPStatusCode.service_unavailable,
      data: {
        retryable: true,
        acceptance: 'rejected',
        reason: error.code,
        operation_id: operationId ?? null,
        barrier_generation: error.status?.generation ?? null,
        barrier_changed_at: error.status?.changed_at ?? null,
        accepted_commands: acceptedCommands,
      },
    });
    return;
  }

  const clientErrorStatus = managerApiClientErrorStatus(error);
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
      type: 'manager_api_unhandled_error',
    },
    'Unhandled manager API error'
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
