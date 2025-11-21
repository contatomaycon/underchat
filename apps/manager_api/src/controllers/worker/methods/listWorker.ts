import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListWorkerRequest } from '@core/schema/worker/listWorker/request.schema';
import { WorkerListerUseCase } from '@core/useCases/worker/WorkerLister.useCase';

export const listWorker = async (
  request: FastifyRequest<{
    Querystring: ListWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerListerUseCase = container.resolve(WorkerListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await workerListerUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      request.query
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_list_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('worker_list_error'),
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
