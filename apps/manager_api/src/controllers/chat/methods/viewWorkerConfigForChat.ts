import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
      request.params.worker_id,
      tokenJwtData.channels
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
