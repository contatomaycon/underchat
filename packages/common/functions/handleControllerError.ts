import { FastifyReply, FastifyRequest } from 'fastify';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { DrizzleQueryError } from 'drizzle-orm';
import { TFunction } from 'i18next';
import { logDatabaseError } from '@core/common/functions/logDatabaseError';
import { logger } from '@core/plugins/telemetry/logger';
import { recordException } from '@core/plugins/telemetry/observability';

export function handleControllerError(
  error: unknown,
  reply: FastifyReply,
  t?: TFunction<'translation', undefined>,
  request?: FastifyRequest
): void {
  const requestId = request?.id;
  const method = request?.method;
  const url = request?.url;

  if (error instanceof DrizzleQueryError) {
    logDatabaseError(error, {
      operation: 'controller',
      query: error.message,
    });

    logger.error(
      {
        err: error,
        type: 'controller_database_error',
        requestId,
        method,
        url,
      },
      'Database error in controller'
    );

    recordException(error, {
      controller: {
        requestId,
        method,
        url,
        type: 'database_error',
      },
    });

    sendResponse(reply, {
      message: t
        ? t('internal_database_error')
        : 'Error 1064: An internal error occurred, please contact support.',
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });

    return;
  }

  if (error instanceof Error) {
    const logPayload: Record<string, unknown> = {
      err: error,
      type: 'controller_error',
      requestId,
      method,
      url,
      stack: error.stack,
    };
    if (error.cause !== undefined) {
      logPayload.cause = error.cause;
    }
    logger.error(logPayload, 'Error in controller');

    recordException(error, {
      controller: {
        requestId,
        method,
        url,
        type: 'general_error',
      },
    });

    sendResponse(reply, {
      message: error.message,
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });

    return;
  }

  logger.error(
    {
      err: error,
      type: 'controller_unknown_error',
      requestId,
      method,
      url,
    },
    'Unknown error in controller'
  );

  recordException(new Error(String(error)), {
    controller: {
      requestId,
      method,
      url,
      type: 'unknown_error',
    },
  });

  sendResponse(reply, {
    message: t ? t('internal_server_error') : 'Internal server error!',
    httpStatusCode: EHTTPStatusCode.internal_server_error,
  });
}
