import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConfigForChatViewerUseCase } from '@core/useCases/chat/WorkerConfigForChatViewer.useCase';
import { ViewWorkerConfigForChatParams } from '@core/schema/chat/viewWorkerConfigForChat/request.schema';

export const viewWorkerConfigForChat = async (
  request: FastifyRequest<{
    Params: ViewWorkerConfigForChatParams;
  }>,
  reply: FastifyReply
) => {
  const workerConfigForChatViewerUseCase = container.resolve(
    WorkerConfigForChatViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await workerConfigForChatViewerUseCase.execute(
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
