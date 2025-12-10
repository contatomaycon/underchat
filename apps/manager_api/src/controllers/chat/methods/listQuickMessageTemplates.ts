import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListQuickMessageTemplatesRequest } from '@core/schema/chat/listQuickMessageTemplates/request.schema';
import { ChatQuickMessageTemplatesListerUseCase } from '@core/useCases/chat/ChatQuickMessageTemplatesLister.useCase';

export const listQuickMessageTemplates = async (
  request: FastifyRequest<{
    Querystring: ListQuickMessageTemplatesRequest;
  }>,
  reply: FastifyReply
) => {
  const chatQuickMessageTemplatesListerUseCase = container.resolve(
    ChatQuickMessageTemplatesListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatQuickMessageTemplatesListerUseCase.execute(
      t,
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
