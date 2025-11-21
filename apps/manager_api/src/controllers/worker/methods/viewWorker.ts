import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      tokenJwtData.is_administrator,
      request.params.worker_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_view_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('worker_view_error'),
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
