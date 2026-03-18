import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
      request.params.worker_id,
      {
        remove_volume: true,
      }
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_recreate_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('worker_recreate_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
