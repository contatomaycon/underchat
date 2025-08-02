import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerChangeStatusConnectionUseCase } from '@core/useCases/worker/WorkerChangeStatusConnection.useCase';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';

export const changeStatusConnection = async (
  request: FastifyRequest<{
    Body: StatusConnectionWorkerRequest;
  }>,
  reply: FastifyReply
) => {
  const workerChangeStatusConnectionUseCase = container.resolve(
    WorkerChangeStatusConnectionUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    await workerChangeStatusConnectionUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      request.body
    );

    return sendResponse(reply, {
      message: t('worker_status_change_success'),
      httpStatusCode: EHTTPStatusCode.ok,
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
