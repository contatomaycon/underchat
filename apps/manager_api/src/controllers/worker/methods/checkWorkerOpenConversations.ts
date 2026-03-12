import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerOpenConversationsCheckerUseCase } from '@core/useCases/worker/WorkerOpenConversationsChecker.useCase';
import { CheckWorkerOpenConversationsRequest } from '@core/schema/worker/checkWorkerOpenConversations/request.schema';

export const checkWorkerOpenConversations = async (
  request: FastifyRequest<{
    Params: CheckWorkerOpenConversationsRequest;
  }>,
  reply: FastifyReply
) => {
  const workerOpenConversationsCheckerUseCase = container.resolve(
    WorkerOpenConversationsCheckerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const count = await workerOpenConversationsCheckerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('channel_open_conversations_check_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { count },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
