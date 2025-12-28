import fp from 'fastify-plugin';
import {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import {
  isPostgreSQLError,
  getPostgreSQLErrorMessage,
} from '@core/common/functions/isPostgreSQLError';
import { getErrorMessage } from '@core/common/functions/toError';

async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler(
    async (
      error: FastifyError | Error,
      request: FastifyRequest,
      reply: FastifyReply
    ) => {
      const t = request.t || ((key: string) => key);

      if (isPostgreSQLError(error)) {
        const pgError = error as any;
        const errorMessage = getPostgreSQLErrorMessage(pgError);

        fastify.log.error({
          error: {
            message: errorMessage,
            code: pgError.code,
            detail: pgError.detail,
            hint: pgError.hint,
          },
          request: {
            id: request.id,
            method: request.method,
            url: request.url,
          },
        });

        return sendResponse(reply, {
          message: t('database_query_error'),
          httpStatusCode: EHTTPStatusCode.internal_server_error,
        });
      }

      const fastifyError = error as FastifyError;

      if (fastifyError.statusCode) {
        const statusCode = fastifyError.statusCode as EHTTPStatusCode;
        const message = fastifyError.message || t('internal_server_error');

        return sendResponse(reply, {
          message,
          httpStatusCode: statusCode,
        });
      }

      const errorMessage = getErrorMessage(error);
      const errorObj = error as Error | FastifyError;

      fastify.log.error({
        error: {
          message: errorMessage,
          stack: errorObj instanceof Error ? errorObj.stack : undefined,
        },
        request: {
          id: request.id,
          method: request.method,
          url: request.url,
        },
      });

      return sendResponse(reply, {
        message: t('internal_server_error'),
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }
  );
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
