import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerUpdaterUseCase } from '@core/useCases/worker/WorkerUpdater.useCase';
import { EditWorkerRequest } from '@core/schema/worker/editWorker/request.schema';

export const updateWorker = async (
  request: FastifyRequest<{
    Params: EditWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerUpdaterUseCase = container.resolve(WorkerUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await workerUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params
    );

    if (response) {
      return sendResponse(reply, {
        message: t('channel_updated_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('channel_not_found'),
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
