import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateMessageTemplateRequest } from '@core/schema/messageTemplate/createMessageTemplate/request.schema';
import { MessageTemplateCreatorUseCase } from '@core/useCases/messageTemplate/MessageTemplateCreator.useCase';

export const createMessageTemplate = async (
  request: FastifyRequest<{
    Body: CreateMessageTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const messageTemplateCreatorUseCase = container.resolve(
    MessageTemplateCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await messageTemplateCreatorUseCase.execute(
      t,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('message_template_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('message_template_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
