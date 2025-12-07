import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ValidateChatContactRequest } from '@core/schema/chat/validateContact/request.schema';
import { ChatContactValidatorUseCase } from '@core/useCases/chat/ChatContactValidator.useCase';

export const validateContact = async (
  request: FastifyRequest<{
    Params: ValidateChatContactRequest;
  }>,
  reply: FastifyReply
) => {
  const chatContactValidatorUseCase = container.resolve(
    ChatContactValidatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatContactValidatorUseCase.execute(
      t,
      request.params.contact_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_validation_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: null,
      });
    }


    return sendResponse(reply, {
      message: t('contact_validation_failed'),
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
