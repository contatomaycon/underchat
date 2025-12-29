import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
      tokenJwtData.account_id,
      request.query
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_list_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('worker_list_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
