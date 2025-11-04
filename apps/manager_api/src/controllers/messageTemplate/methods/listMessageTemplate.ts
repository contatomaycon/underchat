import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      t,
      request.query,
      tokenJwtData.is_administrator,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('message_template_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('message_template_list_not_found'),
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
