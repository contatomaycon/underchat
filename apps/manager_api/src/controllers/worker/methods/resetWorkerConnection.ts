import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerRecreatorUseCase } from '@core/useCases/worker/WorkerRecreator.useCase';
import { ResetWorkerConnectionRequest } from '@core/schema/worker/resetWorkerConnection/request.schema';

export const resetWorkerConnection = async (
  request: FastifyRequest<{
    Params: ResetWorkerConnectionRequest;
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
        remove_session: true,
        remove_volume: true,
      }
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_connection_reset_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('worker_connection_reset_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
