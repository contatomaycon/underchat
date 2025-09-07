import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerCreatorUseCase } from '@core/useCases/worker/WorkerCreator.useCase';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';

export const createWorker = async (
  request: FastifyRequest<{
    Body: CreateWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerCreatorUseCase = container.resolve(WorkerCreatorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await workerCreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('worker_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    console.log(error);

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
