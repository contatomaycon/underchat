import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateChatContactBody,
  UpdateChatContactParams,
} from '@core/schema/chat/updateChatContact/request.schema';
import { ChatContactUpdaterUseCase } from '@core/useCases/chat/ChatContactUpdater.useCase';

export const updateChatContact = async (
  request: FastifyRequest<{
    Params: UpdateChatContactParams;
    Body: UpdateChatContactBody;
  }>,
  reply: FastifyReply
) => {
  const chatContactUpdaterUseCase = container.resolve(
    ChatContactUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatContactUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_contact_update_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('chat_contact_update_not_found'),
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
