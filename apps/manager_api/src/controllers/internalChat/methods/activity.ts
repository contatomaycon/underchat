import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { ActivityBody } from '@core/schema/internalChat/activity/request.schema';
import { InternalChatActivityPublisherUseCase } from '@core/useCases/internalChat/InternalChatActivityPublisher.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const activity = async (
  request: FastifyRequest<{ Body: ActivityBody }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatActivityPublisherUseCase);
  const { tokenJwtData, t } = request;

  try {
    await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('chat_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: null,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
