import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerDeleterUseCase } from '@core/useCases/worker/WorkerDeleter.useCase';
import { DeleteWorkerRequest } from '@core/schema/worker/deleteWorker/request.schema';

export const deleteWorker = async (
  request: FastifyRequest<{
    Params: DeleteWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerDeleterUseCase = container.resolve(WorkerDeleterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await workerDeleterUseCase.execute(
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


    return sendResponse(reply, {
      message: t('worker_delete_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    console.error(error);

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
