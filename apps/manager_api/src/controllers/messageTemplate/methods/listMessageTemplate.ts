import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListMessageTemplateRequest } from '@core/schema/messageTemplate/listMessageTemplate/request.schema';
import { MessageTemplateListerUseCase } from '@core/useCases/messageTemplate/MessageTemplateLister.useCase';

export const listMessageTemplate = async (
  request: FastifyRequest<{
    Querystring: ListMessageTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const messageTemplateListerUseCase = container.resolve(
    MessageTemplateListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await messageTemplateListerUseCase.execute(
      request.query,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('message_template_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('message_template_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
