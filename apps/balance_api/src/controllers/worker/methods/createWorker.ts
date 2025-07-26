import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerBalanceCreatorUseCase } from '@core/useCases/worker/WorkerBalanceCreator.useCase';
import { BalanceCreateWorkerRequest } from '@core/schema/worker/balanceCreateWorker/request.schema';

export const createWorker = async (
  request: FastifyRequest<{
    Body: BalanceCreateWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerBalanceCreatorUseCase = container.resolve(
    WorkerBalanceCreatorUseCase
  );
  const { t, tokenKeyData } = request;

  try {
    const response = await workerBalanceCreatorUseCase.execute(
      t,
      tokenKeyData.account_id,
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
