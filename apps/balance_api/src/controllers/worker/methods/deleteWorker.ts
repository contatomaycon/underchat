import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerBalanceDeleterUseCase } from '@core/useCases/worker/WorkerBalanceDeleter.useCase';
import { BalanceDeleteWorkerRequest } from '@core/schema/worker/balanceDeleteWorker/request.schema';

export const deleteWorker = async (
  request: FastifyRequest<{
    Params: BalanceDeleteWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerBalanceDeleterUseCase = container.resolve(
    WorkerBalanceDeleterUseCase
  );
  const { t, tokenKeyData } = request;

  try {
    const response = await workerBalanceDeleterUseCase.execute(
      t,
      tokenKeyData.account_id,
      request.params.worker_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_delete_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('worker_delete_error'),
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
