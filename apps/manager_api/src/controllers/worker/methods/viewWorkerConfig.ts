import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
    console.error(error);

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
