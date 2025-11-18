import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateChatStatusBody,
  UpdateChatStatusParams,
} from '@core/schema/chat/updateChatStatus/request.schema';
import { ChatStatusUpdaterUseCase } from '@core/useCases/chat/ChatStatusUpdater.useCase';

export const updateChatStatus = async (
  request: FastifyRequest<{
    Params: UpdateChatStatusParams;
    Body: UpdateChatStatusBody;
  }>,
  reply: FastifyReply
) => {
  const chatStatusUpdaterUseCase = container.resolve(ChatStatusUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatStatusUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_status_update_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('chat_status_update_not_found'),
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
