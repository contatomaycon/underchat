import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerManagerCreatorUseCase } from '@core/useCases/worker/WorkerManagerCreator.useCase';
import { ManagerCreateWorkerRequest } from '@core/schema/worker/managerCreateWorker/request.schema';

export const createWorker = async (
  request: FastifyRequest<{
    Body: ManagerCreateWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerManagerCreatorUseCase = container.resolve(
    WorkerManagerCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await workerManagerCreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('worker_creator_error'),
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
