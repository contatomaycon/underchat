import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConfigViewerUseCase } from '@core/useCases/worker/WorkerConfigViewer.useCase';
import { ViewWorkerConfigParams } from '@core/schema/worker/viewWorkerConfig/request.schema';

export const viewWorkerConfig = async (
  request: FastifyRequest<{
    Params: ViewWorkerConfigParams;
  }>,
  reply: FastifyReply
) => {
  const workerConfigViewerUseCase = container.resolve(
    WorkerConfigViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await workerConfigViewerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('worker_config_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
