import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      tokenJwtData.is_administrator,
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

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('worker_connection_logs_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
