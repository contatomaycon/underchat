import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerRecreatorUseCase } from '@core/useCases/worker/WorkerRecreator.useCase';
import { RecreateWorkerRequest } from '@core/schema/worker/recreateWorker/request.schema';

export const recreateWorker = async (
  request: FastifyRequest<{
    Params: RecreateWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerRecreatorUseCase = container.resolve(WorkerRecreatorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await workerRecreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      request.params.worker_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_recreate_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('worker_recreate_error'),
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
