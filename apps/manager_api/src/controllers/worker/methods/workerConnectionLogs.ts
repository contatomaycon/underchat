import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConnectionLogsUseCase } from '@core/useCases/worker/WorkerConnectionLogs.useCase';
import {
  WorkerConnectionLogsQuery,
  WorkerConnectionLogsRequest,
} from '@core/schema/worker/workerConnectionLogs/request.schema';

export const workerConnectionLogs = async (
  request: FastifyRequest<{
    Params: WorkerConnectionLogsRequest;
    Querystring: WorkerConnectionLogsQuery;
  }>,
  reply: FastifyReply
) => {
  const workerConnectionLogsUseCase = container.resolve(
    WorkerConnectionLogsUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await workerConnectionLogsUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.query
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_connection_logs_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('worker_connection_logs_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === t('worker_connection_health_database_only')
    ) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    handleControllerError(error, reply, t);
  }
};
