import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerViewerUseCase } from '@core/useCases/worker/WorkerViewer.useCase';
import { ViewWorkerRequest } from '@core/schema/worker/viewWorker/request.schema';

export const viewWorker = async (
  request: FastifyRequest<{
    Params: ViewWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerViewerUseCase = container.resolve(WorkerViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await workerViewerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_view_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('worker_view_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
