import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateChatContactParamsRequest,
  UpdateChatContactRequest,
} from '@core/schema/chat/updateContact/request.schema';
import { ChatContactUpdaterUseCase } from '@core/useCases/chat/ChatContactUpdater.useCase';

export const updateContact = async (
  request: FastifyRequest<{
    Params: UpdateChatContactParamsRequest;
    Body: UpdateChatContactRequest;
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
      request.params.contact_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: null,
      });
    }

    return sendResponse(reply, {
      message: t('contact_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
