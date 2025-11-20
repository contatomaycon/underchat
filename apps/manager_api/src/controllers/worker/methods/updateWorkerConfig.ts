import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConfigUpserterUseCase } from '@core/useCases/worker/WorkerConfigUpserter.useCase';
import {
  UpdateWorkerConfigRequest,
  UpdateWorkerConfigParams,
} from '@core/schema/worker/updateWorkerConfig/request.schema';

export const updateWorkerConfig = async (
  request: FastifyRequest<{
    Params: UpdateWorkerConfigParams;
    Body: UpdateWorkerConfigRequest;
  }>,
  reply: FastifyReply
) => {
  const workerConfigUpserterUseCase = container.resolve(
    WorkerConfigUpserterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await workerConfigUpserterUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('worker_config_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
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
