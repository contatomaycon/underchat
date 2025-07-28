import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerManagerDeleterUseCase } from '@core/useCases/worker/WorkerManagerDeleter.useCase';
import { ManagerDeleteWorkerRequest } from '@core/schema/worker/managerDeleteWorker/request.schema';

export const deleteWorker = async (
  request: FastifyRequest<{
    Params: ManagerDeleteWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerManagerDeleterUseCase = container.resolve(
    WorkerManagerDeleterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await workerManagerDeleterUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      request.params.worker_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_delete_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('worker_delete_error'),
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
