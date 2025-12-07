import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateChatContactRequest } from '@core/schema/chat/createContact/request.schema';
import { ChatContactCreatorUseCase } from '@core/useCases/chat/ChatContactCreator.useCase';

export const createContact = async (
  request: FastifyRequest<{
    Body: CreateChatContactRequest;
  }>,
  reply: FastifyReply
) => {
  const chatContactCreatorUseCase = container.resolve(
    ChatContactCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatContactCreatorUseCase.execute(
      t,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: null,
      });
    }

    return sendResponse(reply, {
      message: t('contact_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
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
