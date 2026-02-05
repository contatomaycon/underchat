import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateChatLabelParams,
  UpdateChatLabelRequest,
} from '@core/schema/chat/updateChatLabel/request.schema';
import { ChatLabelUpdaterUseCase } from '@core/useCases/chat/ChatLabelUpdater.useCase';

export const updateChatLabel = async (
  request: FastifyRequest<{
    Params: UpdateChatLabelParams;
    Body: UpdateChatLabelRequest;
  }>,
  reply: FastifyReply
) => {
  const chatLabelUpdaterUseCase = container.resolve(ChatLabelUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatLabelUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      request.body,
      tokenJwtData.channels
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_label_update_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: { success: true },
      });
    }

    return sendResponse(reply, {
      message: t('chat_label_update_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
