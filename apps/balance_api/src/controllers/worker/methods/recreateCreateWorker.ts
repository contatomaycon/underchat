import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerBalanceRecreatorUseCase } from '@core/useCases/worker/WorkerBalanceRecreator.useCase';
import { BalanceRecreateWorkerRequest } from '@core/schema/worker/balanceRecreateWorker/request.schema';

export const recreateCreateWorker = async (
  request: FastifyRequest<{
    Params: BalanceRecreateWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerBalanceRecreatorUseCase = container.resolve(
    WorkerBalanceRecreatorUseCase
  );
  const { t, tokenKeyData } = request;

  try {
    const response = await workerBalanceRecreatorUseCase.execute(
      t,
      tokenKeyData.account_id,
      tokenKeyData.is_administrator,
      request.params.worker_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('worker_recreate_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('worker_recreate_not_found'),
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
