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
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';

function isLifecycleAck(value: unknown): value is IWorkerLifecycleAck {
  return (
    typeof value === 'object' &&
    value !== null &&
    'queued' in value &&
    (value as { queued?: unknown }).queued === true
  );
}

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
    worker_type: request.body?.worker_type,
    server_id: request.body?.server_id,
  };

  try {
    const response = await workerUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      input
    );

    if (response) {
      if (isLifecycleAck(response)) {
        return sendResponse(reply, {
          message: t('channel_updated_successfully'),
          httpStatusCode: EHTTPStatusCode.accepted,
          data: response,
        });
      }

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
