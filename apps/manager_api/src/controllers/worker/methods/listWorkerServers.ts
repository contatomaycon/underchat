import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerServerListerUseCase } from '@core/useCases/worker/WorkerServerLister.useCase';

export const listWorkerServers = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const workerServerListerUseCase = container.resolve(
    WorkerServerListerUseCase
  );
  const { t } = _request;

  try {
    const response = await workerServerListerUseCase.execute();

    return sendResponse(reply, {
      message: t('worker_servers_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
