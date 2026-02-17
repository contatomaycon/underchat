import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerUpdaterUseCase } from '@core/useCases/worker/WorkerUpdater.useCase';
import {
  EditWorkerParams,
  EditWorkerBody,
} from '@core/schema/worker/editWorker/request.schema';

export const updateWorker = async (
  request: FastifyRequest<{
    Params: EditWorkerParams;
    Body: EditWorkerBody;
  }>,
  reply: FastifyReply
) => {
  const workerUpdaterUseCase = container.resolve(WorkerUpdaterUseCase);
  const { t, tokenJwtData } = request;

  const input: EditWorkerParams & EditWorkerBody = {
    ...request.params,
    ...request.body,
  };

  try {
    const response = await workerUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      input
    );

    if (response) {
      return sendResponse(reply, {
        message: t('channel_updated_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('channel_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
